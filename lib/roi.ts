export type NormalizedRoi = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RoiPresetId =
  | "center-sm"
  | "center-md"
  | "center-lg"
  | "strip"
  | "portrait";

export const ROI_PRESETS: Record<
  RoiPresetId,
  { label: string; roi: NormalizedRoi }
> = {
  "center-sm": {
    label: "Small",
    roi: { x: 0.22, y: 0.34, width: 0.56, height: 0.26 },
  },
  "center-md": {
    label: "Medium",
    roi: { x: 0.1, y: 0.24, width: 0.8, height: 0.42 },
  },
  "center-lg": {
    label: "Large",
    roi: { x: 0.05, y: 0.14, width: 0.9, height: 0.58 },
  },
  strip: {
    label: "Strip",
    roi: { x: 0.05, y: 0.4, width: 0.9, height: 0.18 },
  },
  portrait: {
    label: "Tall",
    roi: { x: 0.18, y: 0.16, width: 0.64, height: 0.56 },
  },
};

export const DEFAULT_ROI_PRESET: RoiPresetId = "center-md";
export const DEFAULT_ROI: NormalizedRoi = ROI_PRESETS[DEFAULT_ROI_PRESET].roi;

export const ROI_PRESET_ORDER: RoiPresetId[] = [
  "center-sm",
  "center-md",
  "center-lg",
  "strip",
  "portrait",
];

export function matchRoiPreset(roi: NormalizedRoi): RoiPresetId | null {
  for (const id of ROI_PRESET_ORDER) {
    const preset = ROI_PRESETS[id].roi;
    if (
      Math.abs(roi.x - preset.x) < 0.001 &&
      Math.abs(roi.y - preset.y) < 0.001 &&
      Math.abs(roi.width - preset.width) < 0.001 &&
      Math.abs(roi.height - preset.height) < 0.001
    ) {
      return id;
    }
  }
  return null;
}

const MIN_NORM = 0.12;

export function clampRoi(roi: NormalizedRoi): NormalizedRoi {
  const width = Math.min(1, Math.max(MIN_NORM, roi.width));
  const height = Math.min(1, Math.max(MIN_NORM, roi.height));
  const x = Math.min(1 - width, Math.max(0, roi.x));
  const y = Math.min(1 - height, Math.max(0, roi.y));
  return { x, y, width, height };
}

export function moveRoi(
  roi: NormalizedRoi,
  dx: number,
  dy: number,
): NormalizedRoi {
  return clampRoi({ ...roi, x: roi.x + dx, y: roi.y + dy });
}

export type ResizeHandle = "nw" | "ne" | "sw" | "se";

export function resizeRoi(
  roi: NormalizedRoi,
  handle: ResizeHandle,
  dx: number,
  dy: number,
): NormalizedRoi {
  let { x, y, width, height } = roi;

  if (handle.includes("w")) {
    const nextX = x + dx;
    const nextW = width - dx;
    if (nextW >= MIN_NORM) {
      x = nextX;
      width = nextW;
    }
  }
  if (handle.includes("e")) {
    width = width + dx;
  }
  if (handle.includes("n")) {
    const nextY = y + dy;
    const nextH = height - dy;
    if (nextH >= MIN_NORM) {
      y = nextY;
      height = nextH;
    }
  }
  if (handle.includes("s")) {
    height = height + dy;
  }

  return clampRoi({ x, y, width, height });
}

/** Map a normalized ROI on the display stage into source-image pixel bbox. */
export function normalizedRoiToSourceBBox(
  roi: NormalizedRoi,
  sourceWidth: number,
  sourceHeight: number,
  displayWidth: number,
  displayHeight: number,
  mirrored = false,
  objectFit: "cover" | "contain" = "cover",
): { x: number; y: number; width: number; height: number } {
  const scaleX = displayWidth / sourceWidth;
  const scaleY = displayHeight / sourceHeight;
  const scale =
    objectFit === "cover" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  const drawnWidth = sourceWidth * scale;
  const drawnHeight = sourceHeight * scale;
  const offsetX = (displayWidth - drawnWidth) / 2;
  const offsetY = (displayHeight - drawnHeight) / 2;

  let left = roi.x * displayWidth;
  let right = (roi.x + roi.width) * displayWidth;
  const top = roi.y * displayHeight;
  const bottom = (roi.y + roi.height) * displayHeight;

  if (mirrored) {
    const ml = displayWidth - right;
    const mr = displayWidth - left;
    left = ml;
    right = mr;
  }

  const sx1 = (left - offsetX) / scale;
  const sy1 = (top - offsetY) / scale;
  const sx2 = (right - offsetX) / scale;
  const sy2 = (bottom - offsetY) / scale;

  const x = Math.max(0, Math.min(sourceWidth, Math.min(sx1, sx2)));
  const y = Math.max(0, Math.min(sourceHeight, Math.min(sy1, sy2)));
  const r = Math.max(0, Math.min(sourceWidth, Math.max(sx1, sx2)));
  const b = Math.max(0, Math.min(sourceHeight, Math.max(sy1, sy2)));

  return {
    x,
    y,
    width: Math.max(1, r - x),
    height: Math.max(1, b - y),
  };
}

export function boxIntersectsRoi(
  box: { x: number; y: number; width: number; height: number },
  roi: { x: number; y: number; width: number; height: number },
): boolean {
  const ax2 = box.x + box.width;
  const ay2 = box.y + box.height;
  const bx2 = roi.x + roi.width;
  const by2 = roi.y + roi.height;
  return box.x < bx2 && ax2 > roi.x && box.y < by2 && ay2 > roi.y;
}
