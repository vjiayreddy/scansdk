export type Point = { x: number; y: number };

type Quad = [Point, Point, Point, Point];

/** Trapezoid quads that approximate partial cylinder unwrap on bottle labels. */
export function cylinderSkewQuads(
  region: { x: number; y: number; width: number; height: number },
): Quad[] {
  const { x, y, width, height } = region;
  const skews = [
    { top: -width * 0.12, bottom: width * 0.12 },
    { top: width * 0.12, bottom: -width * 0.12 },
    { top: -width * 0.08, bottom: width * 0.16 },
    { top: width * 0.16, bottom: -width * 0.08 },
    { top: -width * 0.18, bottom: width * 0.06 },
    { top: width * 0.06, bottom: -width * 0.18 },
  ];

  return skews.map(({ top, bottom }) => [
    { x: x + top, y },
    { x: x + width + top, y },
    { x: x + width + bottom, y: y + height },
    { x: x + bottom, y: y + height },
  ] as Quad);
}

function cloneImageData(imageData: ImageData): ImageData {
  return new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  );
}

function sampleBilinear(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number] {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0;
  const fy = y - y0;

  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;

  const channels: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c += 1) {
    const v00 = data[i00 + c];
    const v10 = data[i10 + c];
    const v01 = data[i01 + c];
    const v11 = data[i11 + c];
    const top = v00 * (1 - fx) + v10 * fx;
    const bottom = v01 * (1 - fx) + v11 * fx;
    channels[c] = top * (1 - fy) + bottom * fy;
  }

  return channels;
}

/** 4-point homography (src → dst). Returns 3×3 row-major matrix. */
function computeHomography(src: Quad, dst: Quad): number[] {
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i += 1) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const h = solveLinear8(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function solveLinear8(A: number[][], b: number[]): number[] {
  const n = 8;
  const aug = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[pivot][col])) {
        pivot = row;
      }
    }
    [aug[col], aug[pivot]] = [aug[pivot], aug[col]];

    const div = aug[col][col] || 1e-9;
    for (let j = col; j <= n; j += 1) {
      aug[col][j] /= div;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) {
        continue;
      }
      const factor = aug[row][col];
      for (let j = col; j <= n; j += 1) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  return aug.map((row) => row[n]);
}

function invertHomography(h: number[]): number[] | null {
  const [
    a,
    b,
    c,
    d,
    e,
    f,
    g,
    hVal,
    i,
  ] = h;

  const A = e * i - f * hVal;
  const B = c * hVal - b * i;
  const C = b * f - c * e;
  const D = f * g - d * i;
  const E = a * i - c * g;
  const F = c * d - a * f;
  const G = d * hVal - e * g;
  const H = b * g - a * hVal;
  const I = a * e - b * d;
  const det = a * A + b * D + c * G;

  if (Math.abs(det) < 1e-9) {
    return null;
  }

  return [A / det, B / det, C / det, D / det, E / det, F / det, G / det, H / det, I / det];
}

function applyHomography(h: number[], x: number, y: number): Point {
  const w = h[6] * x + h[7] * y + h[8];
  return {
    x: (h[0] * x + h[1] * y + h[2]) / w,
    y: (h[3] * x + h[4] * y + h[5]) / w,
  };
}

/** Perspective-warp a quad region into a square canvas for decode. */
export function warpQuadToSquare(
  source: ImageData,
  quad: Quad,
  outputSize: number,
): ImageData {
  const dst: Quad = [
    { x: 0, y: 0 },
    { x: outputSize, y: 0 },
    { x: outputSize, y: outputSize },
    { x: 0, y: outputSize },
  ];

  const forward = computeHomography(quad, dst);
  const inverse = invertHomography(forward);
  if (!inverse) {
    return cloneImageData(source);
  }

  const out = new ImageData(outputSize, outputSize);
  const { data: srcData, width, height } = source;

  for (let y = 0; y < outputSize; y += 1) {
    for (let x = 0; x < outputSize; x += 1) {
      const src = applyHomography(inverse, x, y);
      if (src.x < 0 || src.y < 0 || src.x >= width - 1 || src.y >= height - 1) {
        continue;
      }

      const [r, g, b] = sampleBilinear(srcData, width, height, src.x, src.y);
      const o = (y * outputSize + x) * 4;
      out.data[o] = r;
      out.data[o + 1] = g;
      out.data[o + 2] = b;
      out.data[o + 3] = 255;
    }
  }

  return out;
}

/** Shift a decoded quad to another grid cell using the reference orientation. */
export function extrapolateQuadFromDetection(
  reference: {
    cornerPoints: readonly Point[];
    boundingBox: { x: number; y: number; width: number; height: number };
  },
  targetCenter: Point,
): Quad {
  const refCenter = {
    x: reference.boundingBox.x + reference.boundingBox.width / 2,
    y: reference.boundingBox.y + reference.boundingBox.height / 2,
  };
  const dx = targetCenter.x - refCenter.x;
  const dy = targetCenter.y - refCenter.y;

  return reference.cornerPoints.map((point) => ({
    x: point.x + dx,
    y: point.y + dy,
  })) as Quad;
}

/** Axis-aligned proposal as a quad (slight perspective skew for hard-mode attempts). */
export function quadFromRegion(
  region: { x: number; y: number; width: number; height: number },
  skewX = 0,
  skewY = 0,
): Quad {
  const { x, y, width, height } = region;
  return [
    { x: x - skewX, y: y - skewY },
    { x: x + width + skewX, y: y + skewY },
    { x: x + width + skewX, y: y + height + skewY },
    { x: x - skewX, y: y + height - skewY },
  ];
}

/** Convert canvas-space quad into crop-local coordinates. */
export function quadToCropSpace(quad: Quad, cropX: number, cropY: number): Quad {
  return quad.map((point) => ({
    x: point.x - cropX,
    y: point.y - cropY,
  })) as Quad;
}
