/**
 * Live crop geometry: light pad + max edge cap (no upload double-padding).
 */

export const LIVE_YOLO_PAD = 0.12;
export const LIVE_MAX_CROP_EDGE = 640;

export type LiveCropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Expand a YOLO box ~12% for quiet zone without the upload 22%+45% stack. */
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

/**
 * Draw a video crop onto a canvas, scaling so the longest edge ≤ maxEdge.
 * Returns scale from crop-canvas pixels back toward source crop pixels
 * (sourceCrop * scale = canvas size).
 */
export function drawLiveCrop(
  video: HTMLVideoElement,
  crop: LiveCropRect,
  canvas: HTMLCanvasElement,
  maxEdge = LIVE_MAX_CROP_EDGE,
): { scale: number; width: number; height: number } {
  const longest = Math.max(crop.width, crop.height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  const width = Math.max(1, Math.round(crop.width * scale));
  const height = Math.max(1, Math.round(crop.height * scale));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Crop canvas context unavailable");
  }

  ctx.imageSmoothingEnabled = scale < 1;
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

  return { scale, width, height };
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
