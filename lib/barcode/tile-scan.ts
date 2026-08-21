import { readBarcodes } from "zxing-wasm/reader";

import type { DetectedBarcode, ScanMode } from "./types";

import { scanCanvasCrops, scanUniformCrops } from "./crop-scan";
import { dedupeBarcodes, mapReadResult } from "./map-result";
import { MULTI_DETECT_THRESHOLD, upscaleCanvas } from "./preprocess";
import {
  ENHANCED_READER_OPTIONS,
  FAST_DATAMATRIX_OPTIONS,
} from "./reader-options";
import { analyzeScene } from "./scene-analysis";
import {
  createDeadline,
  createDeadlineForMode,
  isExpired,
  remainingMs,
  SPARSE_SCAN_BUDGET_MS,
  yieldToUi,
} from "./scan-budget";

export interface ScanCanvasOptions {
  mode?: ScanMode;
}

async function scanImageData(
  imageData: ImageData,
  offsetX: number,
  offsetY: number,
  options = FAST_DATAMATRIX_OPTIONS,
): Promise<DetectedBarcode[]> {
  const results = await readBarcodes(imageData, options);

  return results
    .filter((result) => result.isValid && result.text.length > 0)
    .map((result) => mapReadResult(result, offsetX, offsetY));
}

function rescaleBarcodes(
  barcodes: DetectedBarcode[],
  scale: number,
): DetectedBarcode[] {
  if (scale === 1) {
    return barcodes;
  }

  return barcodes.map((barcode) => ({
    ...barcode,
    boundingBox: {
      x: barcode.boundingBox.x * scale,
      y: barcode.boundingBox.y * scale,
      width: barcode.boundingBox.width * scale,
      height: barcode.boundingBox.height * scale,
    },
    cornerPoints: barcode.cornerPoints.map((point) => ({
      x: point.x * scale,
      y: point.y * scale,
    })) as DetectedBarcode["cornerPoints"],
  }));
}

function prepareWorkCanvas(
  canvas: HTMLCanvasElement,
  sparse: boolean,
  hardMode: boolean,
): { canvas: HTMLCanvasElement; coordScale: number } {
  const longest = Math.max(canvas.width, canvas.height);
  const shouldUpscale =
    (sparse || hardMode) && longest >= 900 && longest <= 3600;

  if (!shouldUpscale) {
    return { canvas, coordScale: 1 };
  }

  const factor = longest >= 1800 ? 1.35 : 1.5;
  return {
    canvas: upscaleCanvas(canvas, factor),
    coordScale: 1 / factor,
  };
}

export async function scanCanvas(
  canvas: HTMLCanvasElement,
  options: ScanCanvasOptions = {},
): Promise<DetectedBarcode[]> {
  const mode = options.mode ?? "normal";
  const hardMode = mode === "hard";
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }

  let deadline = createDeadlineForMode(mode);
  const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let fullScan = dedupeBarcodes(
    await scanImageData(fullImageData, 0, 0, FAST_DATAMATRIX_OPTIONS),
  );

  if (
    (fullScan.length === 0 || hardMode) &&
    remainingMs(deadline) > 400
  ) {
    fullScan = dedupeBarcodes(
      await scanImageData(fullImageData, 0, 0, ENHANCED_READER_OPTIONS),
    );
  }

  const scene = analyzeScene(canvas.width, canvas.height, fullScan, hardMode);
  if (scene.sparse && !hardMode) {
    deadline = createDeadline(SPARSE_SCAN_BUDGET_MS);
  }
  const targetThreshold = hardMode
    ? Math.max(3, MULTI_DETECT_THRESHOLD - 2)
    : scene.sparse
      ? Math.max(4, MULTI_DETECT_THRESHOLD - 1)
      : MULTI_DETECT_THRESHOLD;

  if (
    !scene.sparse &&
    (fullScan.length >= targetThreshold || isExpired(deadline))
  ) {
    return fullScan;
  }

  await yieldToUi();

  const { canvas: workCanvas, coordScale } = prepareWorkCanvas(
    canvas,
    scene.sparse,
    hardMode,
  );
  const workHits = rescaleBarcodes(fullScan, coordScale === 1 ? 1 : 1 / coordScale);

  const cropScan = rescaleBarcodes(
    await scanCanvasCrops(workCanvas, workHits, deadline, {
      hardMode,
    }),
    coordScale,
  );
  let merged = dedupeBarcodes([...fullScan, ...cropScan]);

  if (
    !scene.sparse &&
    (merged.length >= targetThreshold ||
      isExpired(deadline) ||
      remainingMs(deadline) < 350)
  ) {
    return merged;
  }

  const uniformScan = rescaleBarcodes(
    await scanUniformCrops(
      workCanvas,
      deadline,
      { hardMode },
      rescaleBarcodes(merged, coordScale === 1 ? 1 : 1 / coordScale),
    ),
    coordScale,
  );
  merged = dedupeBarcodes([...merged, ...uniformScan]);

  if (
    scene.sparse &&
    !isExpired(deadline) &&
    remainingMs(deadline) > 500 &&
    merged.length < targetThreshold
  ) {
    await yieldToUi();
    const retryCrops = rescaleBarcodes(
      await scanCanvasCrops(
        workCanvas,
        rescaleBarcodes(merged, coordScale === 1 ? 1 : 1 / coordScale),
        deadline,
        {
          hardMode: true,
        },
      ),
      coordScale,
    );
    merged = dedupeBarcodes([...merged, ...retryCrops]);
  }

  return merged;
}
