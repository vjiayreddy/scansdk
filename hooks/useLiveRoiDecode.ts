"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import {
  drawLiveCrop,
  expandLiveYoloRegion,
  mapCropBBoxToVideo,
} from "@/lib/barcode/live-crop";
import {
  isLiveDecodeBusy,
  setLiveDecodeBusy,
} from "@/lib/barcode/live-pipeline";
import {
  detectNativeBarcodes,
  isNativeBarcodeDetectorAvailable,
  type NativeBarcodeHit,
} from "@/lib/barcode/native-barcode-detector";
import {
  decodeCropBitmap,
  warmZxingLiveWorker,
} from "@/lib/barcode/zxing-live-worker";
import type { LiveTrackMeta, LiveYoloBox } from "@/hooks/useLiveYoloLocate";
import { boxIntersectsRoi } from "@/lib/roi";

type SourceBBox = { x: number; y: number; width: number; height: number };

export type LiveDecodeStatus = "located" | "read" | "unread";

export type LiveDecodedBox = LiveYoloBox & {
  status: LiveDecodeStatus;
  rawValue?: string;
  format?: string;
};

export type LiveReadResult = {
  rawValue: string;
  format: string;
  trackId: number;
  readAt: number;
};

type TrackStatus = {
  status: LiveDecodeStatus;
  rawValue?: string;
  format?: string;
  /** Consecutive decode misses before painting red. */
  failCount: number;
  /** Decoder-refined box in video coordinates (preferred for overlay). */
  refinedBox?: { x: number; y: number; width: number; height: number };
};

interface UseLiveRoiDecodeOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  boxes: LiveYoloBox[];
  trackMeta: LiveTrackMeta[];
  sourceRoi: SourceBBox | null;
  roiEnabled: boolean;
}

interface UseLiveRoiDecodeResult {
  decodedBoxes: LiveDecodedBox[];
  reads: LiveReadResult[];
  readCount: number;
  decoding: boolean;
  clearReads: () => void;
  lastNewReadAt: number;
}

/** Align with live YOLO minHitsToEmit. */
const STABLE_HITS = 2;
const STABLE_DELTA_RATIO = 0.35;
const DECODE_COOLDOWN_MS = 80;
const UNREAD_RETRY_MS = 600;
const DECODE_POLL_MS = 100;
/** Full-frame native poll when YOLO is empty or still stabilizing. */
const NATIVE_VIDEO_POLL_MS = 120;
/** Slower full-frame poll when YOLO already read all stable tracks. */
const NATIVE_VIDEO_POLL_SLOW_MS = 450;
/** Paint red only after this many consecutive misses. */
const FAILS_BEFORE_UNREAD = 5;
const MAX_CROPS_PER_BURST = 2;
/** Synthetic track ids for native-only hits (no YOLO box). */
const NATIVE_ID_BASE = 1_000_000;
/** Min IoU to treat a native hit as already covered by a YOLO box. */
const NATIVE_YOLO_IOU = 0.2;

let cropCanvas: HTMLCanvasElement | null = null;

function ensureCropCanvas(): HTMLCanvasElement {
  if (!cropCanvas) {
    cropCanvas = document.createElement("canvas");
  }
  return cropCanvas;
}

/**
 * Skip continuous native detect(video) while YOLO has stable unread tracks —
 * crop + ZXing path is cheaper and avoids duplicate full-frame work.
 */
function shouldSkipNativeVideoPoll(
  boxes: LiveYoloBox[],
  trackMeta: LiveTrackMeta[],
  statusById: Map<number, TrackStatus>,
): boolean {
  if (boxes.length === 0) {
    return false;
  }
  const metaById = new Map(trackMeta.map((m) => [m.id, m]));
  for (const box of boxes) {
    const meta = metaById.get(box.id);
    if (!meta || !isStable(meta)) {
      continue;
    }
    const trackStatus = statusById.get(box.id);
    if (trackStatus?.status !== "read") {
      return true;
    }
  }
  return false;
}

