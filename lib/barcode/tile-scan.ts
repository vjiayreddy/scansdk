import { readBarcodes } from "zxing-wasm/reader";

import type { DetectedBarcode } from "./types";

import { scanCanvasCrops, scanUniformCrops } from "./crop-scan";
import { dedupeBarcodes, mapReadResult } from "./map-result";
import { MULTI_DETECT_THRESHOLD } from "./preprocess";
import {
  ENHANCED_READER_OPTIONS,
  FAST_DATAMATRIX_OPTIONS,
} from "./reader-options";
import {
  createDeadline,
  isExpired,
  remainingMs,
  yieldToUi,
} from "./scan-budget";

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

export async function scanCanvas(
  canvas: HTMLCanvasElement,
): Promise<DetectedBarcode[]> {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }

  const deadline = createDeadline();
  const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let fullScan = dedupeBarcodes(
    await scanImageData(fullImageData, 0, 0, FAST_DATAMATRIX_OPTIONS),
  );

  if (fullScan.length === 0 && remainingMs(deadline) > 400) {
    fullScan = dedupeBarcodes(
      await scanImageData(fullImageData, 0, 0, ENHANCED_READER_OPTIONS),
    );
  }

  if (fullScan.length >= MULTI_DETECT_THRESHOLD || isExpired(deadline)) {
    return fullScan;
  }

  await yieldToUi();

  const cropScan = await scanCanvasCrops(canvas, fullScan, deadline);
  const merged = dedupeBarcodes([...fullScan, ...cropScan]);

  if (
    merged.length >= MULTI_DETECT_THRESHOLD ||
    isExpired(deadline) ||
    remainingMs(deadline) < 350
  ) {
    return merged;
  }

  const uniformScan = await scanUniformCrops(canvas, deadline);
  return dedupeBarcodes([...merged, ...uniformScan]);
}
