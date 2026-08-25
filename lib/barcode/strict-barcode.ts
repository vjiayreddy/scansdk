import type { ScanDetection } from "./types";
import type { YoloBox } from "./yolo-core";
import { YOLO_STRICT_BARCODE_ONLY } from "./yolo-config";

/**
 * Tiny DM recall: warehouse packs often sit ~12–28px on a ~2800 canvas.
 * Keep a soft floor so 2–4px noise dies; do not require high conf on small boxes
 * (real small DM often scores 0.12–0.35).
 */
const MIN_DM_AREA_FRAC = 0.00005;
const MIN_DM_SIDE_FRAC = 0.004;
/** Only drop ultra-tiny unread boxes with very weak scores (likely noise). */
const TINY_DM_AREA_FRAC = 0.00022;
const TINY_DM_MIN_SCORE = 0.14;
/** Side-angle DM looks elongated in axis-aligned boxes. */
const MAX_DM_ASPECT = 3.5;

/**
 * Geometry gate: reject non-barcodes (huge slabs, tiny logo squares, near-square 1D).
 * Keeps real DM / CODE128-shaped boxes so localization still works.
 */
export function isPlausibleBarcodeBox(
  box: YoloBox,
  canvasWidth: number,
  canvasHeight: number,
): boolean {
  const area = box.width * box.height;
  const imageArea = Math.max(1, canvasWidth * canvasHeight);
  const frac = area / imageArea;
  const shortSide = Math.min(canvasWidth, canvasHeight);
  const minSide = Math.min(box.width, box.height);
  const maxSide = Math.max(box.width, box.height);

  // Ceiling fixtures / whole-label slabs
  if (frac > 0.12) {
    return false;
  }
  if (box.width < 8 || box.height < 8) {
    return false;
  }

  const ratio = maxSide / Math.max(1, minSide);

  // DataMatrix / square 2D — allow perspective stretch; still drop tiny logos
  if (box.classId === 0 || box.classId === undefined) {
    if (ratio > MAX_DM_ASPECT) {
      return false;
    }
    if (frac < MIN_DM_AREA_FRAC) {
      return false;
    }
    if (minSide < shortSide * MIN_DM_SIDE_FRAC) {
      return false;
    }
    // Borderline-small DM: require high conf (logo marks often mid-score)
    if (frac < TINY_DM_AREA_FRAC && (box.score ?? 0) < TINY_DM_MIN_SCORE) {
      return false;
    }
    return true;
  }

  // CODE128 — need clear elongation; reject rim/corner blobs
  if (box.classId === 1) {
    if (ratio < 2.2 || ratio > 18) {
      return false;
    }
    if (frac < 0.00012) {
      return false;
    }
    // Thin bar should span a meaningful width/height
    if (maxSide < shortSide * 0.04) {
      return false;
    }
    return true;
  }

  return ratio >= 1.4 && ratio <= 10 && frac >= 0.00012;
}

/**
 * Strict FP filter — does NOT require decode.
 * Drops unread hits that look like text/blank/logo marks; keeps
 * located/unread barcode-shaped boxes and all successful reads.
 */
export function applyStrictBarcodePolicy(
  detections: ScanDetection[],
  canvasWidth: number,
  canvasHeight: number,
  strict = YOLO_STRICT_BARCODE_ONLY,
): ScanDetection[] {
  if (!strict) {
    return detections;
  }

  return detections.filter((item) => {
    if (item.status === "read" && item.rawValue?.trim()) {
      return true;
    }
    // Locate / unread: only keep barcode-shaped YOLO boxes
    if (item.source !== "yolo") {
      return false;
    }
    const box: YoloBox = {
      x: item.boundingBox.x,
      y: item.boundingBox.y,
      width: item.boundingBox.width,
      height: item.boundingBox.height,
      score: item.score ?? 0,
      classId: item.yoloClassId,
    };
    return isPlausibleBarcodeBox(box, canvasWidth, canvasHeight);
  });
}

/** Pre-decode: drop non-barcode-shaped proposals. */
export function filterPlausibleLocateBoxes(
  boxes: YoloBox[],
  canvasWidth: number,
  canvasHeight: number,
  strict = YOLO_STRICT_BARCODE_ONLY,
): YoloBox[] {
  if (!strict) {
    return boxes;
  }
  return boxes.filter((box) =>
    isPlausibleBarcodeBox(box, canvasWidth, canvasHeight),
  );
}
