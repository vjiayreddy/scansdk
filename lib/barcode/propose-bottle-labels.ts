import type { RegionProposal } from "./propose-regions";

const SAMPLE = 3;

function grayscaleAt(data: Uint8ClampedArray, index: number): number {
  return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
}

function isGreenCap(r: number, g: number, b: number): boolean {
  return g > 95 && g > r * 1.25 && g > b * 1.2 && r < 130 && b < 130;
}

function isBrightLabel(r: number, g: number, b: number): number {
  const gray = r * 0.299 + g * 0.587 + b * 0.114;
  return gray > 185 && gray < 250 ? gray : 0;
}

/** Cluster cap/label centroids on a coarse grid. */
function clusterPoints(
  points: { x: number; y: number; weight: number }[],
  cellSize: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number; weight: number }[] {
  const buckets = new Map<string, { x: number; y: number; weight: number }>();

  for (const point of points) {
    const col = Math.floor(point.x / cellSize);
    const row = Math.floor(point.y / cellSize);
    const key = `${row}:${col}`;
    const existing = buckets.get(key);

    if (!existing || point.weight > existing.weight) {
      buckets.set(key, point);
    } else if (existing) {
      existing.x = (existing.x + point.x) / 2;
      existing.y = (existing.y + point.y) / 2;
      existing.weight += point.weight;
    }
  }

  return [...buckets.values()].filter(
    (point) =>
      point.x >= 0 &&
      point.y >= 0 &&
      point.x < canvasWidth &&
      point.y < canvasHeight,
  );
}

/**
 * Pharma bottle trays: green caps + white labels are strong anchors.
 * Propose label-sized windows below each cap cluster.
 */
export function proposeBottleLabelRegions(imageData: ImageData): RegionProposal[] {
  const { data, width, height } = imageData;
  const capPoints: { x: number; y: number; weight: number }[] = [];
  const labelPoints: { x: number; y: number; weight: number }[] = [];

  for (let y = 0; y < height; y += SAMPLE) {
    for (let x = 0; x < width; x += SAMPLE) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      if (isGreenCap(r, g, b)) {
        capPoints.push({ x, y, weight: g });
      }

      const labelScore = isBrightLabel(r, g, b);
      if (labelScore > 0) {
        labelPoints.push({ x, y, weight: labelScore });
      }
    }
  }

  const capClusters = clusterPoints(capPoints, 28, width, height);
  const labelClusters = clusterPoints(labelPoints, 24, width, height);
  const proposals: RegionProposal[] = [];
  const labelSize = Math.max(
    32,
    Math.min(72, Math.round(Math.min(width, height) / 22)),
  );

  for (const cap of capClusters) {
    const labelY = cap.y + labelSize * 0.55;
    proposals.push({
      x: Math.round(cap.x - labelSize / 2),
      y: Math.round(labelY - labelSize / 2),
      width: labelSize,
      height: labelSize,
      score: 60_000 + cap.weight,
    });
  }

  for (const label of labelClusters) {
    proposals.push({
      x: Math.round(label.x - labelSize / 2),
      y: Math.round(label.y - labelSize / 2),
      width: labelSize,
      height: labelSize,
      score: 55_000 + label.weight * 0.5,
    });
  }

  return proposals;
}

/** High-density small-window sweep for tiny curved labels. */
export function denseMicroGridProposals(
  width: number,
  height: number,
  maxProposals = 160,
): RegionProposal[] {
  const size = Math.max(
    28,
    Math.min(44, Math.round(Math.min(width, height) / 28)),
  );
  const stride = Math.max(12, Math.round(size * 0.55));
  const proposals: RegionProposal[] = [];

  for (let y = 0; y + size <= height; y += stride) {
    for (let x = 0; x + size <= width; x += stride) {
      proposals.push({ x, y, width: size, height: size, score: 100 });
    }
  }

  return proposals.slice(0, maxProposals);
}
