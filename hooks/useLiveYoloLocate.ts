"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import {
  getYoloLoadError,
  isYoloAvailable,
  locateBarcodesFromVideo,
  YOLO_LIVE_IMGSZ,
  type YoloBox,
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
  fps: number;
  inferenceMs: number;
  status: LiveLocateStatus;
  error: string | null;
  clearBoxes: () => void;
}

interface TrackedBox extends LiveYoloBox {
  miss: number;
}

const MATCH_IOU = 0.3;
/** Keep drawing a box this many failed frames after last hit (anti-flicker). */
const MAX_MISS = 2;
/** Blend new detection into previous pose so the rect doesn't jump. */
const POS_BLEND = 0.7;

function boxIou(a: YoloBox, b: YoloBox): number {
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

function blend(prev: number, next: number): number {
  return prev * (1 - POS_BLEND) + next * POS_BLEND;
}

/**
 * Match detections to prior tracks by IoU, hold short misses, soft-blend pose.
 * Stops boxes from flashing on/off when YOLO briefly drops a code.
 */
function stabilizeTracks(
  previous: TrackedBox[],
  detections: YoloBox[],
  nextId: { current: number },
): TrackedBox[] {
  const usedPrev = new Set<number>();
  const usedDet = new Set<number>();
  const next: TrackedBox[] = [];

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
    next.push({
      id: prev.id,
      miss: 0,
      score: det.score,
      x: blend(prev.x, det.x),
      y: blend(prev.y, det.y),
      width: blend(prev.width, det.width),
      height: blend(prev.height, det.height),
    });
  }

  for (let di = 0; di < detections.length; di += 1) {
    if (usedDet.has(di)) {
      continue;
    }
    const det = detections[di]!;
    next.push({ id: nextId.current++, miss: 0, ...det });
  }

  for (let pi = 0; pi < previous.length; pi += 1) {
    if (usedPrev.has(pi)) {
      continue;
    }
    const prev = previous[pi]!;
    const miss = prev.miss + 1;
    if (miss <= MAX_MISS) {
      next.push({ ...prev, miss });
    }
  }

  return next;
}

export function useLiveYoloLocate({
  videoRef,
  enabled,
}: UseLiveYoloLocateOptions): UseLiveYoloLocateResult {
  const [boxes, setBoxes] = useState<LiveYoloBox[]>([]);
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

  enabledRef.current = enabled;

  const clearBoxes = () => {
    runGenerationRef.current += 1;
    tracksRef.current = [];
    setBoxes([]);
    setFps(0);
    setInferenceMs(0);
  };

  useEffect(() => {
    if (!enabled) {
      cancelAnimationFrame(rafRef.current);
      busyRef.current = false;
      runGenerationRef.current += 1;
      tracksRef.current = [];
      setBoxes([]);
      setFps(0);
      setInferenceMs(0);
      setStatus("idle");
      setError(null);
      return;
    }

    let cancelled = false;
    const generation = ++runGenerationRef.current;

    setStatus("loading-model");
    setError(null);

    isYoloAvailable()
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

        const tick = () => {
          if (cancelled || generation !== runGenerationRef.current) {
            return;
          }

          rafRef.current = requestAnimationFrame(tick);

          if (busyRef.current) {
            return;
          }

          const video = videoRef.current;
          if (!video || video.readyState < 2 || video.videoWidth < 2) {
            return;
          }

          busyRef.current = true;

          void (async () => {
            try {
              const started = performance.now();
              const detections = await locateBarcodesFromVideo(video, {
                imgsz: YOLO_LIVE_IMGSZ,
              });
              const elapsed = performance.now() - started;

              if (
                cancelled ||
                !enabledRef.current ||
                generation !== runGenerationRef.current
              ) {
                return;
              }

              tracksRef.current = stabilizeTracks(
                tracksRef.current,
                detections,
                nextIdRef,
              );

              const now = performance.now();
              const times = frameTimesRef.current;
              times.push(now);
              while (times.length > 0 && now - times[0]! > 1000) {
                times.shift();
              }

              setBoxes(
                tracksRef.current.map(({ id, x, y, width, height, score }) => ({
                  id,
                  x,
                  y,
                  width,
                  height,
                  score,
                })),
              );
              setInferenceMs(Math.round(elapsed));
              setFps(times.length);
              setError(null);
              setStatus("running");
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

  return { boxes, fps, inferenceMs, status, error, clearBoxes };
}
