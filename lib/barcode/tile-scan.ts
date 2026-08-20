import { readBarcodes } from "zxing-wasm/reader";

import type { DetectedBarcode } from "./types";

import { dedupeBarcodes, mapReadResult } from "./map-result";
import { ENHANCED_READER_OPTIONS } from "./reader-options";
import { TILE_GRID_SIZE, TILE_OVERLAP } from "./preprocess";

async function scanImageData(
  imageData: ImageData,
  offsetX: number,
  offsetY: number,
): Promise<DetectedBarcode[]> {
  const results = await readBarcodes(imageData, ENHANCED_READER_OPTIONS);

  return results
    .filter((result) => result.isValid && result.text.length > 0)
    .map((result) => mapReadResult(result, offsetX, offsetY));
}

async function scanCanvasTiles(
  canvas: HTMLCanvasElement,
  scanRegion: (
    imageData: ImageData,
    offsetX: number,
    offsetY: number,
  ) => Promise<DetectedBarcode[]>,
): Promise<DetectedBarcode[]> {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }

  const results: DetectedBarcode[] = [];
  const tileWidth = canvas.width / TILE_GRID_SIZE;
  const tileHeight = canvas.height / TILE_GRID_SIZE;
  const overlapX = tileWidth * TILE_OVERLAP;
  const overlapY = tileHeight * TILE_OVERLAP;

  for (let row = 0; row < TILE_GRID_SIZE; row += 1) {
    for (let col = 0; col < TILE_GRID_SIZE; col += 1) {
      const x = Math.max(0, Math.floor(col * tileWidth - overlapX));
      const y = Math.max(0, Math.floor(row * tileHeight - overlapY));
      const right = Math.min(
        canvas.width,
        Math.ceil((col + 1) * tileWidth + overlapX),
      );
      const bottom = Math.min(
        canvas.height,
        Math.ceil((row + 1) * tileHeight + overlapY),
      );
      const width = right - x;
      const height = bottom - y;

      if (width <= 0 || height <= 0) {
        continue;
      }

      const tileData = ctx.getImageData(x, y, width, height);
      const tileResults = await scanRegion(tileData, x, y);
      results.push(...tileResults);
    }
  }

  return dedupeBarcodes(results);
}

export async function scanCanvas(
  canvas: HTMLCanvasElement,
): Promise<DetectedBarcode[]> {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }

  const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const fullScan = dedupeBarcodes(await scanImageData(fullImageData, 0, 0));

  if (fullScan.length >= 3) {
    return fullScan;
  }

  const tileScan = await scanCanvasTiles(canvas, scanImageData);
  return dedupeBarcodes([...fullScan, ...tileScan]);
}
