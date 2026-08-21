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
