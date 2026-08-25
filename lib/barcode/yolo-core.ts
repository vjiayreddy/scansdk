/** Shared YOLO postprocess + letterbox helpers (main thread + worker). */

/**
 * Locate conf — CODE128 stays strict; DM slightly lower for side-angle packs.
 */
export const YOLO_CONF = 0.18;
export const YOLO_IOU = 0.4;

/** Per-class floors (2-class: 0=datamatrix, 1=CODE128). Falls back to YOLO_CONF. */
export const YOLO_CONF_BY_CLASS: Record<number, number> = {
  0: 0.08, // datamatrix — tiny / far packs score weak in full-frame letterbox
  1: 0.25, // CODE128 — keep higher to limit rim/text FPs
};

/**
 * Tile passes: softer so small DM in zoomed tiles survive.
 */
export const YOLO_TILE_CONF_SCALE = 0.75;

/** Softer NMS for CODE128 so two stacked bars on one label both survive. */
export const YOLO_IOU_BY_CLASS: Record<number, number> = {
  0: 0.4,
  1: 0.18,
};

export interface YoloBox {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  /** Argmax class id for multi-class models (`1 × (4+nc) × N`). */
  classId?: number;
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

/**
 * NMS. When boxes carry `classId`, suppress only within the same class so
 * adjacent DM + 1D on one label can both survive (Ultralytics-style).
 * CODE128 uses a lower IoU so stacked dual bars are not collapsed into one.
 */
export function nms(boxes: YoloBox[], iouThresh: number): YoloBox[] {
  const ordered = [...boxes].sort((a, b) => b.score - a.score);
  const kept: YoloBox[] = [];

  for (const box of ordered) {
    const classIou =
      box.classId !== undefined
        ? (YOLO_IOU_BY_CLASS[box.classId] ?? iouThresh)
        : iouThresh;
    const sameClass = (existing: YoloBox) => {
      if (box.classId === undefined || existing.classId === undefined) {
        return true;
      }
      return existing.classId === box.classId;
    };
    if (
      kept.every((existing) => {
        if (!sameClass(existing)) {
          return true;
        }
        const thresh =
          existing.classId !== undefined
            ? Math.min(
                classIou,
                YOLO_IOU_BY_CLASS[existing.classId] ?? iouThresh,
              )
            : classIou;
        return boxIou(existing, box) < thresh;
      })
    ) {
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

function resolveLayout(dims: readonly number[]): {
  channels: number;
  count: number;
  channelMajor: boolean;
} | null {
  if (dims.length === 3 && dims[1]! >= 5) {
    return { channels: dims[1]!, count: dims[2]!, channelMajor: true };
  }
  if (dims.length === 3 && dims[2]! >= 5) {
    return { channels: dims[2]!, count: dims[1]!, channelMajor: false };
  }
  if (dims.length === 2 && dims[0]! >= 5) {
    return { channels: dims[0]!, count: dims[1]!, channelMajor: true };
  }
  return null;
}

function readChannel(
  data: Float32Array,
  channelMajor: boolean,
  channels: number,
  count: number,
  channel: number,
  index: number,
): number | undefined {
  return channelMajor
    ? data[channel * count + index]
    : data[index * channels + channel];
}

/**
 * Parse Ultralytics detect ONNX output.
 * - Single-class / class-agnostic: `1 × 5 × N` → (cx, cy, w, h, score)
 * - Multi-class: `1 × (4+nc) × N` → (cx, cy, w, h, cls0..clsN-1); score = max cls
 */
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
  /** Multiply per-class floors (e.g. tile passes use YOLO_TILE_CONF_SCALE). */
  classConfScale = 1,
): YoloBox[] {
  const layout = resolveLayout(dims);
  if (!layout) {
    return [];
  }

  const { channels, count, channelMajor } = layout;
  const numClasses = Math.max(1, channels - 4);
  const boxes: YoloBox[] = [];
  const scaleFloor = Math.min(1, Math.max(0.5, classConfScale));

  for (let index = 0; index < count; index += 1) {
    const cx = readChannel(data, channelMajor, channels, count, 0, index);
    const cy = readChannel(data, channelMajor, channels, count, 1, index);
    const width = readChannel(data, channelMajor, channels, count, 2, index);
    const height = readChannel(data, channelMajor, channels, count, 3, index);

    if (
      cx === undefined ||
      cy === undefined ||
      width === undefined ||
      height === undefined
    ) {
      continue;
    }

    let score = 0;
    let classId = 0;
    if (numClasses === 1) {
      score = readChannel(data, channelMajor, channels, count, 4, index) ?? 0;
      classId = 0;
    } else {
      for (let c = 0; c < numClasses; c += 1) {
        const classScore =
          readChannel(data, channelMajor, channels, count, 4 + c, index) ?? 0;
        if (classScore > score) {
          score = classScore;
          classId = c;
        }
      }
    }

    const classFloor =
      (YOLO_CONF_BY_CLASS[classId] ?? conf) * scaleFloor;
    if (score < classFloor) {
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
      classId,
    });
  }

  return nms(
    boxes.filter((box) => box.width >= 2 && box.height >= 2),
    iou,
  );
}