/** Interval for full-frame native poll based on YOLO track state. */
function nativeVideoPollIntervalMs(
  boxes: LiveYoloBox[],
  trackMeta: LiveTrackMeta[],
  statusById: Map<number, TrackStatus>,
): number {
  if (shouldSkipNativeVideoPoll(boxes, trackMeta, statusById)) {
    return 0;
  }
  if (boxes.length === 0) {
    return NATIVE_VIDEO_POLL_MS;
  }
  const metaById = new Map(trackMeta.map((m) => [m.id, m]));
  const hasStable = boxes.some((box) => {
    const meta = metaById.get(box.id);
    return meta !== undefined && isStable(meta);
  });
  if (!hasStable) {
    return NATIVE_VIDEO_POLL_MS;
  }
  const allStableRead = boxes.every((box) => {
    const meta = metaById.get(box.id);
    if (!meta || !isStable(meta)) {
      return true;
    }
    return statusById.get(box.id)?.status === "read";
  });
  return allStableRead ? NATIVE_VIDEO_POLL_SLOW_MS : NATIVE_VIDEO_POLL_MS;
}

function isStable(meta: LiveTrackMeta): boolean {
  // Decode only on fresh confirmed hits (same gate as overlay paint).
  if (meta.miss > 0) {
    return false;
  }
  if (meta.hits < STABLE_HITS) {
    return false;
  }
  const size = Math.max(8, Math.min(meta.width, meta.height));
  // First confirm frame is always eligible; after that, allow moderate motion.
  if (meta.hits === STABLE_HITS) {
    return true;
  }
  return meta.lastDelta <= size * STABLE_DELTA_RATIO;
}

function boxIou(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.width * a.height + b.width * b.height - inter;
  return union <= 0 ? 0 : inter / union;
}

function statusMapsEqual(
  a: Map<number, TrackStatus>,
  b: Map<number, TrackStatus>,
): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [id, value] of a) {
    const other = b.get(id);
    if (
      !other ||
      other.status !== value.status ||
      other.rawValue !== value.rawValue ||
      other.format !== value.format ||
      other.failCount !== value.failCount
    ) {
      return false;
    }
    const rb = value.refinedBox;
    const ob = other.refinedBox;
    if (!rb && !ob) {
      continue;
    }
    if (!rb || !ob) {
      return false;
    }
    if (
      Math.abs(rb.x - ob.x) > 0.75 ||
      Math.abs(rb.y - ob.y) > 0.75 ||
      Math.abs(rb.width - ob.width) > 0.75 ||
      Math.abs(rb.height - ob.height) > 0.75
    ) {
      return false;
    }
  }
  return true;
}

