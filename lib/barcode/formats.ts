import type { BarcodeFormat } from "barcode-detector/ponyfill";

/** All supported formats including Data Matrix, QR, EAN, UPC, Code128, PDF417, Aztec, etc. */
export const DETECTION_FORMATS: BarcodeFormat[] = ["any"];

export const DETECTION_FORMAT_LABELS = [
  "QR Code",
  "Data Matrix",
  "EAN-13",
  "UPC-A",
  "Code 128",
  "PDF417",
  "Aztec",
] as const;
