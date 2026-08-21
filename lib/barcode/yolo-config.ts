/** Upload YOLO11n ONNX — fixed export shape is 960×960. */
export const YOLO_IMGSZ = 960;
export const YOLO_MODEL_URL = "/models/barcode-yolo11n.onnx";

/**
 * Live uses a separate 640×640 ONNX so mobile WASM can run at usable FPS.
 * Upload keeps 960 for dense / tiny Data Matrix recall.
 */
export const YOLO_LIVE_IMGSZ = 640;
export const YOLO_LIVE_MODEL_URL = "/models/barcode-yolo11n-live.onnx";
/**
 * Match upload floor so tiny / screen-captured Data Matrix still emit.
 * 0.4 was dropping most small cells in multi-code grids.
 */
export const YOLO_LIVE_CONF = 0.22;
/** Allow dense blister / label sheets (was 8 — only top scores survived). */
export const YOLO_LIVE_MAX_BOXES = 40;
/** Slightly tighter NMS so adjacent small codes are not merged away. */
export const YOLO_LIVE_IOU = 0.35;

export const YOLO_WASM_PATHS = "/ort/";
