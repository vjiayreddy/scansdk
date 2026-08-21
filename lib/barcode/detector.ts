import { prepareZXingModule } from "barcode-detector/ponyfill";

import { scanLocatedRegions } from "./crop-scan";
import { prepareCanvasFromFile } from "./preprocess";
import { createDeadlineForMode } from "./scan-budget";
import { scanCanvas } from "./tile-scan";
import type {
  DetectedBarcode,
  ScanDetection,
  ScanMode,
  ScanResult,
} from "./types";
import { getYoloLoadError, isYoloAvailable, locateBarcodes, type YoloBox } from "./yolo-locate";

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
  void isYoloAvailable();
  return Promise.resolve();
}

export function getBarcodeDetector(): Promise<void> {
  return prewarmBarcodeDetector();
}

function detectionIou(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
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

function yoloBoxToDetection(
  box: YoloBox,
  status: Extract<ScanDetection["status"], "unread" | "located">,
): ScanDetection {
  const x2 = box.x + box.width;
  const y2 = box.y + box.height;

  return {
    rawValue: "",
    format: "unknown" as DetectedBarcode["format"],
    boundingBox: {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    },
    cornerPoints: [
      { x: box.x, y: box.y },
      { x: x2, y: box.y },
      { x: x2, y: y2 },
      { x: box.x, y: y2 },
    ] as DetectedBarcode["cornerPoints"],
    status,
    score: box.score,
    source: "yolo",
  };
}

function asRead(
  barcode: DetectedBarcode,
  source: ScanDetection["source"],
  score?: number,
): ScanDetection {
  return {
    ...barcode,
    status: "read",
    source,
    score,
  };
}

function mergeYoloAndDecoded(
  located: YoloBox[],
  decoded: DetectedBarcode[],
): ScanDetection[] {
  const usedDecoded = new Set<number>();
  const detections: ScanDetection[] = [];

  for (const box of located) {
    let bestIndex = -1;
    let bestIou = 0.2;

    for (let index = 0; index < decoded.length; index += 1) {
      if (usedDecoded.has(index)) {
        continue;
      }

      const iou = detectionIou(box, decoded[index].boundingBox);
      if (iou > bestIou) {
        bestIou = iou;
        bestIndex = index;
      }
    }

    if (bestIndex >= 0) {
      usedDecoded.add(bestIndex);
      detections.push(asRead(decoded[bestIndex], "yolo", box.score));
    } else {
      detections.push(yoloBoxToDetection(box, "unread"));
    }
  }

  for (let index = 0; index < decoded.length; index += 1) {
    if (!usedDecoded.has(index)) {
      detections.push(asRead(decoded[index], "zxing-full"));
    }
  }

  return detections;
}

async function scanWithYolo(
  canvas: HTMLCanvasElement,
  mode: ScanMode,
): Promise<ScanDetection[] | null> {
  const located = await locateBarcodes(canvas);
  if (located.length === 0) {
    return null;
  }

  const deadline = createDeadlineForMode(mode);
  const decoded = await scanLocatedRegions(canvas, located, deadline, {
    hardMode: mode === "hard",
  });

  return mergeYoloAndDecoded(located, decoded);
}

export async function scanImage(
  file: File,
  mode: ScanMode = "normal",
): Promise<ScanResult> {
  const start = performance.now();
  prepareWasm();

  const { canvas, originalSize } = await prepareCanvasFromFile(file);

  if (mode === "locate") {
    const available = await isYoloAvailable();
    if (!available) {
      throw new Error(
        getYoloLoadError() ||
          "YOLO model failed to load. Check /models/barcode-yolo11n.onnx.",
      );
    }

    const located = await locateBarcodes(canvas);
    const barcodes = mapCanvasCoordsToOriginal(
      located.map((box) => yoloBoxToDetection(box, "located")),
      canvas.width,
      canvas.height,
      originalSize.width,
      originalSize.height,
    );

    return {
      barcodes,
      durationMs: Math.round(performance.now() - start),
      imageSize: originalSize,
    };
  }

  const yoloDetections = await scanWithYolo(canvas, mode);
  const barcodes: ScanDetection[] =
    yoloDetections ??
    (await scanCanvas(canvas, { mode })).map((barcode) =>
      asRead(barcode, "proposal"),
    );

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
export function mapCanvasCoordsToOriginal<T extends DetectedBarcode>(
  barcodes: T[],
  canvasWidth: number,
  canvasHeight: number,
  originalWidth: number,
  originalHeight: number,
): T[] {
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
