"use client";

import type { LiveDecodeHit } from "@/workers/zxing-live.worker";
import { detectNativeBarcodes } from "@/lib/barcode/native-barcode-detector";

type WorkerReady = { type: "ready" };
type WorkerResult = { type: "result"; id: number; hits: LiveDecodeHit[] };
type WorkerError = { type: "error"; id?: number; message: string };
type WorkerOut = WorkerReady | WorkerResult | WorkerError;

type Pending = {
  resolve: (hits: LiveDecodeHit[]) => void;
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
      entry.resolve(data.hits);
    }
  }
}

function createWorker(): Worker {
  const next = new Worker(
    new URL("../../workers/zxing-live.worker.ts", import.meta.url),
    { type: "module" },
  );
  next.onmessage = handleMessage;
  next.onerror = () => {
    ready = false;
    rejectAll("Live decode worker crashed");
    worker = null;
    readyPromise = null;
  };
  return next;
}

export async function warmZxingLiveWorker(): Promise<boolean> {
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
          reject(new Error("Live decode worker init timed out"));
        }, 45_000);

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
        wasmBaseUrl: new URL("/wasm/", window.location.origin).href,
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

export function isZxingLiveWorkerReady(): boolean {
  return ready && worker !== null;
}

/** Optional native BarcodeDetector boost before WASM (main thread, small crop). */
async function tryNativeDetector(
  bitmap: ImageBitmap,
): Promise<LiveDecodeHit[]> {
  return detectNativeBarcodes(bitmap);
}

/**
 * Decode one crop bitmap off the main thread (native try → zxing worker).
 * Consumes/closes the bitmap.
 */
export async function decodeCropBitmap(
  bitmap: ImageBitmap,
  escalate: boolean,
): Promise<LiveDecodeHit[]> {
  const native = await tryNativeDetector(bitmap);
  if (native.length > 0) {
    bitmap.close();
    return native;
  }

  const ok = await warmZxingLiveWorker();
  if (!ok || !worker) {
    bitmap.close();
    throw new Error("Live decode worker unavailable");
  }

  const id = nextId++;
  return new Promise<LiveDecodeHit[]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      worker!.postMessage({ type: "decode", id, bitmap, escalate }, [bitmap]);
    } catch (err: unknown) {
      pending.delete(id);
      try {
        bitmap.close();
      } catch {
        // ignore
      }
      reject(err instanceof Error ? err : new Error("Failed to post decode"));
    }
  });
}
