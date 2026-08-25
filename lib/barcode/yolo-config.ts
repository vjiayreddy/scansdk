/** Single YOLO11n ONNX for upload and live (letterbox imgsz must match export). */
export const YOLO_IMGSZ = 960;
export const YOLO_MODEL_URL = "/models/barcode-yolo11n.onnx";

/** Live uses the same weights/graph as upload. */
export const YOLO_LIVE_IMGSZ = YOLO_IMGSZ;
export const YOLO_LIVE_MODEL_URL = YOLO_MODEL_URL;

export const YOLO_WASM_PATHS = "/ort/";

/**
 * Strict barcode-only policy:
 * - Reject text / blank / huge non-barcode shapes (geometry + higher conf).
 * - Still show located/unread barcode-shaped boxes (localization works).
 * - No invented CODE128 sibling strips (empty-space FPs).
 */
export const YOLO_STRICT_BARCODE_ONLY = true;

/**
 * Class names for the locate model.
 * Target 2-class (`1 × 6 × N`): datamatrix + CODE128 only.
 * Legacy 4-class (`1 × 8 × N`): ids 2–3 show as `class_N` until ONNX is replaced.
 */
export const YOLO_CLASS_NAMES = ["datamatrix", "CODE128"] as const;

export type YoloClassName = (typeof YOLO_CLASS_NAMES)[number];

/** UI / scan filter: which YOLO classes to keep after locate. */
export type YoloClassFilter = "both" | "datamatrix" | "code128";

export const YOLO_CLASS_FILTER_OPTIONS: {
  id: YoloClassFilter;
  label: string;
}[] = [
  { id: "both", label: "Both" },
  { id: "datamatrix", label: "DataMatrix" },
  { id: "code128", label: "Code128" },
];

/** YOLO class id 0 = datamatrix, 1 = CODE128. */
export function yoloClassAllowed(
  classId: number | undefined,
  filter: YoloClassFilter = "both",
): boolean {
  if (filter === "both") {
    return true;
  }
  if (classId === undefined) {
    return filter === "datamatrix";
  }
  if (filter === "datamatrix") {
    return classId === 0;
  }
  return classId === 1;
}

export function filterYoloBoxesByClass<T extends { classId?: number }>(
  boxes: T[],
  filter: YoloClassFilter = "both",
): T[] {
  if (filter === "both") {
    return boxes;
  }
  return boxes.filter((box) => yoloClassAllowed(box.classId, filter));
}

export function yoloClassLabel(classId: number | undefined): string {
  if (classId === undefined || classId < 0) {
    return "barcode";
  }
  return YOLO_CLASS_NAMES[classId] ?? `class_${classId}`;
}

/**
 * Upload locate: full-frame + overlapping tiles so small codes stay large in the
 * 960 letterbox (dense trays / pallet stacks / wide warehouse photos).
 */
export const YOLO_TILE_MIN_LONG_SIDE = 480;
/**
 * Dense tiles so tiny DM stays large inside the 960 letterbox.
 * Normal upload already uses 4×4; hard adds overlap only (same grid).
 */
export const YOLO_TILE_GRID_NORMAL = 4;
export const YOLO_TILE_GRID_HARD = 5;
export const YOLO_TILE_OVERLAP = 0.45;
