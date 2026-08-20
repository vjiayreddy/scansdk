/** Laplacian variance — low values indicate motion blur / soft focus. */
export function laplacianVariance(imageData: ImageData): number {
  const { data, width, height } = imageData;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  const step = 2;

  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const i = (y * width + x) * 4;
      const center =
        data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const left =
        data[i - 4] * 0.299 + data[i - 3] * 0.587 + data[i - 2] * 0.114;
      const right =
        data[i + 4] * 0.299 + data[i + 5] * 0.587 + data[i + 6] * 0.114;
      const up =
        data[i - width * 4] * 0.299 +
        data[i - width * 4 + 1] * 0.587 +
        data[i - width * 4 + 2] * 0.114;
      const down =
        data[i + width * 4] * 0.299 +
        data[i + width * 4 + 1] * 0.587 +
        data[i + width * 4 + 2] * 0.114;
      const laplacian = 4 * center - left - right - up - down;

      sum += laplacian;
      sumSq += laplacian * laplacian;
      count += 1;
    }
  }

  if (count === 0) {
    return 0;
  }

  const mean = sum / count;
  return sumSq / count - mean * mean;
}

/** Empirical threshold for upscaled crop windows (~180px side). */
export const BLUR_VARIANCE_THRESHOLD = 110;

export function isBlurry(imageData: ImageData): boolean {
  return laplacianVariance(imageData) < BLUR_VARIANCE_THRESHOLD;
}
