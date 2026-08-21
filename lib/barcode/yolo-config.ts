/** Single YOLO11n ONNX for upload and live (letterbox imgsz must match export). */
export const YOLO_IMGSZ = 960;
export const YOLO_MODEL_URL = "/models/barcode-yolo11n.onnx";

/** Live uses the same weights/graph as upload. */
export const YOLO_LIVE_IMGSZ = YOLO_IMGSZ;
export const YOLO_LIVE_MODEL_URL = YOLO_MODEL_URL;

export const YOLO_WASM_PATHS = "/ort/";
