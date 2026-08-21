/** Keep enough resolution for small Data Matrix codes in wide photos. */
export const MAX_DIMENSION = 4096;

export const TILE_GRID_SIZE = 8;
export const TILE_OVERLAP = 0.25;

/** Upscale small source images; large canvases rely on per-crop upscale instead. */
export const SMALL_CODE_UPSCALE = 2;
export const FULL_UPSCALE_MAX_SIDE = 2000;

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

function enhanceContrast(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;

  for (let index = 0; index < data.length; index += 4) {
    const gray =
      data[index] * 0.299 +
      data[index + 1] * 0.587 +
      data[index + 2] * 0.114;
    // Mild stretch only — aggressive enhance crushed glare-adjacent Data Matrix modules.
    const enhanced = gray < 128 ? Math.max(0, gray * 0.94) : Math.min(255, gray * 1.04);

    data[index] = enhanced;
    data[index + 1] = enhanced;
    data[index + 2] = enhanced;
  }

  ctx.putImageData(imageData, 0, 0);
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
  const upscale =
    longestPrepared >= FULL_UPSCALE_MAX_SIDE ? 1 : SMALL_CODE_UPSCALE;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * upscale);
  canvas.height = Math.round(height * upscale);

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ("close" in source) {
    source.close();
  }
  enhanceContrast(ctx, canvas.width, canvas.height);

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
