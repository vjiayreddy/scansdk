"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { boxIou, type YoloBox } from "@/lib/barcode/yolo-core";
import { isLiveDecodeBusy } from "@/lib/barcode/live-pipeline";
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

interface TrackedBox extends LiveYoloBox {
  miss: number;
  /** Pixels per ms (video space). */
  vx: number;
  vy: number;
  /** Consecutive matched detections (resets on miss). */
  hits: number;
  lastCx: number;
  lastCy: number;
  /** How much the center moved on the last match (for stability). */
  lastDelta: number;
}

const MATCH_IOU = 0.3;
/** Keep drawing a box this many failed frames after last hit (anti-flicker). */
const MAX_MISS = 2;
/** Blend new detection into previous pose — high = snappier follow. */
const POS_BLEND = 0.9;
/** Velocity EMA toward measured frame-to-frame motion. */
const VEL_BLEND = 0.55;
/** Decay velocity when held without a fresh detection. */
const VEL_DECAY = 0.92;

function blend(prev: number, next: number, amount = POS_BLEND): number {
  return prev * (1 - amount) + next * amount;
}

function centerOf(box: { x: number; y: number; width: number; height: number }): {
  cx: number;
  cy: number;
} {
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
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
 * Match detections to prior tracks by IoU, hold short misses, soft-blend pose,
 * and estimate per-track velocity for RAF extrapolation.
 */
function stabilizeTracks(
  previous: TrackedBox[],
  detections: YoloBox[],
  nextId: { current: number },
  dtMs: number,
): TrackedBox[] {
  const usedPrev = new Set<number>();
  const usedDet = new Set<number>();
  const next: TrackedBox[] = [];
  const safeDt = Math.max(1, dtMs);

  const pairs: { pi: number; di: number; iou: number }[] = [];
  for (let pi = 0; pi < previous.length; pi += 1) {
    for (let di = 0; di < detections.length; di += 1) {
      const iou = boxIou(previous[pi]!, detections[di]!);
      if (iou >= MATCH_IOU) {
        pairs.push({ pi, di, iou });
      }
    }
  }
  pairs.sort((a, b) => b.iou - a.iou);

  for (const pair of pairs) {
    if (usedPrev.has(pair.pi) || usedDet.has(pair.di)) {
      continue;
    }
    usedPrev.add(pair.pi);
    usedDet.add(pair.di);
    const prev = previous[pair.pi]!;
    const det = detections[pair.di]!;
    const x = blend(prev.x, det.x);
    const y = blend(prev.y, det.y);
    const width = blend(prev.width, det.width);
    const height = blend(prev.height, det.height);
    const { cx, cy } = centerOf({ x, y, width, height });
    const measVx = (cx - prev.lastCx) / safeDt;
    const measVy = (cy - prev.lastCy) / safeDt;
    const lastDelta = Math.hypot(cx - prev.lastCx, cy - prev.lastCy);
    next.push({
      id: prev.id,
      miss: 0,
      hits: prev.hits + 1,
      score: det.score,
      x,
      y,
      width,
      height,
      vx: blend(prev.vx, measVx, VEL_BLEND),
      vy: blend(prev.vy, measVy, VEL_BLEND),
      lastCx: cx,
      lastCy: cy,
      lastDelta,
    });
  }

  for (let di = 0; di < detections.length; di += 1) {
    if (usedDet.has(di)) {
      continue;
    }
    const det = detections[di]!;
    const { cx, cy } = centerOf(det);
    next.push({
      id: nextId.current++,
      miss: 0,
      hits: 1,
      ...det,
      vx: 0,
      vy: 0,
      lastCx: cx,
      lastCy: cy,
      lastDelta: 0,
    });
  }

  for (let pi = 0; pi < previous.length; pi += 1) {
    if (usedPrev.has(pi)) {
      continue;
    }
    const prev = previous[pi]!;
    const miss = prev.miss + 1;
    if (miss <= MAX_MISS) {
      next.push({
        ...prev,
        miss,
        hits: 0,
        vx: prev.vx * VEL_DECAY,
        vy: prev.vy * VEL_DECAY,
      });
    }
  }

  return next;
}

function extrapolateTracks(tracks: TrackedBox[], dtMs: number): TrackedBox[] {
  if (dtMs <= 0 || tracks.length === 0) {
    return tracks;
  }
  return tracks.map((track) => {
    const dx = track.vx * dtMs;
    const dy = track.vy * dtMs;
    if (dx === 0 && dy === 0) {
      return track;
    }
    return {
      ...track,
      x: track.x + dx,
      y: track.y + dy,
      lastCx: track.lastCx + dx,
      lastCy: track.lastCy + dy,
    };
  });
}

function toPublicBoxes(tracks: TrackedBox[]): LiveYoloBox[] {
  return tracks.map(({ id, x, y, width, height, score }) => ({
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

const MIN_VEL = 0.015;
/** Cap React publishes from extrapolation (~20 fps). */
const EXTRAPOLATE_PUBLISH_MS = 50;

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
  const lastPaintAtRef = useRef(0);
  const lastPublishAtRef = useRef(0);

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

  const clearBoxes = () => {
    runGenerationRef.current += 1;
    tracksRef.current = [];
    setBoxes([]);
    setTrackMeta([]);
    setFps(0);
    setInferenceMs(0);
  };

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
        lastPaintAtRef.current = performance.now();
        lastInferAtRef.current = performance.now();

        const tick = () => {
          if (cancelled || generation !== runGenerationRef.current) {
            return;
          }

          rafRef.current = requestAnimationFrame(tick);

          const now = performance.now();
          const paintDt = now - lastPaintAtRef.current;
          lastPaintAtRef.current = now;

          // Extrapolate between inferences so boxes follow camera pan.
          // Do NOT setState every RAF — that causes max-update-depth loops.
          if (tracksRef.current.length > 0 && paintDt > 0 && paintDt < 100) {
            let moving = false;
            for (const track of tracksRef.current) {
              if (Math.abs(track.vx) < MIN_VEL) {
                track.vx = 0;
              }
              if (Math.abs(track.vy) < MIN_VEL) {
                track.vy = 0;
              }
              if (track.vx !== 0 || track.vy !== 0) {
                moving = true;
              }
            }
            if (moving) {
              tracksRef.current = extrapolateTracks(
                tracksRef.current,
                paintDt,
              );
              if (now - lastPublishAtRef.current >= EXTRAPOLATE_PUBLISH_MS) {
                lastPublishAtRef.current = now;
                publishBoxes(tracksRef.current);
              }
            }
          }

          if (busyRef.current || isLiveDecodeBusy()) {
            return;
          }

          const video = videoRef.current;
          if (!video || video.readyState < 2 || video.videoWidth < 2) {
            return;
          }

          busyRef.current = true;
          const requestId = ++requestIdRef.current;
          const captureAt = performance.now();

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

              const inferDt = Math.max(1, captureAt - lastInferAtRef.current);
              lastInferAtRef.current = captureAt;

              tracksRef.current = stabilizeTracks(
                tracksRef.current,
                detections,
                nextIdRef,
                inferDt,
              );

              const times = frameTimesRef.current;
              times.push(performance.now());
              while (times.length > 0 && performance.now() - times[0]! > 1000) {
                times.shift();
              }

              lastPublishAtRef.current = performance.now();
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
