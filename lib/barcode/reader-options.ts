import type { ReaderOptions } from "zxing-wasm/reader";

export const ENHANCED_READER_OPTIONS: ReaderOptions = {
  tryHarder: true,
  tryDenoise: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: false,
  maxNumberOfSymbols: 255,
  formats: [],
};
