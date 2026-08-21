/// <reference lib="webworker" />

/**
 * Live ZXing decode worker — receives crop ImageBitmaps only.
 * Messages:
 *   { type: "init", wasmBaseUrl }
 *   { type: "decode", id, bitmap, escalate }
 * Responses:
 *   { type: "ready" } | { type: "error", message }
 *   { type: "result", id, hits: LiveDecodeHit[] }
 */

import type { ReaderOptions } from "zxing-wasm/reader";

export type LiveDecodeHit = {
  rawValue: string;
  format: string;
  boundingBox: { x: number; y: number; width: number; height: number };
};

type InitMsg = { type: "init"; wasmBaseUrl: string };
type DecodeMsg = {
  type: "decode";
  id: number;
  bitmap: ImageBitmap;
  escalate: boolean;
};
type InMsg = InitMsg | DecodeMsg;

type OutMsg =
  | { type: "ready" }
  | { type: "result"; id: number; hits: LiveDecodeHit[] }
  | { type: "error"; id?: number; message: string };

const FAST_OPTIONS: ReaderOptions = {
  tryHarder: false,
  tryDenoise: false,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 2,
  formats: ["DataMatrix", "QRCode", "EAN13", "Code128"],
  binarizer: "LocalAverage",
};

const ESCALATE_OPTIONS: ReaderOptions = {
  tryHarder: true,
  tryDenoise: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 4,
  formats: ["DataMatrix", "QRCode", "EAN13", "EAN8", "Code128", "UPCA", "UPCE"],
  binarizer: "LocalAverage",
};

let ready = false;
let readBarcodesFn: typeof import("zxing-wasm/reader").readBarcodes | null =
  null;

const FORMAT_MAP: Record<string, string> = {
  DataMatrix: "data_matrix",
  QRCode: "qr_code",
  EAN13: "ean_13",
  EAN8: "ean_8",
  Code128: "code_128",
  UPCA: "upc_a",
  UPCE: "upc_e",
};

function mapFormat(format: string): string {
  if (format in FORMAT_MAP) {
    return FORMAT_MAP[format]!;
  }
  return format
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

function hitsFromResults(
  results: Awaited<ReturnType<NonNullable<typeof readBarcodesFn>>>,
): LiveDecodeHit[] {
  const hits: LiveDecodeHit[] = [];
  for (const result of results) {
    if (!result.isValid || !result.text) {
      continue;
    }
    const { topLeft, topRight, bottomRight, bottomLeft } = result.position;
    const xs = [topLeft.x, topRight.x, bottomRight.x, bottomLeft.x];
    const ys = [topLeft.y, topRight.y, bottomRight.y, bottomLeft.y];
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    hits.push({
      rawValue: result.text,
      format: mapFormat(result.format),
      boundingBox: {
        x: minX,
        y: minY,
        width: Math.max(...xs) - minX,
        height: Math.max(...ys) - minY,
      },
    });
  }
  return hits;
}

async function bitmapToImageData(bitmap: ImageBitmap): Promise<ImageData> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("OffscreenCanvas unavailable in decode worker");
  }
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

async function handleInit(msg: InitMsg): Promise<void> {
  const zxing = await import("zxing-wasm/reader");
  const base = msg.wasmBaseUrl.endsWith("/")
    ? msg.wasmBaseUrl
    : `${msg.wasmBaseUrl}/`;
  await zxing.prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => {
        if (path.endsWith(".wasm")) {
          return `${base}${path.split("/").pop()}`;
        }
        return prefix + path;
      },
    },
  });
  readBarcodesFn = zxing.readBarcodes;
  ready = true;
}

async function handleDecode(msg: DecodeMsg): Promise<OutMsg> {
  if (!ready || !readBarcodesFn) {
    return { type: "error", id: msg.id, message: "Decode worker not ready" };
  }

  try {
    const imageData = await bitmapToImageData(msg.bitmap);
    let results = await readBarcodesFn(imageData, FAST_OPTIONS);
    let hits = hitsFromResults(results);

    if (hits.length === 0 && msg.escalate) {
      results = await readBarcodesFn(imageData, ESCALATE_OPTIONS);
      hits = hitsFromResults(results);
    }

    return { type: "result", id: msg.id, hits };
  } finally {
    msg.bitmap.close();
  }
}

function post(msg: OutMsg): void {
  self.postMessage(msg);
}

self.onmessage = (event: MessageEvent<InMsg>) => {
  const data = event.data;
  void (async () => {
    try {
      if (data.type === "init") {
        await handleInit(data);
        post({ type: "ready" });
        return;
      }
      if (data.type === "decode") {
        post(await handleDecode(data));
      }
    } catch (err: unknown) {
      post({
        type: "error",
        id: data.type === "decode" ? data.id : undefined,
        message: err instanceof Error ? err.message : "Decode worker failed",
      });
      if (data.type === "decode") {
        try {
          data.bitmap.close();
        } catch {
          // ignore
        }
      }
    }
  })();
};

export {};
