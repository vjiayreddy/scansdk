"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { boxIou, type YoloBox } from "@/lib/barcode/yolo-core";
import {
  getYoloLoadError,
  isYoloAvailable,
  locateBarcodesFromVideo,
} from "@/lib/barcode/yolo-locate";

export type LiveLocateStatus =
  | "idle"
  | "loading-model"
  | "running"
  | "error";

/** Stable id for React keys + tracking across frames. */
export interface LiveYoloBox extends YoloBox {
  id: number;
}

interface UseLiveYoloLocateOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  enabled: boolean;
}

interface UseLiveYoloLocateResult {
  boxes: LiveYoloBox[];
  /** Per-track stability metadata (same order as last stabilize). */
  trackMeta: LiveTrackMeta[];
  fps: number;
  inferenceMs: number;
  status: LiveLocateStatus;
  error: string | null;
  clearBoxes: () => void;
}

export type LiveTrackMeta = {
  id: number;
  hits: number;
  lastDelta: number;
  miss: number;
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
};

/**
 * Pills-style IoU tracker state — snap bbox on match, coast last box on miss.
 * No EMA / velocity (pills does not blend boxes).
 */
interface TrackedBox extends LiveYoloBox {
  miss: number;
  /** Consecutive matched detections (preserved across miss coast). */
  hits: number;
  lastCx: number;
  lastCy: number;
  /** How much the center moved on the last match (for decode stability). */
  lastDelta: number;
}

/** Pills LIVE_PRECISION.trackIouMatch */
const MATCH_IOU = 0.2;
/** Pills LIVE_PRECISION.trackCenterMatchFactor × mean diagonal. */
const MATCH_CENTER_FACTOR = 0.65;
/** Confirm before first paint. 1 = paint on first hit (faster feel on mobile). */
const MIN_HITS_TO_SHOW = 1;
/**
 * Keep track identity this many miss frames for rematch — but do NOT paint
 * coasted boxes (barcode left frame must clear overlay immediately).
 */
const MAX_MISS = 6;
/** Rematch jump larger than this × mean diag → treat as new object. */
const JUMP_RESET_FACTOR = 0.75;
/**
 * Minimum gap between locate starts. 640 live is much faster than 960; keep a
 * small floor so we do not queue back-to-back OrtRuns on weak phones.
 */
const MIN_INFER_GAP_MS = 40;

