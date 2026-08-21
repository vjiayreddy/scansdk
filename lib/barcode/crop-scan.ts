import { readBarcodes } from "zxing-wasm/reader";

import type { DetectedBarcode } from "./types";
import { isBlurry } from "./blur-detect";
import {
  applyClarifyFilters,
  applyCorrectionChain,
  applyHardClarifyFilters,
  applyHardCorrectionChain,
  applyThresholdVariants,
  invertImageData,
  suppressGlare,
} from "./correct-image";
import { dedupeBarcodes, mapReadResult } from "./map-result";
import {
  cylinderSkewQuads,
  extrapolateQuadFromDetection,
  quadFromRegion,
  quadToCropSpace,
  warpQuadToSquare,
} from "./perspective";
import {
  mergeProposals,
  multiScaleUniformProposals,
  proposeRegions,
  seedFromDetections,
  seedFromRowLayout,
  uniformGridProposals,
  type RegionProposal,
} from "./propose-regions";
import { proposeBottleLabelRegions, denseMicroGridProposals } from "./propose-bottle-labels";
import { analyzeScene } from "./scene-analysis";
import type { ReaderOptions } from "zxing-wasm/reader";

import {
  BINARIZER_PASSES,
  DATAMATRIX_CROP_OPTIONS,
  DATAMATRIX_HARD_CROP_OPTIONS,
  cropOptionsWithBinarizer,
} from "./reader-options";
import {
  isExpired,
  remainingMs,
  YIELD_EVERY_CROPS,
  yieldToUi,
} from "./scan-budget";

const CROP_PADDING = 0.45;
const MIN_CROP_SIDE = 220;
const LIVE_MAX_CROP_EDGE = 640;
const MIN_UPSCALE = 3;
const MIN_UPSCALE_BLUR = 5;
const MIN_UPSCALE_TINY = 6.5;
const TINY_PROPOSAL_SIDE = 64;
const DESKEW_THRESHOLD_DEG = 4;
const MAX_DESKEW_DEG = 15;
const MAX_DESKEW_HARD_DEG = 30;

export interface CropScanOptions {
  hardMode?: boolean;
  /** Skip expensive geometry passes — use for wide coverage sweeps. */
  fastOnly?: boolean;
  /** Override default Data-Matrix-only crop reader (e.g. live multi-format). */
  readerOptions?: ReaderOptions;
  /**
   * Live camera crops: ~12% YOLO expand, no extra 45% pad, capped upscale.
   * Skips smooth second-pass correction on the first fast attempt.
   */
  liveCrop?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function padProposal(
  proposal: RegionProposal,
  canvasWidth: number,
  canvasHeight: number,
  padRatio = CROP_PADDING,
): { x: number; y: number; width: number; height: number } {
  const padX = Math.round(proposal.width * padRatio);
  const padY = Math.round(proposal.height * padRatio);
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
function estimateDeskewAngle(
  imageData: ImageData,
  maxDeg = MAX_DESKEW_DEG,
): number {
  const { data, width, height } = imageData;
  const bins = new Array<number>(maxDeg * 2 + 1).fill(0);
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
      if (deg > maxDeg || deg < -maxDeg) {
        continue;
      }

      const bin = Math.round(deg + maxDeg);
      bins[bin] += mag;
    }
  }

  let bestBin = maxDeg;
  let bestScore = 0;
  for (let i = 0; i < bins.length; i += 1) {
    if (bins[i] > bestScore) {
      bestScore = bins[i];
      bestBin = i;
    }
  }

  return bestBin - maxDeg;
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
  options = DATAMATRIX_CROP_OPTIONS,
  exhaustive = false,
): Promise<ReturnType<typeof mapReadResult>[]> {
  const binarizers = exhaustive
    ? BINARIZER_PASSES
    : (["LocalAverage"] as const);

  for (const binarizer of binarizers) {
    const results = await readBarcodes(
      imageData,
      cropOptionsWithBinarizer(options, binarizer),
    );
    const valid = results
      .filter((result) => result.isValid && result.text.length > 0)
      .map((result) => mapReadResult(result));
    if (valid.length > 0) {
      return valid;
    }
  }

  if (!exhaustive) {
    return [];
  }

  // Tight YOLO crops sometimes decode only as "pure" symbols.
  const pure = await readBarcodes(imageData, {
    ...options,
    isPure: true,
    tryDownscale: false,
  });
  return pure
    .filter((result) => result.isValid && result.text.length > 0)
    .map((result) => mapReadResult(result));
}

