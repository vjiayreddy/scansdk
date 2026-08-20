import { prepareZXingModule } from "barcode-detector/ponyfill";

import { prepareCanvasFromFile } from "./preprocess";
import { scanCanvas } from "./tile-scan";
import type { DetectedBarcode, ScanResult } from "./types";

let wasmPrepared = false;

function prepareWasm(): void {
  if (wasmPrepared) {
    return;
  }

  prepareZXingModule({
    overrides: {
      locateFile: (path, prefix) => {
        if (path.endsWith(".wasm")) {
          return `/wasm/${path}`;
        }
        return prefix + path;
      },
    },
  });

  wasmPrepared = true;
}

export function prewarmBarcodeDetector(): Promise<void> {
  prepareWasm();
  return Promise.resolve();
}

export function getBarcodeDetector(): Promise<void> {
  return prewarmBarcodeDetector();
}

export async function scanImage(file: File): Promise<ScanResult> {
  const start = performance.now();
  prepareWasm();

  const { canvas, originalSize } = await prepareCanvasFromFile(file);
  const barcodes = await scanCanvas(canvas);
  const scaledBarcodes = mapCanvasCoordsToOriginal(
    barcodes,
    canvas.width,
    canvas.height,
    originalSize.width,
    originalSize.height,
  );

  return {
    barcodes: scaledBarcodes,
    durationMs: Math.round(performance.now() - start),
    imageSize: originalSize,
  };
}

/** Map detection coords from the processed canvas back onto the original image. */
export function mapCanvasCoordsToOriginal(
  barcodes: DetectedBarcode[],
  canvasWidth: number,
  canvasHeight: number,
  originalWidth: number,
  originalHeight: number,
): DetectedBarcode[] {
  if (!canvasWidth || !canvasHeight) {
    return barcodes;
  }

  const scaleX = originalWidth / canvasWidth;
  const scaleY = originalHeight / canvasHeight;

  if (scaleX === 1 && scaleY === 1) {
    return barcodes;
  }

  return barcodes.map((barcode) => ({
    ...barcode,
    boundingBox: {
      x: barcode.boundingBox.x * scaleX,
      y: barcode.boundingBox.y * scaleY,
      width: barcode.boundingBox.width * scaleX,
      height: barcode.boundingBox.height * scaleY,
    },
    cornerPoints: barcode.cornerPoints.map((point) => ({
      x: point.x * scaleX,
      y: point.y * scaleY,
    })) as DetectedBarcode["cornerPoints"],
  }));
}