function centerOf(box: { x: number; y: number; width: number; height: number }): {
  cx: number;
  cy: number;
} {
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

function meanDiag(
  a: { width: number; height: number },
  b: { width: number; height: number },
): number {
  return (
    (Math.hypot(a.width, a.height) + Math.hypot(b.width, b.height)) / 2
  );
}

function matchQuality(track: TrackedBox, det: YoloBox): number {
  const iou = boxIou(track, det);
  if (iou >= MATCH_IOU) {
    return iou;
  }
  const { cx: dcx, cy: dcy } = centerOf(det);
  const dist = Math.hypot(dcx - track.lastCx, dcy - track.lastCy);
  const thresh = meanDiag(track, det) * MATCH_CENTER_FACTOR;
  if (dist > thresh) {
    return -1;
  }
  return MATCH_IOU * (1 - dist / Math.max(1e-6, thresh)) * 0.99;
}

function toMeta(tracks: TrackedBox[]): LiveTrackMeta[] {
  return tracks.map((track) => ({
    id: track.id,
    hits: track.hits,
    lastDelta: track.lastDelta,
    miss: track.miss,
    x: track.x,
    y: track.y,
    width: track.width,
    height: track.height,
    score: track.score,
  }));
}

/**
 * Port of pills IoUTracker.update: greedy IoU/center match, snap bbox,
 * coast last box, emit only after min hits.
 */
function stabilizeTracks(
  previous: TrackedBox[],
  detections: YoloBox[],
  nextId: { current: number },
): TrackedBox[] {
  const tracks: TrackedBox[] = previous.map((track) => ({ ...track }));
  const unmatchedTracks = new Set(tracks.map((_, i) => i));
  const usedDet = new Set<number>();

  const pairs: { ti: number; di: number; score: number }[] = [];
  for (let ti = 0; ti < tracks.length; ti += 1) {
    for (let di = 0; di < detections.length; di += 1) {
      const score = matchQuality(tracks[ti]!, detections[di]!);
      if (score < 0) {
        continue;
      }
      pairs.push({ ti, di, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  for (const pair of pairs) {
    if (!unmatchedTracks.has(pair.ti) || usedDet.has(pair.di)) {
      continue;
    }
    unmatchedTracks.delete(pair.ti);
    usedDet.add(pair.di);
    const track = tracks[pair.ti]!;
    const det = detections[pair.di]!;
    const { cx, cy } = centerOf(det);
    const lastDelta = Math.hypot(cx - track.lastCx, cy - track.lastCy);
    const jumpReset = lastDelta > meanDiag(track, det) * JUMP_RESET_FACTOR;
    // Snap — pills does not EMA blend boxes.
    track.x = det.x;
    track.y = det.y;
    track.width = det.width;
    track.height = det.height;
    track.score = det.score;
    // Large teleport (e.g. barcode gone, face FP rematched) → re-confirm.
    track.hits = jumpReset ? 1 : track.hits + 1;
    track.miss = 0;
    track.lastCx = cx;
    track.lastCy = cy;
    track.lastDelta = lastDelta;
  }

  for (let di = 0; di < detections.length; di += 1) {
    if (usedDet.has(di)) {
      continue;
    }
    const det = detections[di]!;
    const { cx, cy } = centerOf(det);
    tracks.push({
      id: nextId.current++,
      x: det.x,
      y: det.y,
      width: det.width,
      height: det.height,
      score: det.score,
      miss: 0,
      hits: 1,
      lastCx: cx,
      lastCy: cy,
      lastDelta: 0,
    });
  }

  const remaining: TrackedBox[] = [];
  for (let ti = 0; ti < tracks.length; ti += 1) {
    const track = tracks[ti]!;
    // New tracks appended after previous.length were never in unmatchedTracks.
    if (ti < previous.length && unmatchedTracks.has(ti)) {
      track.miss += 1;
      if (track.miss <= MAX_MISS) {
        remaining.push(track);
      }
    } else {
      remaining.push(track);
    }
  }

  return remaining;
}

function toPublicBoxes(tracks: TrackedBox[]): LiveYoloBox[] {
  // Paint only fresh hits — coast keeps identity in tracksRef but must not
  // leave green/pink ghosts after the barcode leaves the frame.
  return tracks
    .filter((track) => track.hits >= MIN_HITS_TO_SHOW && track.miss === 0)
    .map(({ id, x, y, width, height, score }) => ({
      id,
      x,
      y,
      width,
      height,
      score,
    }));
}

/** Bail out of setState when motion is sub-pixel (prevents update-depth loops). */
function boxesNearlyEqual(a: LiveYoloBox[], b: LiveYoloBox[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index]!;
    const right = b[index]!;
    if (
      left.id !== right.id ||
      Math.abs(left.x - right.x) > 0.75 ||
      Math.abs(left.y - right.y) > 0.75 ||
      Math.abs(left.width - right.width) > 0.75 ||
      Math.abs(left.height - right.height) > 0.75 ||
      Math.abs(left.score - right.score) > 0.01
    ) {
      return false;
    }
  }
  return true;
}

function metaNearlyEqual(a: LiveTrackMeta[], b: LiveTrackMeta[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index]!;
    const right = b[index]!;
    if (
      left.id !== right.id ||
      left.hits !== right.hits ||
      left.miss !== right.miss ||
      Math.abs(left.lastDelta - right.lastDelta) > 0.5 ||
      Math.abs(left.x - right.x) > 0.75 ||
      Math.abs(left.y - right.y) > 0.75
    ) {
      return false;
    }
  }
  return true;
}

export function useLiveYoloLocate({
  videoRef,
  enabled,
}: UseLiveYoloLocateOptions): UseLiveYoloLocateResult {
  const [boxes, setBoxes] = useState<LiveYoloBox[]>([]);
  const [trackMeta, setTrackMeta] = useState<LiveTrackMeta[]>([]);
  const [fps, setFps] = useState(0);
  const [inferenceMs, setInferenceMs] = useState(0);
  const [status, setStatus] = useState<LiveLocateStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const busyRef = useRef(false);
  const frameTimesRef = useRef<number[]>([]);
  const rafRef = useRef(0);
  const tracksRef = useRef<TrackedBox[]>([]);
  const nextIdRef = useRef(1);
  const enabledRef = useRef(enabled);
  const runGenerationRef = useRef(0);
  const requestIdRef = useRef(0);
  const lastInferAtRef = useRef(0);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const publishBoxes = (tracks: TrackedBox[], force = false) => {
    const next = toPublicBoxes(tracks);
    setBoxes((prev) => {
      if (!force && boxesNearlyEqual(prev, next)) {
        return prev;
      }
      return next;
    });
  };

  const publishMeta = (tracks: TrackedBox[]) => {
    const next = toMeta(tracks);
    setTrackMeta((prev) => (metaNearlyEqual(prev, next) ? prev : next));
  };

  const clearBoxes = useCallback(() => {
    runGenerationRef.current += 1;
    tracksRef.current = [];
    setBoxes([]);
    setTrackMeta([]);
    setFps(0);
    setInferenceMs(0);
  }, []);

  useEffect(() => {
    if (!enabled) {
      cancelAnimationFrame(rafRef.current);
      busyRef.current = false;
      runGenerationRef.current += 1;
      tracksRef.current = [];
      queueMicrotask(() => {
        setBoxes([]);
        setTrackMeta([]);
        setFps(0);
        setInferenceMs(0);
        setStatus("idle");
        setError(null);
      });
      return;
    }

    let cancelled = false;
    const generation = ++runGenerationRef.current;

    queueMicrotask(() => {
      if (cancelled || generation !== runGenerationRef.current) {
        return;
      }
      setStatus("loading-model");
      setError(null);
    });

    isYoloAvailable("live")
      .then((ok) => {
        if (cancelled || generation !== runGenerationRef.current) {
          return;
        }
        if (!ok) {
          setStatus("error");
          setError(getYoloLoadError() || "YOLO model failed to load");
          return;
        }

        setStatus("running");
        lastInferAtRef.current = performance.now();

        const tick = () => {
          if (cancelled || generation !== runGenerationRef.current) {
            return;
          }

          rafRef.current = requestAnimationFrame(tick);

          const now = performance.now();

          // Only skip while a locate is in flight.
          if (busyRef.current) {
            return;
          }

          if (now - lastInferAtRef.current < MIN_INFER_GAP_MS) {
            return;
          }

          const video = videoRef.current;
          if (!video || video.readyState < 2 || video.videoWidth < 2) {
            return;
          }

          busyRef.current = true;
          const requestId = ++requestIdRef.current;
          const captureAt = performance.now();
          // Reserve the slot immediately so RAF does not pile up starts.
          lastInferAtRef.current = captureAt;

          void (async () => {
            try {
              const started = performance.now();
              const detections = await locateBarcodesFromVideo(video);
              const elapsed = performance.now() - started;

              if (
                cancelled ||
                !enabledRef.current ||
                generation !== runGenerationRef.current
              ) {
                return;
              }

              // Latest-frame-wins: drop stale results if a newer capture started.
              if (requestId !== requestIdRef.current) {
                return;
              }

              // Always update — including empty — so tracks coast via miss.
              tracksRef.current = stabilizeTracks(
                tracksRef.current,
                detections,
                nextIdRef,
              );

              const times = frameTimesRef.current;
              times.push(performance.now());
              while (times.length > 0 && performance.now() - times[0]! > 1000) {
                times.shift();
              }

              publishBoxes(tracksRef.current, true);
              publishMeta(tracksRef.current);
              setInferenceMs(Math.round(elapsed));
              setFps(times.length);
            } catch (err: unknown) {
              if (
                cancelled ||
                !enabledRef.current ||
                generation !== runGenerationRef.current
              ) {
                return;
              }
              setStatus("error");
              setError(
                err instanceof Error ? err.message : "Live locate failed",
              );
            } finally {
              busyRef.current = false;
            }
          })();
        };

        rafRef.current = requestAnimationFrame(tick);
      })
      .catch((err: unknown) => {
        if (cancelled || generation !== runGenerationRef.current) {
          return;
        }
        setStatus("error");
        setError(
          err instanceof Error ? err.message : "YOLO model failed to load",
        );
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      busyRef.current = false;
    };
  }, [enabled, videoRef]);

  return { boxes, trackMeta, fps, inferenceMs, status, error, clearBoxes };
}
