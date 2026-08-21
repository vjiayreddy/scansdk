import type { DetectedBarcode as LibraryDetectedBarcode } from "barcode-detector/ponyfill";

export type DetectedBarcode = Omit<LibraryDetectedBarcode, "boundingBox"> & {
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type BarcodeStatus = "read" | "unread";

export type ScanDetection = DetectedBarcode & {
  status: BarcodeStatus;
  score?: number;
  source?: "yolo" | "zxing-full" | "proposal";
};

export interface ImageSize {
  width: number;
  height: number;
}

export interface ScanResult {
  barcodes: ScanDetection[];
  durationMs: number;
  imageSize: ImageSize;
}

export type ScannerStatus =
  | "idle"
  | "loading-wasm"
  | "scanning"
  | "scanning-hard"
  | "done"
  | "error";

/** Normal = fast 2.8s budget; hard = blur + perspective passes (~8.8s). */
export type ScanMode = "normal" | "hard";

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
] as const;
