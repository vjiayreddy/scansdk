/** Upload / live YOLO11n ONNX — fixed export shape is 960×960 (not dynamic). */
export const YOLO_IMGSZ = 960;
export const YOLO_MODEL_URL = "/models/barcode-yolo11n.onnx";

/**
 * Live must use the same letterbox size as the ONNX graph (960).
 * A 640 input fails OrtRun with "Got: 640 Expected: 960".
 * Dense small DM packs need lower conf + higher box cap (not a smaller imgsz).
 */
export const YOLO_LIVE_IMGSZ = YOLO_IMGSZ;
export const YOLO_LIVE_MODEL_URL = YOLO_MODEL_URL;
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
