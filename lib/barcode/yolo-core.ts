/** Shared YOLO postprocess + letterbox helpers (main thread + worker). */

export const YOLO_CONF = 0.25;
export const YOLO_IOU = 0.45;

export interface YoloBox {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}

export function boxIou(a: YoloBox, b: YoloBox): number {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.width * a.height + b.width * b.height - inter;
  return union <= 0 ? 0 : inter / union;
}

export function nms(boxes: YoloBox[], iouThresh: number): YoloBox[] {
  const ordered = [...boxes].sort((a, b) => b.score - a.score);
  const kept: YoloBox[] = [];

  for (const box of ordered) {
    if (kept.every((existing) => boxIou(existing, box) < iouThresh)) {
      kept.push(box);
    }
  }

  return kept;
}

/** Pack RGBA ImageData into CHW float32 [0,1] (writes into `tensor`). */
export function rgbaToChw(
  rgba: Uint8ClampedArray,
  imgsz: number,
  tensor: Float32Array,
): void {
  const plane = imgsz * imgsz;
  for (let index = 0; index < plane; index += 1) {
    const pixel = index * 4;
    tensor[index] = rgba[pixel]! / 255;
    tensor[plane + index] = rgba[pixel + 1]! / 255;
    tensor[2 * plane + index] = rgba[pixel + 2]! / 255;
  }
}

export function parseYoloOutputData(
  data: Float32Array,
  dims: readonly number[],
  scale: number,
  padX: number,
  padY: number,
  canvasWidth: number,
  canvasHeight: number,
  conf = YOLO_CONF,
  iou = YOLO_IOU,
): YoloBox[] {
  const channels = 5;
  let count = 0;
  let channelMajor = true;

  if (dims.length === 3 && dims[1] === 5) {
    count = dims[2]!;
    channelMajor = true;
  } else if (dims.length === 3 && dims[2] === 5) {
    count = dims[1]!;
    channelMajor = false;
  } else if (dims.length === 2 && dims[0] === 5) {
    count = dims[1]!;
    channelMajor = true;
  } else {
    return [];
  }

  const boxes: YoloBox[] = [];

  for (let index = 0; index < count; index += 1) {
    const cx = channelMajor ? data[index] : data[index * channels];
    const cy = channelMajor ? data[count + index] : data[index * channels + 1];
    const width = channelMajor
      ? data[2 * count + index]
      : data[index * channels + 2];
    const height = channelMajor
      ? data[3 * count + index]
      : data[index * channels + 3];
    const score = channelMajor
      ? data[4 * count + index]
      : data[index * channels + 4];

    if (score === undefined || score < conf) {
      continue;
    }

    if (
      cx === undefined ||
      cy === undefined ||
      width === undefined ||
      height === undefined
    ) {
      continue;
    }

    const x = (cx - width / 2 - padX) / scale;
    const y = (cy - height / 2 - padY) / scale;
    const mappedWidth = width / scale;
    const mappedHeight = height / scale;

    boxes.push({
      x: Math.max(0, x),
      y: Math.max(0, y),
      width: Math.min(mappedWidth, canvasWidth - Math.max(0, x)),
      height: Math.min(mappedHeight, canvasHeight - Math.max(0, y)),
      score,
    });
  }

  return nms(
    boxes.filter((box) => box.width >= 2 && box.height >= 2),
    iou,
  );
}
