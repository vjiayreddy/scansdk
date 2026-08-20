import type { DetectedBarcode } from "./types";

export interface RegionProposal {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}

/** Window sizes as fraction of min(canvas width, height). */
const SCALE_FRACTIONS = [0.03, 0.05, 0.08];
/** Absolute window sizes help when image resolution varies. */
const ABSOLUTE_SIZES = [48, 72, 96, 128];
const STRIDE_RATIO = 0.42;
const MAX_PROPOSALS = 40;
const NMS_IOU = 0.4;
const SAMPLE_STEP = 3;
const MIN_VARIANCE = 90;
const MIN_CONTRAST = 18;
const MIN_2D_RATIO = 0.28;
const SPATIAL_GRID = 8;
const PER_CELL_KEEP = 6;

function grayscaleAt(data: Uint8ClampedArray, index: number): number {
  return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
}

/**
 * Score windows that look like 2D codes (edges in both axes), not 1D text/glare.
 */
function scoreWindow(
  data: Uint8ClampedArray,
  canvasWidth: number,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  let sum = 0;
  let sumSq = 0;
  let min = 255;
  let max = 0;
  let count = 0;
  let gxEnergy = 0;
  let gyEnergy = 0;

  const right = x + width;
  const bottom = y + height;

  for (let py = y; py < bottom; py += SAMPLE_STEP) {
    for (let px = x; px < right; px += SAMPLE_STEP) {
      const index = (py * canvasWidth + px) * 4;
      const gray = grayscaleAt(data, index);
      sum += gray;
      sumSq += gray * gray;
      if (gray < min) min = gray;
      if (gray > max) max = gray;
      count += 1;

      if (px + SAMPLE_STEP < right && py + SAMPLE_STEP < bottom) {
        const rightGray = grayscaleAt(data, (py * canvasWidth + px + SAMPLE_STEP) * 4);
        const downGray = grayscaleAt(
          data,
          ((py + SAMPLE_STEP) * canvasWidth + px) * 4,
        );
        gxEnergy += Math.abs(rightGray - gray);
        gyEnergy += Math.abs(downGray - gray);
      }
    }
  }

  if (count < 8) {
    return 0;
  }

  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  const contrast = max - min;
  const edgeTotal = gxEnergy + gyEnergy;
  const twoDRatio =
    edgeTotal > 0 ? Math.min(gxEnergy, gyEnergy) / (edgeTotal / 2) : 0;

  if (variance < MIN_VARIANCE || contrast < MIN_CONTRAST) {
    return 0;
  }

  if (twoDRatio < MIN_2D_RATIO) {
    return 0;
  }

  return variance + contrast * 2 + twoDRatio * 80 + Math.min(width, 140) * 0.4;
}

function intersectionOverUnion(a: RegionProposal, b: RegionProposal): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const overlapW = Math.max(0, right - left);
  const overlapH = Math.max(0, bottom - top);
  const intersection = overlapW * overlapH;

  if (intersection <= 0) {
    return 0;
  }

  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function nonMaxSuppression(
  proposals: RegionProposal[],
  iouThreshold: number,
  maxKeep: number,
): RegionProposal[] {
  const sorted = [...proposals].sort((a, b) => b.score - a.score);
  const kept: RegionProposal[] = [];

  for (const candidate of sorted) {
    const overlaps = kept.some(
      (existing) => intersectionOverUnion(candidate, existing) >= iouThreshold,
    );

    if (!overlaps) {
      kept.push(candidate);
      if (kept.length >= maxKeep) {
        break;
      }
    }
  }

  return kept;
}

/** Keep top scores per spatial cell with size diversity so proposals cover codes fully. */
function spatialDiverseKeep(
  proposals: RegionProposal[],
  imageWidth: number,
  imageHeight: number,
  maxKeep: number,
): RegionProposal[] {
  const cellW = imageWidth / SPATIAL_GRID;
  const cellH = imageHeight / SPATIAL_GRID;
  const buckets = new Map<string, RegionProposal[]>();

  for (const proposal of proposals) {
    const cx = proposal.x + proposal.width / 2;
    const cy = proposal.y + proposal.height / 2;
    const col = Math.min(SPATIAL_GRID - 1, Math.floor(cx / cellW));
    const row = Math.min(SPATIAL_GRID - 1, Math.floor(cy / cellH));
    const key = `${row}:${col}`;
    const list = buckets.get(key) ?? [];
    list.push(proposal);
    buckets.set(key, list);
  }

  const selected: RegionProposal[] = [];
  for (const list of buckets.values()) {
    list.sort((a, b) => b.score - a.score);

    const bySize = new Map<number, RegionProposal>();
    for (const proposal of list) {
      if (!bySize.has(proposal.width)) {
        bySize.set(proposal.width, proposal);
      }
    }

    const sizeDiverse = [...bySize.values()].sort((a, b) => b.score - a.score);
    selected.push(...sizeDiverse.slice(0, PER_CELL_KEEP));
  }

  return nonMaxSuppression(selected, NMS_IOU, maxKeep);
}