export function useLiveRoiDecode({
  videoRef,
  enabled,
  boxes,
  trackMeta,
  sourceRoi,
  roiEnabled,
}: UseLiveRoiDecodeOptions): UseLiveRoiDecodeResult {
  const [statusById, setStatusById] = useState<Map<number, TrackStatus>>(
    () => new Map(),
  );
  const [nativeExtraBoxes, setNativeExtraBoxes] = useState<LiveDecodedBox[]>(
    [],
  );
  const [reads, setReads] = useState<LiveReadResult[]>([]);
  const [decoding, setDecoding] = useState(false);
  const [lastNewReadAt, setLastNewReadAt] = useState(0);

  const busyRef = useRef(false);
  const nativeBusyRef = useRef(false);
  const cooldownUntilRef = useRef(0);
  const decodedValuesRef = useRef(new Set<string>());
  const attemptedAtRef = useRef(new Map<number, number>());
  const statusRef = useRef(statusById);
  const boxesRef = useRef(boxes);
  const trackMetaRef = useRef(trackMeta);
  const sourceRoiRef = useRef(sourceRoi);
  const roiEnabledRef = useRef(roiEnabled);
  const videoRefInternal = useRef(videoRef);
  const nativeNextIdRef = useRef(NATIVE_ID_BASE);
  const nativeIdByValueRef = useRef(new Map<string, number>());
  const ingestNativeHitsRef = useRef<(hits: NativeBarcodeHit[]) => void>(
    () => {},
  );

  useEffect(() => {
    boxesRef.current = boxes;
    trackMetaRef.current = trackMeta;
    sourceRoiRef.current = sourceRoi;
    roiEnabledRef.current = roiEnabled;
    videoRefInternal.current = videoRef;
    statusRef.current = statusById;
  }, [boxes, trackMeta, sourceRoi, roiEnabled, videoRef, statusById]);

  // Only drop decode status when the track is fully gone (missed past
  // MAX_MISS). Clearing on brief miss caused endless re-decode + duplicate reads.
  useEffect(() => {
    if (statusById.size === 0) {
      return;
    }
    const metaIds = new Set(trackMeta.map((m) => m.id));
    let changed = false;
    const next = new Map(statusById);
    for (const id of next.keys()) {
      if (!metaIds.has(id)) {
        next.delete(id);
        changed = true;
      }
    }
    if (changed) {
      statusRef.current = next;
      setStatusById(next);
    }
  }, [trackMeta, statusById]);

  const appendUniqueReads = (incoming: LiveReadResult[]) => {
    if (incoming.length === 0) {
      return;
    }
    setReads((prev) => {
      const seen = new Set(prev.map((r) => r.rawValue));
      const fresh: LiveReadResult[] = [];
      for (const read of incoming) {
        const value = read.rawValue.trim();
        if (!value || seen.has(value)) {
          continue;
        }
        seen.add(value);
        decodedValuesRef.current.add(value);
        fresh.push({ ...read, rawValue: value });
      }
      if (fresh.length === 0) {
        return prev;
      }
      // Flash only when something new landed.
      queueMicrotask(() => setLastNewReadAt(Date.now()));
      return [...fresh, ...prev];
    });
  };

  const clearReads = useCallback(() => {
    setStatusById(new Map());
    setNativeExtraBoxes([]);
    setReads([]);
    decodedValuesRef.current = new Set();
    attemptedAtRef.current = new Map();
    nativeIdByValueRef.current = new Map();
    setLastNewReadAt(0);
  }, []);

  useEffect(() => {
    if (enabled) {
      return;
    }
    busyRef.current = false;
    nativeBusyRef.current = false;
    setLiveDecodeBusy(false);
    decodedValuesRef.current = new Set();
    attemptedAtRef.current = new Map();
    nativeIdByValueRef.current = new Map();
    queueMicrotask(() => {
      setStatusById(new Map());
      setNativeExtraBoxes([]);
      setReads([]);
      setLastNewReadAt(0);
      setDecoding(false);
    });
  }, [enabled]);

  /** Apply native hits: match YOLO tracks or spawn green native-only boxes. */
  ingestNativeHitsRef.current = (hits: NativeBarcodeHit[]) => {
    // Empty frame → clear native-only ghosts immediately.
    if (hits.length === 0) {
      setNativeExtraBoxes([]);
      return;
    }

    const useRoi = roiEnabledRef.current;
    const currentRoi = sourceRoiRef.current;
    const currentBoxes = boxesRef.current;
    const nextStatus = new Map(statusRef.current);
    const newReads: LiveReadResult[] = [];
    const extras: LiveDecodedBox[] = [];
    let statusChanged = false;

    for (const hit of hits) {
      if (
        useRoi &&
        currentRoi &&
        !boxIntersectsRoi(hit.boundingBox, currentRoi)
      ) {
        continue;
      }

      let bestId: number | null = null;
      let bestScore = 0;
      let bestIou = 0;
      for (const box of currentBoxes) {
        const iou = boxIou(box, hit.boundingBox);
        const cx = hit.boundingBox.x + hit.boundingBox.width / 2;
        const cy = hit.boundingBox.y + hit.boundingBox.height / 2;
        const inside =
          cx >= box.x &&
          cx <= box.x + box.width &&
          cy >= box.y &&
          cy <= box.y + box.height;
        const score = iou + (inside ? 0.35 : 0);
        if (score > bestScore) {
          bestScore = score;
          bestIou = iou;
          bestId = box.id;
        }
      }

      const matchedYolo =
        bestId !== null &&
        (bestScore >= 0.08 || bestIou >= NATIVE_YOLO_IOU);

      if (matchedYolo && bestId !== null) {
        const prev = nextStatus.get(bestId);
        const refined = {
          x: hit.boundingBox.x,
          y: hit.boundingBox.y,
          width: hit.boundingBox.width,
          height: hit.boundingBox.height,
        };
        if (
          prev?.status !== "read" ||
          prev.rawValue !== hit.rawValue ||
          !prev.refinedBox
        ) {
          nextStatus.set(bestId, {
            status: "read",
            rawValue: hit.rawValue,
            format: hit.format,
            failCount: 0,
            refinedBox: refined,
          });
          statusChanged = true;
        }
      } else if (
        // Skip native-only extras when any YOLO box already covers this hit.
        !currentBoxes.some(
          (box) => boxIou(box, hit.boundingBox) >= NATIVE_YOLO_IOU,
        )
      ) {
        let id = nativeIdByValueRef.current.get(hit.rawValue);
        if (id === undefined) {
          id = nativeNextIdRef.current++;
          nativeIdByValueRef.current.set(hit.rawValue, id);
        }
        // One overlay box per value — duplicate native hits reuse the same id.
        const existing = extras.findIndex((box) => box.id === id);
        const nextBox: LiveDecodedBox = {
          id,
          x: hit.boundingBox.x,
          y: hit.boundingBox.y,
          width: hit.boundingBox.width,
          height: hit.boundingBox.height,
          score: 1,
          status: "read",
          rawValue: hit.rawValue,
          format: hit.format,
        };
        if (existing >= 0) {
          extras[existing] = nextBox;
        } else {
          extras.push(nextBox);
        }
      }

      if (!decodedValuesRef.current.has(hit.rawValue.trim())) {
        decodedValuesRef.current.add(hit.rawValue.trim());
        newReads.push({
          rawValue: hit.rawValue.trim(),
          format: hit.format,
          trackId:
            bestId ??
            nativeIdByValueRef.current.get(hit.rawValue) ??
            0,
          readAt: Date.now(),
        });
      }
    }

    if (statusChanged) {
      statusRef.current = nextStatus;
      setStatusById(nextStatus);
    }
    setNativeExtraBoxes(extras);
    appendUniqueReads(newReads);
  };

  // Continuous native BarcodeDetector.detect(video) — MDN live pattern.
  useEffect(() => {
    if (!enabled || !isNativeBarcodeDetectorAvailable()) {
      return;
    }

    let cancelled = false;

    const tick = () => {
      if (cancelled || nativeBusyRef.current || isLiveDecodeBusy()) {
        return;
      }
      const pollMs = nativeVideoPollIntervalMs(
        boxesRef.current,
        trackMetaRef.current,
        statusRef.current,
      );
      if (pollMs === 0) {
        return;
      }
      const video = videoRefInternal.current.current;
      if (!video || video.readyState < 2 || video.videoWidth < 2) {
        return;
      }

      nativeBusyRef.current = true;
      void (async () => {
        try {
          const hits = await detectNativeBarcodes(video);
          if (!cancelled && hits.length > 0) {
            ingestNativeHitsRef.current(hits);
          }
        } finally {
          nativeBusyRef.current = false;
        }
      })();
    };

    const id = window.setInterval(tick, NATIVE_VIDEO_POLL_MS);
    tick();

    return () => {
      cancelled = true;
      window.clearInterval(id);
      nativeBusyRef.current = false;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    void warmZxingLiveWorker();

    const tick = () => {
      if (cancelled || busyRef.current || isLiveDecodeBusy()) {
        return;
      }

      const now = performance.now();
      if (now < cooldownUntilRef.current) {
        return;
      }

      const currentBoxes = boxesRef.current;
      const currentMeta = trackMetaRef.current;
      const currentRoi = sourceRoiRef.current;
      const useRoi = roiEnabledRef.current;
      const metaById = new Map(currentMeta.map((m) => [m.id, m]));

      const candidates = currentBoxes.filter((box) => {
        const meta = metaById.get(box.id);
        if (!meta || !isStable(meta)) {
          return false;
        }
        if (useRoi && currentRoi && !boxIntersectsRoi(box, currentRoi)) {
          return false;
        }
        const existing = statusRef.current.get(box.id);
        if (existing?.status === "read") {
          return false;
        }
        // Already captured this barcode value on another track — don't re-decode.
        for (const status of statusRef.current.values()) {
          if (
            status.status === "read" &&
            status.rawValue &&
            decodedValuesRef.current.has(status.rawValue)
          ) {
            // Skip if this box heavily overlaps an already-read YOLO box.
            const readBox = currentBoxes.find((b) => {
              const st = statusRef.current.get(b.id);
              return st?.status === "read" && st.rawValue === status.rawValue;
            });
            if (readBox && boxIou(box, readBox) >= 0.2) {
              return false;
            }
          }
        }
        const lastAttempt = attemptedAtRef.current.get(box.id) ?? 0;
        if (
          existing?.status === "unread" &&
          now - lastAttempt < UNREAD_RETRY_MS
        ) {
          return false;
        }
        return true;
      });

      if (candidates.length === 0) {
        return;
      }

      const video = videoRefInternal.current.current;
      if (!video || video.readyState < 2 || video.videoWidth < 2) {
        return;
      }

      const toDecode = candidates
        .slice()
        .sort(
          (a, b) =>
            b.score - a.score || b.width * b.height - a.width * a.height,
        )
        .slice(0, MAX_CROPS_PER_BURST);

      busyRef.current = true;
      setLiveDecodeBusy(true);
      setDecoding(true);

      void (async () => {
        try {
          const nextStatus = new Map(statusRef.current);
          const newReads: LiveReadResult[] = [];
          const canvas = ensureCropCanvas();

          for (const box of toDecode) {
            if (cancelled) {
              break;
            }

            attemptedAtRef.current.set(box.id, performance.now());
            const crop = expandLiveYoloRegion(
              box,
              video.videoWidth,
              video.videoHeight,
            );
            const { scale } = drawLiveCrop(video, crop, canvas, {
              contentWidth: box.width,
              contentHeight: box.height,
            });
            const bitmap = await createImageBitmap(canvas);

            // Live FPS is low — always use the harder multi-format path.
            const escalate = true;

            let hits: Awaited<ReturnType<typeof decodeCropBitmap>> = [];
            try {
              hits = await decodeCropBitmap(bitmap, escalate);
            } catch {
              hits = [];
            }

            const best = hits[0] ?? null;
            if (best?.rawValue) {
              const value = best.rawValue.trim();
              const videoBox = mapCropBBoxToVideo(
                best.boundingBox,
                crop,
                scale,
              );
              const usable =
                videoBox.width > 2 &&
                videoBox.height > 2 &&
                Number.isFinite(videoBox.x) &&
                Number.isFinite(videoBox.y);
              nextStatus.set(box.id, {
                status: "read",
                rawValue: value,
                format: best.format,
                failCount: 0,
                refinedBox: usable ? videoBox : undefined,
              });
              if (!decodedValuesRef.current.has(value)) {
                decodedValuesRef.current.add(value);
                newReads.push({
                  rawValue: value,
                  format: best.format,
                  trackId: box.id,
                  readAt: Date.now(),
                });
              }
            } else {
              const fails = (nextStatus.get(box.id)?.failCount ?? 0) + 1;
              nextStatus.set(box.id, {
                status: fails >= FAILS_BEFORE_UNREAD ? "unread" : "located",
                failCount: fails,
              });
            }
          }

          if (cancelled) {
            return;
          }

          if (!statusMapsEqual(nextStatus, statusRef.current)) {
            statusRef.current = nextStatus;
            setStatusById(nextStatus);
          }
          appendUniqueReads(newReads);
        } finally {
          cooldownUntilRef.current = performance.now() + DECODE_COOLDOWN_MS;
          busyRef.current = false;
          setLiveDecodeBusy(false);
          if (!cancelled) {
            setDecoding(false);
          }
        }
      })();
    };

    const id = window.setInterval(tick, DECODE_POLL_MS);
    tick();

    return () => {
      cancelled = true;
      window.clearInterval(id);
      busyRef.current = false;
      setLiveDecodeBusy(false);
    };
  }, [enabled]);

  const yoloDecoded: LiveDecodedBox[] = boxes.map((box) => {
    const info = statusById.get(box.id);
    const meta = trackMeta.find((m) => m.id === box.id);
    // Never paint a stale read on a coasting / unconfirmed track.
    const fresh = meta !== undefined && meta.miss === 0 && meta.hits >= STABLE_HITS;
    const status: LiveDecodeStatus = fresh
      ? (info?.status ?? "located")
      : "located";
    const refined = info?.refinedBox;
    // Keep YOLO track box for locate paint — only swap geometry when read
    // (avoids pink box jump when crop decode returns a different bbox).
    const useRefined =
      status === "read" &&
      refined !== undefined &&
      refined.width > 2 &&
      refined.height > 2;
    return {
      ...box,
      ...(useRefined
        ? {
            x: refined.x,
            y: refined.y,
            width: refined.width,
            height: refined.height,
          }
        : {}),
      status,
      rawValue: status === "read" ? info?.rawValue : undefined,
      format: status === "read" ? info?.format : undefined,
    };
  });

  const readValues = new Set(
    yoloDecoded
      .filter((b) => b.status === "read" && b.rawValue)
      .map((b) => b.rawValue!),
  );
  const extras = nativeExtraBoxes.filter(
    (b) => b.rawValue && !readValues.has(b.rawValue),
  );
  const decodedBoxes = [...yoloDecoded, ...extras];

  return {
    decodedBoxes,
    reads,
    readCount: reads.length,
    decoding,
    clearReads,
    lastNewReadAt,
  };
}
