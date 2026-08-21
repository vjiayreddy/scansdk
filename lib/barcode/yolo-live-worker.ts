"use client";

import {
  YOLO_LIVE_IMGSZ,
  YOLO_LIVE_MODEL_URL,
  YOLO_WASM_PATHS,
} from "@/lib/barcode/yolo-config";
import type { YoloBox } from "@/lib/barcode/yolo-core";

type WorkerReady = { type: "ready" };
type WorkerResult = {
  type: "result";
  id: number;
  boxes: YoloBox[];
  inferenceMs: number;
};
type WorkerError = { type: "error"; id?: number; message: string };
type WorkerOut = WorkerReady | WorkerResult | WorkerError;

type Pending = {
  resolve: (boxes: YoloBox[]) => void;
  reject: (error: Error) => void;
};

let worker: Worker | null = null;
let readyPromise: Promise<boolean> | null = null;
let ready = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function rejectAll(message: string): void {
  for (const [id, entry] of pending) {
    entry.reject(new Error(message));
    pending.delete(id);
  }
}

function handleMessage(event: MessageEvent<WorkerOut>): void {
  const data = event.data;
  if (data.type === "ready") {
    ready = true;
    return;
  }
  if (data.type === "error") {
    if (data.id !== undefined) {
      const entry = pending.get(data.id);
      if (entry) {
        pending.delete(data.id);
        entry.reject(new Error(data.message));
      }
    }
    return;
  }
  if (data.type === "result") {
    const entry = pending.get(data.id);
    if (entry) {
      pending.delete(data.id);
      entry.resolve(data.boxes);
    }
  }
}

function createWorker(): Worker {
  const next = new Worker(
    new URL("../../workers/yolo-live.worker.ts", import.meta.url),
    { type: "module" },
  );
  next.onmessage = handleMessage;
  next.onerror = () => {
    ready = false;
    rejectAll("Live YOLO worker crashed");
    worker = null;
    readyPromise = null;
  };
  return next;
}

/** Warm the live locate worker (idempotent). Returns true if ready. */
export async function warmLiveYoloWorker(): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }
  if (ready && worker) {
    return true;
  }
  if (readyPromise) {
    return readyPromise;
  }

  readyPromise = (async () => {
    try {
      worker = createWorker();
      const initWait = new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          reject(new Error("Live YOLO worker init timed out"));
        }, 60_000);

        const prev = worker!.onmessage;
        worker!.onmessage = (event: MessageEvent<WorkerOut>) => {
          if (event.data.type === "ready") {
            window.clearTimeout(timeout);
            worker!.onmessage = prev;
            handleMessage(event);
            resolve();
            return;
          }
          if (event.data.type === "error" && event.data.id === undefined) {
            window.clearTimeout(timeout);
            worker!.onmessage = prev;
            reject(new Error(event.data.message));
            return;
          }
          handleMessage(event);
        };
      });

      worker.postMessage({
        type: "init",
        modelUrl: new URL(YOLO_LIVE_MODEL_URL, window.location.origin).href,
        imgsz: YOLO_LIVE_IMGSZ,
        wasmPaths: new URL(YOLO_WASM_PATHS, window.location.origin).href,
      });

      await initWait;
      ready = true;
      return true;
    } catch {
      ready = false;
      try {
        worker?.terminate();
      } catch {
        // ignore
      }
      worker = null;
      readyPromise = null;
      return false;
    }
  })();

  return readyPromise;
}

export function isLiveWorkerReady(): boolean {
  return ready && worker !== null;
}

/**
 * Capture the current video frame and run live YOLO in the worker.
 * Transfers ImageBitmap so letterbox + CHW + inference stay off the UI thread.
 */
export async function locateBarcodesViaWorker(
  video: HTMLVideoElement,
): Promise<YoloBox[]> {
  const ok = await warmLiveYoloWorker();
  if (!ok || !worker) {
    throw new Error("Live YOLO worker unavailable");
  }

  const bitmap = await createImageBitmap(video);
  const id = nextId++;

  return new Promise<YoloBox[]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      worker!.postMessage(
        {
          type: "locate",
          id,
          bitmap,
          sourceWidth: video.videoWidth,
          sourceHeight: video.videoHeight,
        },
        [bitmap],
      );
    } catch (err: unknown) {
      pending.delete(id);
      try {
        bitmap.close();
      } catch {
        // ignore
      }
      reject(err instanceof Error ? err : new Error("Failed to post to worker"));
    }
  });
}
