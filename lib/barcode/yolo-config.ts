/** Single YOLO11n ONNX for upload and live (letterbox imgsz must match export). */
export const YOLO_IMGSZ = 960;
export const YOLO_MODEL_URL = "/models/barcode-yolo11n.onnx";

/** Live uses the same weights/graph as upload. */
export const YOLO_LIVE_IMGSZ = YOLO_IMGSZ;
export const YOLO_LIVE_MODEL_URL = YOLO_MODEL_URL;

export const YOLO_WASM_PATHS = "/ort/";

/**
 * Upload locate: full-frame + overlapping tiles so small codes stay large in the
 * 960 letterbox (dense trays / wide warehouse photos).
 */
export const YOLO_TILE_MIN_LONG_SIDE = 1200;
/** Normal upload: 2×2. Hard mode: 3×3. */
export const YOLO_TILE_GRID_NORMAL = 2;
export const YOLO_TILE_GRID_HARD = 3;
export const YOLO_TILE_OVERLAP = 0.25;
