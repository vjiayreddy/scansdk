/**
 * Live crop geometry: light pad + content-aware upscale (no upload double-padding).
 */

export const LIVE_YOLO_PAD = 0.2;
export const LIVE_MAX_CROP_EDGE = 720;
/**
 * Upscale so the *YOLO detection* (not the padded crop) reaches this min edge.
 * Padding-then-upscale left ~40px barcodes at ~63px on a 256 canvas — too small for DM.
 */
export const LIVE_MIN_CONTENT_EDGE = 288;

export type LiveCropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Expand a YOLO box for quiet zone only (do not inflate to a large source pad). */
export function expandLiveYoloRegion(
  region: { x: number; y: number; width: number; height: number },
  frameWidth: number,
  frameHeight: number,
  padRatio = LIVE_YOLO_PAD,
): LiveCropRect {
  const padX = Math.max(4, Math.round(region.width * padRatio));
  const padY = Math.max(4, Math.round(region.height * padRatio));
  const x = clamp(region.x - padX, 0, frameWidth - 1);
  const y = clamp(region.y - padY, 0, frameHeight - 1);
  const right = clamp(region.x + region.width + padX, x + 1, frameWidth);
  const bottom = clamp(region.y + region.height + padY, y + 1, frameHeight);
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

export type DrawLiveCropOptions = {
  /** Raw YOLO box width — used so upscale targets the code, not the pad. */
  contentWidth?: number;
  /** Raw YOLO box height. */
  contentHeight?: number;
  maxEdge?: number;
  minContentEdge?: number;
};

/**
 * Draw a video crop onto a canvas.
 * Scale is chosen so the YOLO content min-edge ≈ minContentEdge (capped by maxEdge).
 */
export function drawLiveCrop(
  video: HTMLVideoElement,
  crop: LiveCropRect,
  canvas: HTMLCanvasElement,
  options: DrawLiveCropOptions = {},
): { scale: number; width: number; height: number; contentEdge: number } {
  const maxEdge = options.maxEdge ?? LIVE_MAX_CROP_EDGE;
  const minContentEdge = options.minContentEdge ?? LIVE_MIN_CONTENT_EDGE;
  const contentMin = Math.max(
    1,
    Math.min(
      options.contentWidth ?? crop.width,
      options.contentHeight ?? crop.height,
    ),
  );

  let scale = minContentEdge / contentMin;
  const longest = Math.max(crop.width, crop.height);
  if (longest * scale > maxEdge) {
    scale = maxEdge / longest;
  }

  const width = Math.max(1, Math.round(crop.width * scale));
  const height = Math.max(1, Math.round(crop.height * scale));
  const contentEdge = Math.round(contentMin * scale);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Crop canvas context unavailable");
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    video,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    width,
    height,
  );

  return { scale, width, height, contentEdge };
}

/** Map a bbox from crop-canvas space into full video coordinates. */
export function mapCropBBoxToVideo(
  bbox: { x: number; y: number; width: number; height: number },
  crop: LiveCropRect,
  scale: number,
): LiveCropRect {
  const inv = scale > 0 ? 1 / scale : 1;
  return {
    x: crop.x + bbox.x * inv,
    y: crop.y + bbox.y * inv,
    width: bbox.width * inv,
    height: bbox.height * inv,
  };
}
