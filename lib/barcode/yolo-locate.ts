"use client";

import type { InferenceSession, Tensor } from "onnxruntime-web";

import {
  YOLO_IMGSZ,
  YOLO_LIVE_IMGSZ,
  YOLO_LIVE_MODEL_URL,
  YOLO_MODEL_URL,
  YOLO_TILE_GRID_HARD,
  YOLO_TILE_GRID_NORMAL,
  YOLO_TILE_MIN_LONG_SIDE,
  YOLO_TILE_OVERLAP,
  YOLO_WASM_PATHS,
} from "@/lib/barcode/yolo-config";
import {
  nms,
  parseYoloOutputData,
  rgbaToChw,
  YOLO_IOU,
  type YoloBox,
} from "@/lib/barcode/yolo-core";
import {
  isLiveWorkerReady,
  locateBarcodesViaWorker,
  warmLiveYoloWorker,
} from "@/lib/barcode/yolo-live-worker";

export type { YoloBox } from "@/lib/barcode/yolo-core";
export {
  YOLO_IMGSZ,
  YOLO_LIVE_IMGSZ,
  YOLO_LIVE_MODEL_URL,
  YOLO_MODEL_URL,
  YOLO_WASM_PATHS,
} from "@/lib/barcode/yolo-config";
export { YOLO_CONF, YOLO_IOU } from "@/lib/barcode/yolo-core";

export type YoloModelKind = "upload" | "live";

export interface LocateBarcodesOptions {
  /** Model input size; must match the ONNX graph for that kind. */
  imgsz?: number;
  /**
   * Overlapping YOLO tiles after full-frame (upload only).
   * - `auto` (default): tile when long side ≥ YOLO_TILE_MIN_LONG_SIDE
   * - `true` / `false`: force on/off
   */
  tiled?: boolean | "auto";
  /** Hard mode uses a denser 3×3 tile grid. */
  hard?: boolean;
}

interface Letterbox {
  tensor: Float32Array;
  scale: number;
  padX: number;
  padY: number;
}

type LetterboxSource =
  | HTMLCanvasElement
  | HTMLVideoElement
  | OffscreenCanvas
  | ImageBitmap;

interface ModelConfig {
  url: string;
  imgsz: number;
}

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MODEL: Record<YoloModelKind, ModelConfig> = {
  upload: { url: YOLO_MODEL_URL, imgsz: YOLO_IMGSZ },
  live: { url: YOLO_LIVE_MODEL_URL, imgsz: YOLO_LIVE_IMGSZ },
};

const sessionPromises = new Map<YoloModelKind, Promise<InferenceSession>>();
let lastLoadError = "";

/** Reused across frames to avoid alloc/GC every inference. */
let pooledCanvas: HTMLCanvasElement | null = null;
let pooledCtx: CanvasRenderingContext2D | null = null;
let pooledTensor: Float32Array | null = null;
let pooledImgsz = 0;

export function getYoloLoadError(): string {
  return lastLoadError;
}

async function createSession(kind: YoloModelKind): Promise<InferenceSession> {
  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.numThreads = 1;
  // Live prefers dedicated worker; upload stays on main with proxy off.
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = YOLO_WASM_PATHS;

  const { url } = MODEL[kind];
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`ONNX fetch failed (${response.status}) for ${url}`);
  }

  const model = new Uint8Array(await response.arrayBuffer());
  return ort.InferenceSession.create(model, {
    executionProviders: ["wasm"],
  });
}

async function loadSession(kind: YoloModelKind): Promise<InferenceSession> {
  let promise = sessionPromises.get(kind);
  if (!promise) {
    promise = createSession(kind).catch((error: unknown) => {
      sessionPromises.delete(kind);
      lastLoadError =
        error instanceof Error ? error.message : "YOLO session failed to start";
      throw error;
    });
    sessionPromises.set(kind, promise);
  }
  return promise;
}

export async function isYoloAvailable(
  kind: YoloModelKind = "upload",
): Promise<boolean> {
  try {
    if (kind === "live") {
      await warmLiveYoloWorker();
      if (isLiveWorkerReady()) {
        lastLoadError = "";
        return true;
      }
      // Fall through to main-thread live session.
    }
    await loadSession(kind);
    lastLoadError = "";
    return true;
  } catch {
    return false;
  }
}

function getSourceSize(source: LetterboxSource): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  return { width: source.width, height: source.height };
}

function ensureLetterboxPool(imgsz: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tensor: Float32Array;
} {
  if (!pooledCanvas || pooledImgsz !== imgsz) {
    pooledCanvas = document.createElement("canvas");
    pooledCanvas.width = imgsz;
    pooledCanvas.height = imgsz;
    pooledCtx = pooledCanvas.getContext("2d", { willReadFrequently: true });
    pooledTensor = new Float32Array(3 * imgsz * imgsz);
    pooledImgsz = imgsz;
  }

  if (!pooledCtx || !pooledTensor) {
    throw new Error("Canvas context unavailable");
  }

  return { canvas: pooledCanvas, ctx: pooledCtx, tensor: pooledTensor };
}

