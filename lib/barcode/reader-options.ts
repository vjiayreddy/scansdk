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

/** Per-crop decode: Data Matrix only. Denoise off — filters run in JS when needed. */
export const DATAMATRIX_CROP_OPTIONS: ReaderOptions = {
  tryHarder: true,
  tryDenoise: false,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: false,
  maxNumberOfSymbols: 4,
  formats: ["DataMatrix"],
};

/** Blurry crops only — WASM denoise complements JS deblur filters. */
export const DATAMATRIX_HARD_CROP_OPTIONS: ReaderOptions = {
  tryHarder: true,
  tryDenoise: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: false,
  maxNumberOfSymbols: 4,
  formats: ["DataMatrix"],
};
