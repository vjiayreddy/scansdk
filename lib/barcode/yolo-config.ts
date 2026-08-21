/** Upload / live YOLO11n ONNX — fixed export shape is 960×960 (not dynamic). */
export const YOLO_IMGSZ = 960;
export const YOLO_MODEL_URL = "/models/barcode-yolo11n.onnx";

/**
 * Live must use the same letterbox size as the ONNX graph (960).
 * A 640 input fails OrtRun with "Got: 640 Expected: 960".
 * Mobile speed comes from higher conf, box cap, and locate throttling — not imgsz.
 */
export const YOLO_LIVE_IMGSZ = YOLO_IMGSZ;
export const YOLO_LIVE_MODEL_URL = YOLO_MODEL_URL;
/** Higher live threshold cuts false pink/red boxes on glare / screen noise. */
export const YOLO_LIVE_CONF = 0.4;
/** Cap detections per frame so decode/UI stay responsive on phones. */
export const YOLO_LIVE_MAX_BOXES = 8;

export const YOLO_WASM_PATHS = "/ort/";