async function decodeCropPasses(
  base: ImageData,
  hardMode = false,
  readerOptions: ReaderOptions = DATAMATRIX_CROP_OPTIONS,
): Promise<ReturnType<typeof mapReadResult>[]> {
  const hardOptions: ReaderOptions = {
    ...readerOptions,
    tryDenoise: true,
    tryHarder: true,
  };
  const first = await decodeImageData(base, readerOptions, hardMode);
  if (first.length > 0) {
    return first;
  }

  const fallbacks = hardMode
    ? [
        suppressGlare(base),
        applyHardClarifyFilters(suppressGlare(base)),
        applyHardCorrectionChain(suppressGlare(base)),
        applyCorrectionChain(base),
        applyClarifyFilters(base),
        invertImageData(base),
      ]
    : [applyCorrectionChain(base), invertImageData(base)];

  for (const imageData of fallbacks) {
    const options =
      hardMode && imageData !== base
        ? readerOptions === DATAMATRIX_CROP_OPTIONS
          ? DATAMATRIX_HARD_CROP_OPTIONS
          : hardOptions
        : readerOptions;
    const valid = await decodeImageData(imageData, options, hardMode);
    if (valid.length > 0) {
      return valid;
    }
  }

  if (hardMode) {
    for (const imageData of applyThresholdVariants(base)) {
      const valid = await decodeImageData(
        imageData,
        readerOptions === DATAMATRIX_CROP_OPTIONS
          ? DATAMATRIX_HARD_CROP_OPTIONS
          : hardOptions,
        true,
      );
      if (valid.length > 0) {
        return valid;
      }
    }
  }

  return [];
}

async function decodeRotations(
  cropCanvas: HTMLCanvasElement,
  hardMode: boolean,
): Promise<ReturnType<typeof mapReadResult>[]> {
  if (!hardMode) {
    return [];
  }

  for (const angleDeg of [90, 180, 270]) {
    const rotated = rotateCanvas(cropCanvas, angleDeg);
    const rotatedCtx = rotated.getContext("2d", { willReadFrequently: true });
    if (!rotatedCtx) {
      continue;
    }

    const rotatedData = rotatedCtx.getImageData(0, 0, rotated.width, rotated.height);
    const hits = await decodeCropPasses(rotatedData, true);
    if (hits.length > 0) {
      return hits.map((hit) => ({
        ...hit,
        cornerPoints: hit.cornerPoints.map((point) =>
          rotatePoint(
            point.x,
            point.y,
            rotated.width / 2,
            rotated.height / 2,
            (-angleDeg * Math.PI) / 180,
          ),
        ) as typeof hit.cornerPoints,
      }));
    }
  }

  return [];
}

function nearestReferenceHit(
  proposal: RegionProposal,
  knownHits: DetectedBarcode[],
): DetectedBarcode | null {
  if (knownHits.length === 0) {
    return null;
  }

  const center = {
    x: proposal.x + proposal.width / 2,
    y: proposal.y + proposal.height / 2,
  };

  let best: DetectedBarcode | null = null;
  let bestDist = Number.POSITIVE_INFINITY;

  for (const hit of knownHits) {
    const hitCenter = {
      x: hit.boundingBox.x + hit.boundingBox.width / 2,
      y: hit.boundingBox.y + hit.boundingBox.height / 2,
    };
    const dist = Math.hypot(center.x - hitCenter.x, center.y - hitCenter.y);
    const maxDist = Math.max(proposal.width, proposal.height) * 4;

    if (dist < bestDist && dist <= maxDist) {
      bestDist = dist;
      best = hit;
    }
  }

  return best;
}

