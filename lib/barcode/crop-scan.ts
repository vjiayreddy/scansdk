import { readBarcodes } from "zxing-wasm/reader";

import type { DetectedBarcode } from "./types";
import {
  applyCorrectionChain,
  invertImageData,
} from "./correct-image";
import { mapReadResult } from "./map-result";
import { DATAMATRIX_CROP_OPTIONS } from "./reader-options";
import {
  isExpired,
  remainingMs,
  YIELD_EVERY_CROPS,
  yieldToUi,
} from "./scan-budget";
import {
  mergeProposals,
  proposeRegions,
  seedFromDetections,
  uniformGridProposals,
  type RegionProposal,
} from "./propose-regions";

const CROP_PADDING = 0.45;
const MIN_CROP_SIDE = 180;
const MIN_UPSCALE = 2.5;
const DESKEW_THRESHOLD_DEG = 4;
const MAX_DESKEW_DEG = 15;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function padProposal(
  proposal: RegionProposal,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number; width: number; height: number } {
  const padX = Math.round(proposal.width * CROP_PADDING);
  const padY = Math.round(proposal.height * CROP_PADDING);
  const x = clamp(proposal.x - padX, 0, canvasWidth - 1);
  const y = clamp(proposal.y - padY, 0, canvasHeight - 1);
  const right = clamp(proposal.x + proposal.width + padX, x + 1, canvasWidth);
  const bottom = clamp(proposal.y + proposal.height + padY, y + 1, canvasHeight);

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

/** Estimate dominant edge angle in degrees using a coarse gradient histogram. */
function estimateDeskewAngle(imageData: ImageData): number {
  const { data, width, height } = imageData;
  const bins = new Array<number>(31).fill(0);
  const step = 3;

  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const i = (y * width + x) * 4;
      const left = data[i - 4];
      const right = data[i + 4];
      const up = data[i - width * 4];
      const down = data[i + width * 4];
      const gx = right - left;
      const gy = down - up;
      const mag = Math.abs(gx) + Math.abs(gy);

      if (mag < 40) {
        continue;
      }

      let deg = (Math.atan2(gy, gx) * 180) / Math.PI;
      while (deg > 45) deg -= 90;
      while (deg < -45) deg += 90;
      if (deg > MAX_DESKEW_DEG || deg < -MAX_DESKEW_DEG) {
        continue;
      }

      const bin = Math.round(deg + MAX_DESKEW_DEG);
      bins[bin] += mag;
    }
  }

  let bestBin = MAX_DESKEW_DEG;
  let bestScore = 0;
  for (let i = 0; i < bins.length; i += 1) {
    if (bins[i] > bestScore) {
      bestScore = bins[i];
      bestBin = i;
    }
  }

  return bestBin - MAX_DESKEW_DEG;
}

