import type { ReadResult } from "zxing-wasm/reader";

import type { DetectedBarcode } from "./types";

const FORMAT_MAP: Record<string, DetectedBarcode["format"]> = {
  Aztec: "aztec",
  AztecCode: "aztec_code",
  AztecRune: "aztec_rune",
  Codabar: "codabar",
  Code128: "code_128",
  Code32: "code_32",
  Code39: "code_39",
  Code39Ext: "code_39_extended",
  Code39Std: "code_39_standard",
  Code93: "code_93",
  CompactPDF417: "compact_pdf417",
  DataBar: "databar",
  DataBarExp: "databar_expanded",
  DataBarExpStk: "databar_expanded_stacked",
  DataBarLtd: "databar_limited",
  DataBarOmni: "databar_omni",
  DataBarStk: "databar_stacked",
  DataBarStkOmni: "databar_stacked_omni",
  DataMatrix: "data_matrix",
  DXFilmEdge: "dx_film_edge",
  EAN13: "ean_13",
  EAN8: "ean_8",
  ISBN: "isbn",
  ITF: "itf",
  ITF14: "itf_14",
  MaxiCode: "maxi_code",
  MicroPDF417: "micro_pdf417",
  MicroQRCode: "micro_qr_code",
  PDF417: "pdf417",
  PZN: "pzn",
  QRCode: "qr_code",
  QRCodeModel1: "qr_code_model_1",
  QRCodeModel2: "qr_code_model_2",
  RMQRCode: "rm_qr_code",
  UPCA: "upc_a",
  UPCE: "upc_e",
};

function mapFormat(format: string): DetectedBarcode["format"] {
  if (format in FORMAT_MAP) {
    return FORMAT_MAP[format];
  }

  return format
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase() as DetectedBarcode["format"];
}

function offsetPoint(point: { x: number; y: number }, offsetX: number, offsetY: number) {
  return { x: point.x + offsetX, y: point.y + offsetY };
}

export function mapReadResult(
  result: ReadResult,
  offsetX = 0,
  offsetY = 0,
): DetectedBarcode {
  const topLeft = offsetPoint(result.position.topLeft, offsetX, offsetY);
  const topRight = offsetPoint(result.position.topRight, offsetX, offsetY);
  const bottomRight = offsetPoint(result.position.bottomRight, offsetX, offsetY);
  const bottomLeft = offsetPoint(result.position.bottomLeft, offsetX, offsetY);

  const xs = [topLeft.x, topRight.x, bottomRight.x, bottomLeft.x];
  const ys = [topLeft.y, topRight.y, bottomRight.y, bottomLeft.y];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    rawValue: result.text,
    format: mapFormat(result.format),
    boundingBox: {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    },
    cornerPoints: [topLeft, topRight, bottomRight, bottomLeft],
  };
}

export function dedupeBarcodes(barcodes: DetectedBarcode[]): DetectedBarcode[] {
  const seen = new Map<string, DetectedBarcode>();

  for (const barcode of barcodes) {
    const centerX = Math.round(
      barcode.boundingBox.x + barcode.boundingBox.width / 2,
    );
    const centerY = Math.round(
      barcode.boundingBox.y + barcode.boundingBox.height / 2,
    );
    const key = `${barcode.rawValue}@${centerX}:${centerY}`;

    if (!seen.has(key)) {
      seen.set(key, barcode);
    }
  }

  return [...seen.values()];
}