async function decodePerspectivePasses(
  canvas: HTMLCanvasElement,
  region: { x: number; y: number; width: number; height: number },
  proposal: RegionProposal,
  knownHits: DetectedBarcode[],
  aggressive: boolean,
): Promise<ReturnType<typeof mapReadResult>[]> {
  if (!aggressive) {
    return [];
  }

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return [];
  }

  const fullData = ctx.getImageData(region.x, region.y, region.width, region.height);
  const targetCenter = {
    x: proposal.x + proposal.width / 2,
    y: proposal.y + proposal.height / 2,
  };
  const outputSize = Math.max(MIN_CROP_SIDE, Math.round(Math.min(region.width, region.height)));

  const reference = nearestReferenceHit(proposal, knownHits);
  const quads = reference
    ? [
        quadToCropSpace(
          extrapolateQuadFromDetection(reference, targetCenter),
          region.x,
          region.y,
        ),
      ]
    : [];

  for (const skew of [0.08, 0.12, -0.08, -0.12, 0.16]) {
    quads.push(
      quadToCropSpace(
        quadFromRegion(proposal, proposal.width * skew),
        region.x,
        region.y,
      ),
    );
  }

  for (const quad of cylinderSkewQuads(proposal).map((candidate) =>
    quadToCropSpace(candidate, region.x, region.y),
  )) {
    quads.push(quad);
  }

  for (const quad of quads) {
    const warped = warpQuadToSquare(fullData, quad, outputSize);
    const hits = await decodeCropPasses(warped, true);
    if (hits.length > 0) {
      return hits;
    }
  }

  return [];
}

function stretchCanvas(
  source: HTMLCanvasElement,
  scaleX: number,
  scaleY: number,
): HTMLCanvasElement {
  const stretched = document.createElement("canvas");
  stretched.width = Math.max(1, Math.round(source.width * scaleX));
  stretched.height = Math.max(1, Math.round(source.height * scaleY));
  const ctx = stretched.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, stretched.width, stretched.height);
  return stretched;
}

async function decodeCylinderPasses(
  cropCanvas: HTMLCanvasElement,
  aggressive: boolean,
): Promise<ReturnType<typeof mapReadResult>[]> {
  if (!aggressive) {
    return [];
  }

  const stretchY = [1.25, 1.15, 0.85, 0.75];
  const stretchX = [1, 1.08, 0.92];

  for (const sy of stretchY) {
    for (const sx of stretchX) {
      if (sx === 1 && sy === 1) {
        continue;
      }

      const stretched = stretchCanvas(cropCanvas, sx, sy);
      const ctx = stretched.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        continue;
      }

      const data = ctx.getImageData(0, 0, stretched.width, stretched.height);
      const hits = await decodeCropPasses(data, true);
      if (hits.length > 0) {
        return hits.map((hit) => ({
          ...hit,
          cornerPoints: hit.cornerPoints.map((point) => ({
            x: point.x / sx,
            y: point.y / sy,
          })) as typeof hit.cornerPoints,
        }));
      }
    }
  }

  return [];
}

async function decodeBottleStripPasses(
  canvas: HTMLCanvasElement,
  proposal: RegionProposal,
  deadline: number,
): Promise<ReturnType<typeof mapReadResult>[]> {
  if (isExpired(deadline) || proposal.score < 55_000) {
    return [];
  }

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return [];
  }

  const size = Math.max(36, proposal.width);
  const stripHeight = Math.round(size * 2.4);
  const x = Math.max(0, Math.round(proposal.x + proposal.width / 2 - size / 2));
  const y = Math.max(0, Math.round(proposal.y + proposal.height / 2 - stripHeight / 2));
  const width = Math.min(size, canvas.width - x);
  const height = Math.min(stripHeight, canvas.height - y);

  if (width < 24 || height < 48) {
    return [];
  }

  const stripData = ctx.getImageData(x, y, width, height);
  const step = Math.max(8, Math.round(size * 0.35));

  for (let offsetY = 0; offsetY + size <= height; offsetY += step) {
    for (const scaleY of [1, 1.18, 0.86, 1.28, 0.74]) {
      const slice = new ImageData(size, size);
      for (let py = 0; py < size; py += 1) {
        for (let px = 0; px < size; px += 1) {
          const srcY = Math.min(height - 1, Math.round(offsetY + py / scaleY));
          const srcX = Math.min(width - 1, px);
          const srcI = (srcY * width + srcX) * 4;
          const dstI = (py * size + px) * 4;
          slice.data[dstI] = stripData.data[srcI];
          slice.data[dstI + 1] = stripData.data[srcI + 1];
          slice.data[dstI + 2] = stripData.data[srcI + 2];
          slice.data[dstI + 3] = 255;
        }
      }

      const hits = await decodeCropPasses(suppressGlare(slice), true);
      if (hits.length > 0) {
        return hits.map((hit) => ({
          ...hit,
          cornerPoints: hit.cornerPoints.map((point) => ({
            x: point.x + x,
            y: point.y + y + offsetY,
          })) as typeof hit.cornerPoints,
        }));
      }
    }
  }

  return [];
}

