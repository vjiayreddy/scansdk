"use client";

import type { InferenceSession, Tensor } from "onnxruntime-web";

export const YOLO_IMGSZ = 960;
export const YOLO_CONF = 0.25;
export const YOLO_IOU = 0.45;
export const YOLO_MODEL_URL = "/models/barcode-yolo11n.onnx";

export interface YoloBox {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}

interface Letterbox {
  tensor: Float32Array;
  scale: number;
  padX: number;
  padY: number;
}

let sessionPromise: Promise<InferenceSession> | null = null;
let lastLoadError = "";

export function getYoloLoadError(): string {
  return lastLoadError;
}

async function createSession(): Promise<InferenceSession> {
  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;

  const response = await fetch(YOLO_MODEL_URL);
  if (!response.ok) {
    throw new Error(`ONNX fetch failed (${response.status}) for ${YOLO_MODEL_URL}`);
  }

  const model = new Uint8Array(await response.arrayBuffer());
  return ort.InferenceSession.create(model, {
    executionProviders: ["wasm"],
  });
}

async function loadSession(): Promise<InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = createSession().catch((error: unknown) => {
      sessionPromise = null;
      lastLoadError =
        error instanceof Error ? error.message : "YOLO session failed to start";
      throw error;
    });
  }

  return sessionPromise;
}

export async function isYoloAvailable(): Promise<boolean> {
  try {
    await loadSession();
    lastLoadError = "";
    return true;
  } catch {
    return false;
  }
}

function letterboxFromCanvas(
  source: HTMLCanvasElement,
  imgsz: number,
): Letterbox {
  const scale = Math.min(imgsz / source.width, imgsz / source.height);
  const newWidth = Math.round(source.width * scale);
  const newHeight = Math.round(source.height * scale);
  const padX = (imgsz - newWidth) / 2;
  const padY = (imgsz - newHeight) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = imgsz;
  canvas.height = imgsz;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }

  ctx.fillStyle = "rgb(114, 114, 114)";
  ctx.fillRect(0, 0, imgsz, imgsz);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, padX, padY, newWidth, newHeight);

  const { data } = ctx.getImageData(0, 0, imgsz, imgsz);
  const tensor = new Float32Array(3 * imgsz * imgsz);
  const plane = imgsz * imgsz;

  for (let index = 0; index < plane; index += 1) {
    const pixel = index * 4;
    tensor[index] = data[pixel] / 255;
    tensor[plane + index] = data[pixel + 1] / 255;
    tensor[2 * plane + index] = data[pixel + 2] / 255;
  }

  return { tensor, scale, padX, padY };
}

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

function nms(boxes: YoloBox[], iouThresh: number): YoloBox[] {
  const ordered = [...boxes].sort((a, b) => b.score - a.score);
  const kept: YoloBox[] = [];

  for (const box of ordered) {
    if (kept.every((existing) => boxIou(existing, box) < iouThresh)) {
      kept.push(box);
    }
  }

  return kept;
}

function parseYoloOutput(
  output: Tensor,
  scale: number,
  padX: number,
  padY: number,
  canvasWidth: number,
  canvasHeight: number,
): YoloBox[] {
  const data = output.data as Float32Array;
  const dims = output.dims;
  let channels = 5;
  let count = 0;
  let channelMajor = true;

  if (dims.length === 3 && dims[1] === 5) {
    count = dims[2];
    channelMajor = true;
  } else if (dims.length === 3 && dims[2] === 5) {
    count = dims[1];
    channelMajor = false;
  } else if (dims.length === 2 && dims[0] === 5) {
    count = dims[1];
    channelMajor = true;
  } else {
    return [];
  }

  const boxes: YoloBox[] = [];

  for (let index = 0; index < count; index += 1) {
    const cx = channelMajor ? data[index] : data[index * channels];
    const cy = channelMajor ? data[count + index] : data[index * channels + 1];
    const width = channelMajor
      ? data[2 * count + index]
      : data[index * channels + 2];
    const height = channelMajor
      ? data[3 * count + index]
      : data[index * channels + 3];
    const score = channelMajor
      ? data[4 * count + index]
      : data[index * channels + 4];

    if (score < YOLO_CONF) {
      continue;
    }

    const x = (cx - width / 2 - padX) / scale;
    const y = (cy - height / 2 - padY) / scale;
    const mappedWidth = width / scale;
    const mappedHeight = height / scale;

    boxes.push({
      x: Math.max(0, x),
      y: Math.max(0, y),
      width: Math.min(mappedWidth, canvasWidth - Math.max(0, x)),
      height: Math.min(mappedHeight, canvasHeight - Math.max(0, y)),
      score,
    });
  }

  return nms(
    boxes.filter((box) => box.width >= 2 && box.height >= 2),
    YOLO_IOU,
  );
}

/** Locate barcodes on a prepared canvas. Boxes are in canvas pixels. */
export async function locateBarcodes(
  source: HTMLCanvasElement,
): Promise<YoloBox[]> {
  const session = await loadSession();
  const ort = await import("onnxruntime-web/wasm");
  const { tensor, scale, padX, padY } = letterboxFromCanvas(source, YOLO_IMGSZ);
  const input = new ort.Tensor("float32", tensor, [1, 3, YOLO_IMGSZ, YOLO_IMGSZ]);
  const inputName = session.inputNames[0] ?? "images";
  const results = await session.run({ [inputName]: input });
  const outputName = session.outputNames[0];
  const output = outputName ? results[outputName] : Object.values(results)[0];

  if (!output) {
    return [];
  }

  return parseYoloOutput(
    output,
    scale,
    padX,
    padY,
    source.width,
    source.height,
  );
}
