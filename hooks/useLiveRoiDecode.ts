"use client";

import {
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

const STABLE_HITS = 2;
const STABLE_DELTA_RATIO = 0.18;
const DECODE_COOLDOWN_MS = 150;
const UNREAD_RETRY_MS = 400;
const DECODE_POLL_MS = 120;
/** Continuous native BarcodeDetector.detect(video) interval. */
const NATIVE_VIDEO_POLL_MS = 100;
/** Paint red only after this many consecutive misses. */
const FAILS_BEFORE_UNREAD = 2;
const MAX_CROPS_PER_BURST = 2;
/** Synthetic track ids for native-only hits (no YOLO box). */
const NATIVE_ID_BASE = 1_000_000;

let cropCanvas: HTMLCanvasElement | null = null;

function ensureCropCanvas(): HTMLCanvasElement {
  if (!cropCanvas) {
    cropCanvas = document.createElement("canvas");
  }
  return cropCanvas;
}

function isStable(meta: LiveTrackMeta): boolean {
  if (meta.miss > 0 || meta.hits < STABLE_HITS) {
    return false;
  }
  if (meta.hits >= 4) {
    return true;
  }
  const size = Math.max(8, Math.min(meta.width, meta.height));
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

  const clearReads = () => {
    setStatusById(new Map());
    setNativeExtraBoxes([]);
    setReads([]);
    decodedValuesRef.current = new Set();
    attemptedAtRef.current = new Map();
    nativeIdByValueRef.current = new Map();
    setLastNewReadAt(0);
  };

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
    if (hits.length === 0) {
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
          bestId = box.id;
        }
      }

      if (bestId !== null && bestScore >= 0.08) {
        const prev = nextStatus.get(bestId);
        if (prev?.status !== "read" || prev.rawValue !== hit.rawValue) {
          nextStatus.set(bestId, {
            status: "read",
            rawValue: hit.rawValue,
            format: hit.format,
            failCount: 0,
          });
          statusChanged = true;
        }
      } else {
        let id = nativeIdByValueRef.current.get(hit.rawValue);
        if (id === undefined) {
          id = nativeNextIdRef.current++;
          nativeIdByValueRef.current.set(hit.rawValue, id);
        }
        extras.push({
          id,
          x: hit.boundingBox.x,
          y: hit.boundingBox.y,
          width: hit.boundingBox.width,
          height: hit.boundingBox.height,
          score: 1,
          status: "read",
          rawValue: hit.rawValue,
          format: hit.format,
        });
      }

      if (!decodedValuesRef.current.has(hit.rawValue)) {
        decodedValuesRef.current.add(hit.rawValue);
        newReads.push({
          rawValue: hit.rawValue,
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
    if (newReads.length > 0) {
      setReads((prev) => [...newReads, ...prev]);
      setLastNewReadAt(Date.now());
    }
  };

  // Continuous native BarcodeDetector.detect(video) — MDN live pattern.
  useEffect(() => {
    if (!enabled || !isNativeBarcodeDetectorAvailable()) {
      return;
    }

    let cancelled = false;

    const tick = () => {
      if (cancelled || nativeBusyRef.current) {
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
            const { scale } = drawLiveCrop(video, crop, canvas);
            const bitmap = await createImageBitmap(canvas);

            const priorFails = nextStatus.get(box.id)?.failCount ?? 0;
            const escalate = priorFails >= 1;

            let hits: Awaited<ReturnType<typeof decodeCropBitmap>> = [];
            try {
              hits = await decodeCropBitmap(bitmap, escalate);
            } catch {
              hits = [];
            }

            const best = hits[0] ?? null;
            if (best?.rawValue) {
              const videoBox = mapCropBBoxToVideo(
                best.boundingBox,
                crop,
                scale,
              );
              void boxIou(box, videoBox);
              nextStatus.set(box.id, {
                status: "read",
                rawValue: best.rawValue,
                format: best.format,
                failCount: 0,
              });
              if (!decodedValuesRef.current.has(best.rawValue)) {
                decodedValuesRef.current.add(best.rawValue);
                newReads.push({
                  rawValue: best.rawValue,
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
          if (newReads.length > 0) {
            setReads((prev) => [...newReads, ...prev]);
            setLastNewReadAt(Date.now());
          }
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
    return {
      ...box,
      status: info?.status ?? "located",
      rawValue: info?.rawValue,
      format: info?.format,
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