function letterboxFromSource(
  source: LetterboxSource,
  imgsz: number,
  region?: Region,
): Letterbox {
  const full = getSourceSize(source);
  const sourceWidth = region?.width ?? full.width;
  const sourceHeight = region?.height ?? full.height;
  if (sourceWidth < 2 || sourceHeight < 2) {
    throw new Error("Letterbox source has invalid dimensions");
  }

  const scale = Math.min(imgsz / sourceWidth, imgsz / sourceHeight);
  const newWidth = Math.round(sourceWidth * scale);
  const newHeight = Math.round(sourceHeight * scale);
  const padX = (imgsz - newWidth) / 2;
  const padY = (imgsz - newHeight) / 2;

  const { ctx, tensor } = ensureLetterboxPool(imgsz);

  ctx.fillStyle = "rgb(114, 114, 114)";
  ctx.fillRect(0, 0, imgsz, imgsz);
  ctx.imageSmoothingEnabled = true;
  if (region) {
    ctx.drawImage(
      source,
      region.x,
      region.y,
      region.width,
      region.height,
      padX,
      padY,
      newWidth,
      newHeight,
    );
  } else {
    ctx.drawImage(source, padX, padY, newWidth, newHeight);
  }

  const { data } = ctx.getImageData(0, 0, imgsz, imgsz);
  rgbaToChw(data, imgsz, tensor);

  return { tensor, scale, padX, padY };
}

function parseYoloOutput(
  output: Tensor,
  scale: number,
  padX: number,
  padY: number,
  canvasWidth: number,
  canvasHeight: number,
): YoloBox[] {
  return parseYoloOutputData(
    output.data as Float32Array,
    output.dims,
    scale,
    padX,
    padY,
    canvasWidth,
    canvasHeight,
  );
}

async function runLocateRegion(
  source: LetterboxSource,
  kind: YoloModelKind,
  region?: Region,
): Promise<YoloBox[]> {
  const imgsz = MODEL[kind].imgsz;
  const regionWidth = region?.width ?? getSourceSize(source).width;
  const regionHeight = region?.height ?? getSourceSize(source).height;
  const session = await loadSession(kind);
  const ort = await import("onnxruntime-web/wasm");
  const { tensor, scale, padX, padY } = letterboxFromSource(
    source,
    imgsz,
    region,
  );
  const input = new ort.Tensor("float32", tensor, [1, 3, imgsz, imgsz]);
  const inputName = session.inputNames[0] ?? "images";
  const results = await session.run({ [inputName]: input });
  const outputName = session.outputNames[0];
  const output = outputName ? results[outputName] : Object.values(results)[0];

  if (!output) {
    return [];
  }

  const boxes = parseYoloOutput(
    output,
    scale,
    padX,
    padY,
    regionWidth,
    regionHeight,
  );

  if (!region) {
    return boxes;
  }

  return boxes.map((box) => ({
    ...box,
    x: box.x + region.x,
    y: box.y + region.y,
  }));
}

async function runLocate(
  source: LetterboxSource,
  kind: YoloModelKind,
): Promise<YoloBox[]> {
  return runLocateRegion(source, kind);
}

/** Build overlapping tile regions covering the canvas. */
export function buildYoloTileRegions(
  width: number,
  height: number,
  grid: number,
  overlap = YOLO_TILE_OVERLAP,
): Region[] {
  if (grid < 2 || width < 2 || height < 2) {
    return [];
  }

  const denom = grid - (grid - 1) * overlap;
  const tileW = Math.min(width, Math.ceil(width / denom));
  const tileH = Math.min(height, Math.ceil(height / denom));
  const stepX = grid === 1 ? 0 : (width - tileW) / (grid - 1);
  const stepY = grid === 1 ? 0 : (height - tileH) / (grid - 1);
  const regions: Region[] = [];

  for (let row = 0; row < grid; row += 1) {
    for (let col = 0; col < grid; col += 1) {
      const x = Math.round(col * stepX);
      const y = Math.round(row * stepY);
      regions.push({
        x,
        y,
        width: Math.min(tileW, width - x),
        height: Math.min(tileH, height - y),
      });
    }
  }

  return regions;
}

function shouldTile(
  width: number,
  height: number,
  tiled: boolean | "auto" | undefined,
): boolean {
  if (tiled === true) {
    return true;
  }
  if (tiled === false) {
    return false;
  }
  return Math.max(width, height) >= YOLO_TILE_MIN_LONG_SIDE;
}

/**
 * Full-frame locate, then optional overlapping tiles for small-code recall.
 * Boxes are in canvas pixels.
 */
export async function locateBarcodes(
  source: HTMLCanvasElement,
  options?: LocateBarcodesOptions,
): Promise<YoloBox[]> {
  const full = await runLocate(source, "upload");
  const { width, height } = source;

  if (!shouldTile(width, height, options?.tiled)) {
    return full;
  }

  const grid = options?.hard ? YOLO_TILE_GRID_HARD : YOLO_TILE_GRID_NORMAL;
  const regions = buildYoloTileRegions(width, height, grid);
  const tiledBoxes: YoloBox[] = [];

  for (const region of regions) {
    if (region.width < 32 || region.height < 32) {
      continue;
    }
    const boxes = await runLocateRegion(source, "upload", region);
    tiledBoxes.push(...boxes);
  }

  return nms([...full, ...tiledBoxes], YOLO_IOU);
}

/**
 * Locate barcodes directly from a video element.
 * Prefers the live Web Worker; falls back to main-thread session.
 * Boxes are in video intrinsic pixels. (No tiling — keep live fast.)
 */
export async function locateBarcodesFromVideo(
  video: HTMLVideoElement,
  options?: LocateBarcodesOptions,
): Promise<YoloBox[]> {
  void options;
  if (video.readyState < 2 || video.videoWidth < 2) {
    return [];
  }

  try {
    await warmLiveYoloWorker();
    if (isLiveWorkerReady()) {
      return await locateBarcodesViaWorker(video);
    }
  } catch {
    // Fall through to main-thread live model.
  }

  return runLocate(video, "live");
}
