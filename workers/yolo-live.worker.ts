/// <reference lib="webworker" />

/**
 * Live YOLO locate worker: letterbox ImageBitmap → ORT WASM → boxes.
 * Messages:
 *   { type: "init", modelUrl, imgsz, wasmPaths }
 *   { type: "locate", id, bitmap, sourceWidth, sourceHeight }  (bitmap transferred)
 * Responses:
 *   { type: "ready" } | { type: "error", message }
 *   { type: "result", id, boxes, inferenceMs } | { type: "error", id?, message }
 */

import {
  parseYoloOutputData,
  rgbaToChw,
  type YoloBox,
} from "../lib/barcode/yolo-core";

type InitMsg = {
  type: "init";
  modelUrl: string;
  imgsz: number;
  wasmPaths: string;
};

type LocateMsg = {
  type: "locate";
  id: number;
  bitmap: ImageBitmap;
  sourceWidth: number;
  sourceHeight: number;
};

type InMsg = InitMsg | LocateMsg;

type OutMsg =
  | { type: "ready" }
  | { type: "result"; id: number; boxes: YoloBox[]; inferenceMs: number }
  | { type: "error"; id?: number; message: string };

let session: import("onnxruntime-web").InferenceSession | null = null;
let ortMod: typeof import("onnxruntime-web/wasm") | null = null;
let imgsz = 960;
let pooledCanvas: OffscreenCanvas | null = null;
let pooledCtx: OffscreenCanvasRenderingContext2D | null = null;
let pooledTensor: Float32Array | null = null;

function ensurePool(size: number): {
  ctx: OffscreenCanvasRenderingContext2D;
  tensor: Float32Array;
} {
  if (!pooledCanvas || pooledCanvas.width !== size) {
    pooledCanvas = new OffscreenCanvas(size, size);
    pooledCtx = pooledCanvas.getContext("2d", { willReadFrequently: true });
    pooledTensor = new Float32Array(3 * size * size);
  }
  if (!pooledCtx || !pooledTensor) {
    throw new Error("OffscreenCanvas context unavailable");
  }
  return { ctx: pooledCtx, tensor: pooledTensor };
}

function letterboxBitmap(
  bitmap: ImageBitmap,
  size: number,
): { tensor: Float32Array; scale: number; padX: number; padY: number } {
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const scale = Math.min(size / sourceWidth, size / sourceHeight);
  const newWidth = Math.round(sourceWidth * scale);
  const newHeight = Math.round(sourceHeight * scale);
  const padX = (size - newWidth) / 2;
  const padY = (size - newHeight) / 2;

  const { ctx, tensor } = ensurePool(size);
  ctx.fillStyle = "rgb(114, 114, 114)";
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bitmap, padX, padY, newWidth, newHeight);

  const { data } = ctx.getImageData(0, 0, size, size);
  rgbaToChw(data, size, tensor);
  return { tensor, scale, padX, padY };
}

async function handleInit(msg: InitMsg): Promise<void> {
  imgsz = msg.imgsz;
  ortMod = await import("onnxruntime-web/wasm");
  ortMod.env.wasm.numThreads = 1;
  ortMod.env.wasm.proxy = false;
  ortMod.env.wasm.wasmPaths = msg.wasmPaths;

  const response = await fetch(msg.modelUrl);
  if (!response.ok) {
    throw new Error(`ONNX fetch failed (${response.status}) for ${msg.modelUrl}`);
  }
  const model = new Uint8Array(await response.arrayBuffer());
  session = await ortMod.InferenceSession.create(model, {
    executionProviders: ["wasm"],
  });
}

async function handleLocate(msg: LocateMsg): Promise<OutMsg> {
  if (!session || !ortMod) {
    return { type: "error", id: msg.id, message: "Worker session not ready" };
  }

  const started = performance.now();
  try {
    const { width: sw, height: sh } = {
      width: msg.sourceWidth || msg.bitmap.width,
      height: msg.sourceHeight || msg.bitmap.height,
    };
    const { tensor, scale, padX, padY } = letterboxBitmap(msg.bitmap, imgsz);
    const input = new ortMod.Tensor("float32", tensor, [1, 3, imgsz, imgsz]);
    const inputName = session.inputNames[0] ?? "images";
    const results = await session.run({ [inputName]: input });
    const outputName = session.outputNames[0];
    const output = outputName ? results[outputName] : Object.values(results)[0];

    if (!output) {
      return {
        type: "result",
        id: msg.id,
        boxes: [],
        inferenceMs: performance.now() - started,
      };
    }

    const boxes = parseYoloOutputData(
      output.data as Float32Array,
      output.dims,
      scale,
      padX,
      padY,
      sw,
      sh,
    );

    return {
      type: "result",
      id: msg.id,
      boxes,
      inferenceMs: performance.now() - started,
    };
  } finally {
    msg.bitmap.close();
  }
}

function post(msg: OutMsg): void {
  self.postMessage(msg);
}

self.onmessage = (event: MessageEvent<InMsg>) => {
  const data = event.data;
  void (async () => {
    try {
      if (data.type === "init") {
        await handleInit(data);
        post({ type: "ready" });
        return;
      }
      if (data.type === "locate") {
        post(await handleLocate(data));
      }
    } catch (err: unknown) {
      post({
        type: "error",
        id: data.type === "locate" ? data.id : undefined,
        message: err instanceof Error ? err.message : "Worker locate failed",
      });
    }
  })();
};

export {};
