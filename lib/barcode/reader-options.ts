import type { ReaderOptions } from "zxing-wasm/reader";

export const ENHANCED_READER_OPTIONS: ReaderOptions = {
  tryHarder: true,
  tryDenoise: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: false,
  maxNumberOfSymbols: 255,
  formats: ["DataMatrix", "QRCode", "EAN13", "EAN8", "Code128", "UPCA", "UPCE"],
};

/** First full-frame pass: Data Matrix only, skip denoise (biggest speed win). */
export const FAST_DATAMATRIX_OPTIONS: ReaderOptions = {
  tryHarder: true,
  tryDenoise: false,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: false,
  maxNumberOfSymbols: 64,
  formats: ["DataMatrix"],
};

/** Per-crop decode: Data Matrix only. Denoise helps soft/JPEG pharma packs. */
export const DATAMATRIX_CROP_OPTIONS: ReaderOptions = {
  tryHarder: true,
  tryDenoise: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 4,
  formats: ["DataMatrix"],
  binarizer: "LocalAverage",
};

/**
 * YOLO locate crops — Data Matrix + Code128 (zxing-wasm / barcode-detector).
 * Default for upload scan after YOLO boxes.
 */
export const YOLO_CROP_OPTIONS: ReaderOptions = {
  tryHarder: true,
  tryDenoise: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 4,
  formats: ["DataMatrix", "Code128"],
  binarizer: "LocalAverage",
};

export const YOLO_HARD_CROP_OPTIONS: ReaderOptions = {
  ...YOLO_CROP_OPTIONS,
  tryHarder: true,
  tryDenoise: true,
};

/** YOLO class 1 (CODE128) — Code128 only, rotate for vertical bars. */
export const CODE128_CROP_OPTIONS: ReaderOptions = {
  tryHarder: true,
  tryDenoise: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 4,
  formats: ["Code128"],
  binarizer: "LocalAverage",
};

export const CODE128_HARD_CROP_OPTIONS: ReaderOptions = {
  ...CODE128_CROP_OPTIONS,
  tryHarder: true,
  tryDenoise: true,
};

/** Pick crop reader from YOLO class id (0=DM, 1=CODE128). */
export function cropOptionsForYoloClass(
  classId: number | undefined,
  hard = false,
): ReaderOptions {
  if (classId === 1) {
    return hard ? CODE128_HARD_CROP_OPTIONS : CODE128_CROP_OPTIONS;
  }
  if (classId === 0) {
    return hard ? DATAMATRIX_HARD_CROP_OPTIONS : DATAMATRIX_CROP_OPTIONS;
  }
  return hard ? YOLO_HARD_CROP_OPTIONS : YOLO_CROP_OPTIONS;
}

/** Live camera crops — multi-format escalate pass after fast Data Matrix miss. */
export const LIVE_CROP_OPTIONS: ReaderOptions = {
  tryHarder: true,
  tryDenoise: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 4,
  formats: ["DataMatrix", "QRCode", "EAN13", "EAN8", "Code128", "UPCA", "UPCE"],
  binarizer: "LocalAverage",
};

/**
 * Live first pass — Data Matrix only, light flags (pharma primary).
 * Escalate to LIVE_CROP_OPTIONS only if budget remains.
 */
export const LIVE_FAST_CROP_OPTIONS: ReaderOptions = {
  tryHarder: false,
  tryDenoise: false,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 2,
  formats: ["DataMatrix"],
  binarizer: "LocalAverage",
};

/** Blurry crops only — WASM denoise complements JS deblur filters. */
export const DATAMATRIX_HARD_CROP_OPTIONS: ReaderOptions = {
  tryHarder: true,
  tryDenoise: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 4,
  formats: ["DataMatrix"],
  binarizer: "LocalAverage",
};

const BINARIZER_PASSES = [
  "LocalAverage",
  "GlobalHistogram",
  "FixedThreshold",
] as const;

/** Try alternate binarizers when the default fails on soft JPEG modules. */
export function cropOptionsWithBinarizer(
  base: ReaderOptions,
  binarizer: (typeof BINARIZER_PASSES)[number],
): ReaderOptions {
  return { ...base, binarizer };
}

export { BINARIZER_PASSES };
