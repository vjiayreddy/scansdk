"use client";

/**
 * Shared native BarcodeDetector (Chrome/Edge). Used for continuous live
 * video.detect() and as a fast crop boost before zxing-wasm.
 */

export type NativeBarcodeHit = {
  rawValue: string;
  format: string;
  boundingBox: { x: number; y: number; width: number; height: number };
};

type DetectorLike = {
  detect: (
    source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap | ImageData,
  ) => Promise<
    Array<{
      rawValue: string;
      format: string;
      boundingBox: DOMRectReadOnly;
    }>
  >;
};

const PREFERRED_FORMATS = [
  "data_matrix",
  "qr_code",
  "ean_13",
  "ean_8",
  "code_128",
  "upc_a",
  "upc_e",
] as const;

let detectorPromise: Promise<DetectorLike | null> | null = null;

function mapHits(
  results: Array<{
    rawValue: string;
    format: string;
    boundingBox: DOMRectReadOnly;
  }>,
): NativeBarcodeHit[] {
  return results
    .filter((r) => Boolean(r.rawValue))
    .map((r) => ({
      rawValue: r.rawValue,
      format: r.format,
      boundingBox: {
        x: r.boundingBox.x,
        y: r.boundingBox.y,
        width: r.boundingBox.width,
        height: r.boundingBox.height,
      },
    }));
}

export function isNativeBarcodeDetectorAvailable(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

export async function getNativeBarcodeDetector(): Promise<DetectorLike | null> {
  if (!isNativeBarcodeDetectorAvailable()) {
    return null;
  }
  if (detectorPromise) {
    return detectorPromise;
  }

  detectorPromise = (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Detector = (window as any).BarcodeDetector as {
        new (opts?: { formats?: string[] }): DetectorLike;
        getSupportedFormats?: () => Promise<string[]>;
      };

      let formats: string[] = [...PREFERRED_FORMATS];
      if (typeof Detector.getSupportedFormats === "function") {
        const supported = await Detector.getSupportedFormats();
        const filtered = PREFERRED_FORMATS.filter((f) => supported.includes(f));
        if (filtered.length > 0) {
          formats = filtered;
        }
      }

      return new Detector({ formats });
    } catch {
      return null;
    }
  })();

  return detectorPromise;
}

/** Detect from a live `<video>` frame (or crop bitmap / canvas). */
export async function detectNativeBarcodes(
  source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap | ImageData,
): Promise<NativeBarcodeHit[]> {
  const detector = await getNativeBarcodeDetector();
  if (!detector) {
    return [];
  }
  try {
    return mapHits(await detector.detect(source));
  } catch {
    return [];
  }
}