function upscaleRegion(
  source: HTMLCanvasElement,
  region: { x: number; y: number; width: number; height: number },
  minUpscale = MIN_UPSCALE,
  smooth = false,
  maxEdge = 0,
): { canvas: HTMLCanvasElement; scale: number } {
  let scale = Math.max(
    minUpscale,
    MIN_CROP_SIDE / Math.min(region.width, region.height),
  );
  if (maxEdge > 0) {
    const longest = Math.max(region.width, region.height) * scale;
    if (longest > maxEdge) {
      scale = maxEdge / Math.max(region.width, region.height);
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(region.width * scale);
  canvas.height = Math.round(region.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }

  ctx.imageSmoothingEnabled = smooth || scale < 1;
  if (smooth || scale < 1) {
    ctx.imageSmoothingQuality = "high";
  }
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
  knownHits: DetectedBarcode[],
  options: CropScanOptions,
): Promise<DetectedBarcode[]> {
  if (isExpired(deadline)) {
    return [];
  }

  const hardMode = options.hardMode === true;
  const fastOnly = options.fastOnly === true;
  const liveCrop = options.liveCrop === true;
  const readerOpts = options.readerOptions ?? DATAMATRIX_CROP_OPTIONS;
  const scene = analyzeScene(
    canvas.width,
    canvas.height,
    knownHits,
    hardMode,
  );
  const region = padProposal(
    proposal,
    canvas.width,
    canvas.height,
    liveCrop ? 0 : CROP_PADDING,
  );
  const previewCtx = canvas.getContext("2d", { willReadFrequently: true });
  if (!previewCtx) {
    return [];
  }

  const preview = previewCtx.getImageData(region.x, region.y, region.width, region.height);
  const blurry = isBlurry(preview);
  const useHardPasses = !fastOnly && (hardMode || scene.aggressive || blurry);
  const tinyProposal = proposal.width <= TINY_PROPOSAL_SIDE;
  const minUpscale = liveCrop
    ? 1
    : fastOnly
      ? Math.max(MIN_UPSCALE, MIN_CROP_SIDE / Math.min(region.width, region.height))
      : tinyProposal
        ? MIN_UPSCALE_TINY
        : useHardPasses
          ? MIN_UPSCALE_BLUR
          : MIN_UPSCALE;

  const { canvas: cropCanvas, scale } = upscaleRegion(
    canvas,
    region,
    minUpscale,
    false,
    liveCrop ? LIVE_MAX_CROP_EDGE : 0,
  );
  const cropCtx = cropCanvas.getContext("2d", { willReadFrequently: true });
  if (!cropCtx) {
    return [];
  }

  const cropData = cropCtx.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
  let decoded = await decodeCropPasses(
    cropData,
    useHardPasses && !fastOnly,
    readerOpts,
  );
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

  // Soft JPEG packs often need bilinear upscale instead of nearest-neighbor.
  // Live first pass skips this — escalate only via reader options.
  if (!liveCrop && remainingMs(deadline) > 60) {
    const { canvas: smoothCanvas, scale: smoothScale } = upscaleRegion(
      canvas,
      region,
      minUpscale,
      true,
    );
    const smoothCtx = smoothCanvas.getContext("2d", { willReadFrequently: true });
    if (smoothCtx) {
      const smoothData = smoothCtx.getImageData(
        0,
        0,
        smoothCanvas.width,
        smoothCanvas.height,
      );
      decoded = await decodeCropPasses(
        smoothData,
        useHardPasses && !fastOnly,
        readerOpts,
      );
      if (decoded.length > 0) {
        return mappedHits(
          decoded,
          region,
          smoothScale,
          0,
          smoothCanvas.width,
          smoothCanvas.height,
        );
      }
    }
  }

  if (fastOnly) {
    if (!liveCrop && remainingMs(deadline) > 80) {
      decoded = await decodeCropPasses(
        applyCorrectionChain(cropData),
        false,
        readerOpts,
      );
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
    }
    return [];
  }

  if (useHardPasses && remainingMs(deadline) > 250) {
    const { canvas: largeCanvas, scale: largeScaleFactor } = upscaleRegion(
      canvas,
      region,
      minUpscale * 1.6,
    );
    const largeCtx = largeCanvas.getContext("2d", { willReadFrequently: true });
    if (largeCtx) {
      const largeData = largeCtx.getImageData(0, 0, largeCanvas.width, largeCanvas.height);
      decoded = await decodeCropPasses(largeData, true, readerOpts);
      if (decoded.length > 0) {
        return mappedHits(
          decoded,
          region,
          largeScaleFactor,
          0,
          largeCanvas.width,
          largeCanvas.height,
        );
      }
    }
  }

  if (remainingMs(deadline) < 400) {
    return [];
  }

  const maxDeskew = useHardPasses ? MAX_DESKEW_HARD_DEG : MAX_DESKEW_DEG;
  const angleDeg = estimateDeskewAngle(cropData, maxDeskew);
  if (Math.abs(angleDeg) >= DESKEW_THRESHOLD_DEG) {
    const rotated = rotateCanvas(cropCanvas, angleDeg);
    const rotatedCtx = rotated.getContext("2d", { willReadFrequently: true });
    if (rotatedCtx) {
      const rotatedData = rotatedCtx.getImageData(0, 0, rotated.width, rotated.height);
      decoded = await decodeCropPasses(rotatedData, useHardPasses, readerOpts);
      if (decoded.length > 0) {
        return mappedHits(
          decoded,
          region,
          scale,
          angleDeg,
          rotated.width,
          rotated.height,
        );
      }
    }
  }

  if (useHardPasses && remainingMs(deadline) > 300) {
    decoded = await decodeRotations(cropCanvas, true);
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
  }

  if (useHardPasses && remainingMs(deadline) > 250) {
    decoded = await decodeBottleStripPasses(canvas, proposal, deadline);
    if (decoded.length > 0) {
      return decoded.map((hit) => {
        const xs = hit.cornerPoints.map((point) => point.x);
        const ys = hit.cornerPoints.map((point) => point.y);
        return {
          ...hit,
          boundingBox: {
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
          },
        };
      });
    }
  }

  if (useHardPasses && remainingMs(deadline) > 300) {
    decoded = await decodeCylinderPasses(cropCanvas, scene.aggressive);
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
  }

  if (useHardPasses && remainingMs(deadline) > 300) {
    decoded = await decodePerspectivePasses(
      canvas,
      region,
      proposal,
      knownHits,
      scene.aggressive,
    );
    if (decoded.length > 0) {
      return mappedHits(
        decoded,
        region,
        1,
        0,
        region.width,
        region.height,
      );
    }
  }

  return [];
}

function proposalNearHits(
  proposal: RegionProposal,
  hits: DetectedBarcode[],
  margin = 2.2,
): boolean {
  if (hits.length === 0) {
    return proposal.score > 50_000;
  }

  const center = {
    x: proposal.x + proposal.width / 2,
    y: proposal.y + proposal.height / 2,
  };
  const reach = Math.max(proposal.width, proposal.height) * margin;

  return hits.some((hit) => {
    const hitCenter = {
      x: hit.boundingBox.x + hit.boundingBox.width / 2,
      y: hit.boundingBox.y + hit.boundingBox.height / 2,
    };
    return Math.hypot(center.x - hitCenter.x, center.y - hitCenter.y) <= reach;
  });
}

async function decodeProposalsTwoPhase(
  canvas: HTMLCanvasElement,
  proposals: RegionProposal[],
  deadline: number,
  knownHits: DetectedBarcode[],
  options: CropScanOptions,
): Promise<DetectedBarcode[]> {
  const fastOptions: CropScanOptions = { ...options, fastOnly: true };
  const fastHits = await decodeProposals(
    canvas,
    proposals,
    deadline,
    knownHits,
    fastOptions,
  );
  const merged = dedupeBarcodes([...knownHits, ...fastHits]);

  if (isExpired(deadline) || options.fastOnly) {
    return fastHits;
  }

  const deepCandidates = proposals.filter(
    (proposal) => proposalNearHits(proposal, merged) || proposal.score >= 55_000,
  );
  const deepOptions: CropScanOptions = {
    ...options,
    fastOnly: false,
    hardMode: options.hardMode || merged.length < 8,
  };

  const deepHits = await decodeProposals(
    canvas,
    deepCandidates.slice(0, hardModeCap(deepOptions, merged.length)),
    deadline,
    merged,
    deepOptions,
  );

  return dedupeBarcodes([...fastHits, ...deepHits]);
}

function hardModeCap(options: CropScanOptions, hitCount: number): number {
  if (options.hardMode) {
    return hitCount < 6 ? 45 : 28;
  }
  return hitCount < 6 ? 30 : 18;
}

async function decodeProposals(
  canvas: HTMLCanvasElement,
  proposals: RegionProposal[],
  deadline: number,
  knownHits: DetectedBarcode[],
  options: CropScanOptions,
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

    const hits = await decodeProposal(
      canvas,
      proposal,
      deadline,
      knownHits,
      options,
    );
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
  options: CropScanOptions = {},
): Promise<DetectedBarcode[]> {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }

  const hardMode = options.hardMode === true;
  const scene = analyzeScene(
    canvas.width,
    canvas.height,
    knownHits,
    hardMode,
  );
  const fullImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const microGrid = scene.sparse || hardMode
    ? denseMicroGridProposals(canvas.width, canvas.height, scene.maxProposals + 60)
    : [];
  const proposals = mergeProposals(
    [
      proposeBottleLabelRegions(fullImageData),
      microGrid,
      proposeRegions(fullImageData, scene.maxProposals),
      seedFromDetections(knownHits, canvas.width, canvas.height),
      seedFromRowLayout(knownHits, canvas.width, canvas.height),
    ],
    scene.maxProposals + (scene.sparse ? 80 : 0),
  );

  const firstPass = await decodeProposalsTwoPhase(
    canvas,
    proposals,
    deadline,
    knownHits,
    options,
  );
  const merged = [...knownHits, ...firstPass];

  if (isExpired(deadline)) {
    return firstPass;
  }

  const rowSeeds = mergeProposals(
    [seedFromRowLayout(merged, canvas.width, canvas.height)],
    scene.maxProposals,
  );
  const rowPass = await decodeProposalsTwoPhase(
    canvas,
    rowSeeds,
    deadline,
    merged,
    options,
  );
  const afterRows = dedupeBarcodes([...merged, ...rowPass]);

  if (isExpired(deadline)) {
    return dedupeBarcodes([...firstPass, ...rowPass]);
  }

  const neighborSeeds = mergeProposals(
    [seedFromDetections(afterRows, canvas.width, canvas.height)],
    scene.maxProposals,
  );
  const extra = await decodeProposalsTwoPhase(
    canvas,
    neighborSeeds,
    deadline,
    afterRows,
    options,
  );

  return dedupeBarcodes([...firstPass, ...rowPass, ...extra]);
}

/** Uniform grid of crop windows — last-resort coverage for dense packs. */
export async function scanUniformCrops(
  canvas: HTMLCanvasElement,
  deadline: number,
  options: CropScanOptions = {},
  knownHits: DetectedBarcode[] = [],
): Promise<DetectedBarcode[]> {
  const hardMode = options.hardMode === true;
  const scene = analyzeScene(
    canvas.width,
    canvas.height,
    knownHits,
    hardMode,
  );

  if (scene.sparse || hardMode) {
    const multiScale = multiScaleUniformProposals(
      canvas.width,
      canvas.height,
      scene.maxProposals,
    );
    const multiHits = await decodeProposalsTwoPhase(
      canvas,
      multiScale,
      deadline,
      knownHits,
      options,
    );
    if (multiHits.length > 0 || isExpired(deadline)) {
      return multiHits;
    }
  }

  const windowSize = Math.max(
    scene.sparse ? 52 : 64,
    Math.round(Math.min(canvas.width, canvas.height) / (scene.sparse ? 14 : 10)),
  );
  const proposals = uniformGridProposals(
    canvas.width,
    canvas.height,
    windowSize,
    Math.round(windowSize * 0.5),
    scene.maxProposals,
  );
  return decodeProposalsTwoPhase(canvas, proposals, deadline, knownHits, options);
}

/** Decode YOLO (or other) boxes as crop regions — fast sweep, then deep on misses. */
export async function scanLocatedRegions(
  canvas: HTMLCanvasElement,
  regions: Array<{ x: number; y: number; width: number; height: number; score?: number }>,
  deadline: number,
  options: CropScanOptions = {},
): Promise<DetectedBarcode[]> {
  const proposals: RegionProposal[] = regions
    .map((region) =>
      expandYoloRegion(
        region,
        canvas.width,
        canvas.height,
        options.liveCrop === true,
      ),
    )
    .map((region) => ({
      x: Math.round(region.x),
      y: Math.round(region.y),
      width: Math.round(region.width),
      height: Math.round(region.height),
      score: Math.round((region.score ?? 1) * 100_000),
    }))
    // Higher-confidence / larger boxes first so budget favors likely wins.
    .sort((a, b) => b.score - a.score || b.width * b.height - a.width * a.height);

  if (proposals.length === 0 || isExpired(deadline)) {
    return [];
  }

  const fastOptions: CropScanOptions = { ...options, fastOnly: true };
  const fastHits = await decodeProposals(
    canvas,
    proposals,
    deadline,
    [],
    fastOptions,
  );

  if (isExpired(deadline) || options.fastOnly) {
    return fastHits;
  }

  const missed = proposals.filter(
    (proposal) => !proposalCoveredByHit(proposal, fastHits),
  );
  if (missed.length === 0 || remainingMs(deadline) < 200) {
    return fastHits;
  }

  // Misses always get hard crop passes — normal mode previously skipped them.
  const deepOptions: CropScanOptions = {
    ...options,
    fastOnly: false,
    hardMode: true,
  };
  const deepHits = await decodeProposals(
    canvas,
    missed,
    deadline,
    fastHits,
    deepOptions,
  );

  return dedupeBarcodes([...fastHits, ...deepHits]);
}

/** Grow YOLO boxes so quiet-zone / module edges aren't clipped. */
function expandYoloRegion(
  region: { x: number; y: number; width: number; height: number; score?: number },
  canvasWidth: number,
  canvasHeight: number,
  liveCrop = false,
): { x: number; y: number; width: number; height: number; score?: number } {
  const ratio = liveCrop ? 0.12 : 0.22;
  const padX = Math.max(liveCrop ? 4 : 6, Math.round(region.width * ratio));
  const padY = Math.max(liveCrop ? 4 : 6, Math.round(region.height * ratio));
  const x = clamp(region.x - padX, 0, canvasWidth - 1);
  const y = clamp(region.y - padY, 0, canvasHeight - 1);
  const right = clamp(region.x + region.width + padX, x + 1, canvasWidth);
  const bottom = clamp(region.y + region.height + padY, y + 1, canvasHeight);
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
    score: region.score,
  };
}

function proposalCoveredByHit(
  proposal: RegionProposal,
  hits: DetectedBarcode[],
): boolean {
  const pad = Math.max(8, Math.min(proposal.width, proposal.height) * 0.35);
  const px = proposal.x - pad;
  const py = proposal.y - pad;
  const pw = proposal.width + pad * 2;
  const ph = proposal.height + pad * 2;

  return hits.some((hit) => {
    const cx = hit.boundingBox.x + hit.boundingBox.width / 2;
    const cy = hit.boundingBox.y + hit.boundingBox.height / 2;
    return cx >= px && cy >= py && cx <= px + pw && cy <= py + ph;
  });
}
