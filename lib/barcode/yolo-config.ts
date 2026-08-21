/** Upload YOLO11n ONNX (letterbox imgsz should match export for best quality). */
export const YOLO_IMGSZ = 960;
export const YOLO_MODEL_URL = "/models/barcode-yolo11n.onnx";

/**
 * Live uses the same weights but a smaller letterbox for mobile FPS.
 * YOLO is fully convolutional — 640 is valid (multiple of 32) and ~2.25× cheaper than 960.
 */
export const YOLO_LIVE_IMGSZ = 640;
export const YOLO_LIVE_MODEL_URL = YOLO_MODEL_URL;
/** Higher live threshold cuts false pink/red boxes on glare / screen noise. */
export const YOLO_LIVE_CONF = 0.4;
/** Cap detections per frame so decode/UI stay responsive on phones. */
export const YOLO_LIVE_MAX_BOXES = 8;

export const YOLO_WASM_PATHS = "/ort/";
