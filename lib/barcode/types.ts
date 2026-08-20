import type { DetectedBarcode as LibraryDetectedBarcode } from "barcode-detector/ponyfill";

export type DetectedBarcode = Omit<LibraryDetectedBarcode, "boundingBox"> & {
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export interface ImageSize {
  width: number;
  height: number;
}

export interface ScanResult {
  barcodes: DetectedBarcode[];
  durationMs: number;
  imageSize: ImageSize;
}

export type ScannerStatus =
  | "idle"
  | "loading-wasm"
  | "scanning"
  | "done"
  | "error";

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
] as const;