function rotatePoint(
  x: number,
  y: number,
  cx: number,
  cy: number,
  angleRad: number,
): { x: number; y: number } {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dx = x - cx;
  const dy = y - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

function mapCropPointToCanvas(
  point: { x: number; y: number },
  cropX: number,
  cropY: number,
  scale: number,
  angleDeg: number,
  outWidth: number,
  outHeight: number,
): { x: number; y: number } {
  let x = point.x;
  let y = point.y;

  if (Math.abs(angleDeg) >= DESKEW_THRESHOLD_DEG) {
    const rotated = rotatePoint(
      x,
      y,
      outWidth / 2,
      outHeight / 2,
      (-angleDeg * Math.PI) / 180,
    );
    x = rotated.x;
    y = rotated.y;
  }

  return {
    x: cropX + x / scale,
    y: cropY + y / scale,
  };
}

async function decodeImageData(
  imageData: ImageData,
): Promise<ReturnType<typeof mapReadResult>[]> {
  const results = await readBarcodes(imageData, DATAMATRIX_CROP_OPTIONS);
  return results
    .filter((result) => result.isValid && result.text.length > 0)
    .map((result) => mapReadResult(result));
}

async function decodeCropPasses(
  base: ImageData,
): Promise<ReturnType<typeof mapReadResult>[]> {
  const first = await decodeImageData(base);
  if (first.length > 0) {
    return first;
  }

  const fallbacks = [applyCorrectionChain(base), invertImageData(base)];

  for (const imageData of fallbacks) {
    const valid = await decodeImageData(imageData);
    if (valid.length > 0) {
      return valid;
    }
  }

  return [];
}

function upscaleRegion(
  source: HTMLCanvasElement,
  region: { x: number; y: number; width: number; height: number },
): { canvas: HTMLCanvasElement; scale: number } {
  const scale = Math.max(
    MIN_UPSCALE,
    MIN_CROP_SIDE / Math.min(region.width, region.height),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(region.width * scale);
  canvas.height = Math.round(region.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    source,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return { canvas, scale };
}

function rotateCanvas(
  source: HTMLCanvasElement,
  angleDeg: number,
): HTMLCanvasElement {
  const rotated = document.createElement("canvas");
  rotated.width = source.width;
  rotated.height = source.height;
  const ctx = rotated.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }

  ctx.imageSmoothingEnabled = false;
  ctx.translate(source.width / 2, source.height / 2);
  ctx.rotate((angleDeg * Math.PI) / 180);
  ctx.translate(-source.width / 2, -source.height / 2);
  ctx.drawImage(source, 0, 0);
  return rotated;
}

function mappedHits(
  decoded: ReturnType<typeof mapReadResult>[],
  region: { x: number; y: number },
  scale: number,
  angleDeg: number,
  outWidth: number,
  outHeight: number,
): DetectedBarcode[] {
  return decoded.map((hit) => {
    const corners = hit.cornerPoints.map((point) =>
      mapCropPointToCanvas(
        point,
        region.x,
        region.y,
        scale,
        angleDeg,
        outWidth,
        outHeight,
      ),
    ) as DetectedBarcode["cornerPoints"];

    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);

    return {
      ...hit,
      boundingBox: {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      },
      cornerPoints: corners,
    };
  });
}

async function decodeProposal(
  canvas: HTMLCanvasElement,
  proposal: RegionProposal,
  deadline: number,
): Promise<DetectedBarcode[]> {
  if (isExpired(deadline)) {
    return [];
  }

  const region = padProposal(proposal, canvas.width, canvas.height);
  const { canvas: cropCanvas, scale } = upscaleRegion(canvas, region);
  const cropCtx = cropCanvas.getContext("2d", { willReadFrequently: true });
  if (!cropCtx) {
    return [];
  }

  const cropData = cropCtx.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
  const decoded = await decodeCropPasses(cropData);
  if (decoded.length > 0) {
    return mappedHits(
      decoded,
      region,
      scale,
      0,
      cropCanvas.width,
      cropCanvas.height,
    );
  }

  if (remainingMs(deadline) < 400) {
    return [];
  }

  const angleDeg = estimateDeskewAngle(cropData);
  if (Math.abs(angleDeg) < DESKEW_THRESHOLD_DEG) {
    return [];
  }

  const rotated = rotateCanvas(cropCanvas, angleDeg);
  const rotatedCtx = rotated.getContext("2d", { willReadFrequently: true });
  if (!rotatedCtx) {
    return [];
  }

  const rotatedData = rotatedCtx.getImageData(0, 0, rotated.width, rotated.height);
  const rotatedHits = await decodeCropPasses(rotatedData);
  return mappedHits(
    rotatedHits,
    region,
    scale,
    angleDeg,
    rotated.width,
    rotated.height,
  );
}

async function decodeProposals(
  canvas: HTMLCanvasElement,
  proposals: RegionProposal[],
  deadline: number,
): Promise<DetectedBarcode[]> {
  if (proposals.length === 0 || isExpired(deadline)) {
    return [];
  }

  const results: DetectedBarcode[] = [];
  let processed = 0;

  for (const proposal of proposals) {
    if (isExpired(deadline)) {
      break;
    }

    const hits = await decodeProposal(canvas, proposal, deadline);
    results.push(...hits);
    processed += 1;

    if (processed % YIELD_EVERY_CROPS === 0) {
      await yieldToUi();
    }
  }

  return results;
}

/**
 * Locate candidate regions, hard-crop/upscale each, and decode Data Matrix.
 * After the first hits, re-seed neighbors (pack grid) for recall without extra tiles.
 */
export async function scanCanvasCrops(
  canvas: HTMLCanvasElement,
  knownHits: DetectedBarcode[] = [],
  deadline: number,
): Promise<DetectedBarcode[]> {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }

  const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const proposals = mergeProposals([
    proposeRegions(fullImageData),
    seedFromDetections(knownHits, canvas.width, canvas.height),
  ]);

  const firstPass = await decodeProposals(canvas, proposals, deadline);
  let merged = [...knownHits, ...firstPass];

  if (isExpired(deadline) || firstPass.length === 0) {
    return firstPass;
  }

  const neighborSeeds = mergeProposals([
    seedFromDetections(merged, canvas.width, canvas.height),
  ]);
  const extra = await decodeProposals(canvas, neighborSeeds, deadline);
  return [...firstPass, ...extra];
}

/** Uniform grid of crop windows — last-resort coverage for dense packs. */
export async function scanUniformCrops(
  canvas: HTMLCanvasElement,
  deadline: number,
): Promise<DetectedBarcode[]> {
  const windowSize = Math.max(
    64,
    Math.round(Math.min(canvas.width, canvas.height) / 10),
  );
  const proposals = uniformGridProposals(
    canvas.width,
    canvas.height,
    windowSize,
    Math.round(windowSize * 0.55),
  );
  return decodeProposals(canvas, proposals, deadline);
}