function collectWindowSizes(minSide: number): number[] {
  const sizes = new Set<number>();

  for (const fraction of SCALE_FRACTIONS) {
    sizes.add(Math.round(minSide * fraction));
  }
  for (const size of ABSOLUTE_SIZES) {
    sizes.add(size);
  }

  return [...sizes].filter((size) => size >= 28 && size <= minSide);
}

/**
 * Propose square-ish regions likely to contain small Data Matrix codes.
 * Classical sliding windows + 2D texture filter + spatially diverse NMS.
 */
export function proposeRegions(
  imageData: ImageData,
  maxProposals = MAX_PROPOSALS,
): RegionProposal[] {
  const { data, width, height } = imageData;
  const minSide = Math.min(width, height);
  const proposals: RegionProposal[] = [];

  for (const windowSize of collectWindowSizes(minSide)) {
    const stride = Math.max(8, Math.round(windowSize * STRIDE_RATIO));

    for (let y = 0; y + windowSize <= height; y += stride) {
      for (let x = 0; x + windowSize <= width; x += stride) {
        const score = scoreWindow(data, width, x, y, windowSize, windowSize);
        if (score <= 0) {
          continue;
        }

        proposals.push({
          x,
          y,
          width: windowSize,
          height: windowSize,
          score,
        });
      }
    }
  }

  return spatialDiverseKeep(proposals, width, height, maxProposals);
}

/**
 * Pharma packs sit on a rough grid. Once one code is found, seed neighbors
 * at a similar size/pitch (Medium locate idea without a segmentation model).
 */
export function seedFromDetections(
  barcodes: DetectedBarcode[],
  canvasWidth: number,
  canvasHeight: number,
): RegionProposal[] {
  const seeds: RegionProposal[] = [];

  for (const barcode of barcodes) {
    const size = Math.max(
      36,
      Math.round(
        Math.max(barcode.boundingBox.width, barcode.boundingBox.height) * 1.2,
      ),
    );
    const pitch = size * 1.4;
    const originX = barcode.boundingBox.x + barcode.boundingBox.width / 2;
    const originY = barcode.boundingBox.y + barcode.boundingBox.height / 2;

    for (let row = -2; row <= 2; row += 1) {
      for (let col = -3; col <= 3; col += 1) {
        const cx = originX + col * pitch;
        const cy = originY + row * pitch;
        const x = Math.round(cx - size / 2);
        const y = Math.round(cy - size / 2);

        if (x < 0 || y < 0 || x + size > canvasWidth || y + size > canvasHeight) {
          continue;
        }

        seeds.push({
          x,
          y,
          width: size,
          height: size,
          score: 50_000 - (Math.abs(row) + Math.abs(col)) * 10,
        });
      }
    }
  }

  return nonMaxSuppression(seeds, 0.45, 36);
}

/** Uniform coverage fallback when texture ranking misses codes. */
export function uniformGridProposals(
  width: number,
  height: number,
  windowSize = 96,
  stride = 48,
): RegionProposal[] {
  const size = Math.max(40, Math.min(windowSize, Math.min(width, height)));
  const step = Math.max(16, stride);
  const proposals: RegionProposal[] = [];

  for (let y = 0; y + size <= height; y += step) {
    for (let x = 0; x + size <= width; x += step) {
      proposals.push({
        x,
        y,
        width: size,
        height: size,
        score: 1,
      });
    }
  }

  return proposals.slice(0, MAX_PROPOSALS);
}

export function mergeProposals(
  groups: RegionProposal[][],
  maxKeep = MAX_PROPOSALS,
): RegionProposal[] {
  return nonMaxSuppression(groups.flat(), NMS_IOU, maxKeep);
}
