/** Keep enough resolution for small Data Matrix codes in wide photos. */
export const MAX_DIMENSION = 4096;

export const TILE_GRID_SIZE = 8;
export const TILE_OVERLAP = 0.25;

/** Upscale so small Data Matrix modules keep usable pixels before crop decode. */
export const SMALL_CODE_UPSCALE = 2;
export const FULL_UPSCALE_MAX_SIDE = 1600;
/** Prefer at least this long side after prepare (capped by MAX_DIMENSION). */
export const TARGET_PREPARE_LONG_SIDE = 2800;

/** Run crop / dense tile stages when fewer than this many codes are found. */
export const MULTI_DETECT_THRESHOLD = 8;

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };

    img.src = url;
  });
}

async function loadBitmapFromFile(
  file: File,
): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Older browsers or unsupported EXIF — fall back to Image.
    }
  }

  return loadImageFromFile(file);
}

function sourceSize(source: ImageBitmap | HTMLImageElement): {
  width: number;
  height: number;
} {
  if ("naturalWidth" in source && source.naturalWidth) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }

  return { width: source.width, height: source.height };
}

function getScaledDimensions(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number; scale: number } {
  const longestSide = Math.max(width, height);

  if (longestSide <= maxDimension) {
    return { width, height, scale: 1 };
  }

  const scale = maxDimension / longestSide;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    scale,
  };
}

export interface PreparedCanvas {
  canvas: HTMLCanvasElement;
  /** Scale from original file pixels to canvas pixels (includes upscale). */
  scale: number;
  originalSize: { width: number; height: number };
}

export async function prepareCanvasFromFile(file: File): Promise<PreparedCanvas> {
  const source = await loadBitmapFromFile(file);
  const originalSize = sourceSize(source);
  const { width, height, scale: resizeScale } = getScaledDimensions(
    originalSize.width,
    originalSize.height,
    MAX_DIMENSION,
  );

  const longestPrepared = Math.max(width, height);
  // Push soft warehouse photos toward ~2800px so tiny DM modules survive crop upscale.
  const targetLongest = Math.min(
    MAX_DIMENSION,
    Math.max(
      TARGET_PREPARE_LONG_SIDE,
      longestPrepared *
        (longestPrepared < FULL_UPSCALE_MAX_SIDE
          ? SMALL_CODE_UPSCALE
          : longestPrepared < 2800
            ? 1.5
            : 1),
    ),
  );
  const upscale = Math.max(1, targetLongest / longestPrepared);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * upscale);
  canvas.height = Math.round(height * upscale);

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }

  ctx.imageSmoothingEnabled = upscale > 1.25;
  if (ctx.imageSmoothingEnabled) {
    ctx.imageSmoothingQuality = "high";
  }
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ("close" in source) {
    source.close();
  }

  return {
    canvas,
    scale: resizeScale / upscale,
    originalSize,
  };
}

/** Upscale canvas for sparse scans so tiny label codes gain pixel density. */
export function upscaleCanvas(
  source: HTMLCanvasElement,
  factor: number,
): HTMLCanvasElement {
  if (factor <= 1) {
    return source;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * factor);
  canvas.height = Math.round(source.height * factor);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error("Failed to export image"));
        }
      },
      "image/png",
    );
  });
}

/** @deprecated Use prepareCanvasFromFile instead. */
export async function preprocessImage(file: File): Promise<{
  source: Blob;
  imageSize: { width: number; height: number };
  scale: number;
}> {
  const { canvas, scale, originalSize } = await prepareCanvasFromFile(file);
  const source = await canvasToBlob(canvas);

  return {
    source,
    imageSize: originalSize,
    scale,
  };
}
