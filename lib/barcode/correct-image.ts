/**
 * Per-crop correction chain from warehouse barcode recovery practice:
 * grayscale → mild sharpen → mild contrast → adaptive threshold last.
 * Strengths stay low so Data Matrix modules are not eaten.
 */

const SHARPEN_AMOUNT = 0.7;
const HARD_SHARPEN_AMOUNT = 1.4;
const CONTRAST_FACTOR = 1.35;
const HARD_CONTRAST_FACTOR = 1.65;
const ADAPTIVE_WINDOW = 21;
const ADAPTIVE_C = 7;
const ADAPTIVE_C_VARIANTS = [4, 7, 11, 15];

function cloneImageData(imageData: ImageData): ImageData {
  return new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  );
}

function toGray(imageData: ImageData): Float32Array {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    gray[p] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  }

  return gray;
}

function writeGray(imageData: ImageData, gray: Float32Array): ImageData {
  const out = cloneImageData(imageData);
  const { data } = out;

  for (let p = 0, i = 0; p < gray.length; p += 1, i += 4) {
    const value = Math.max(0, Math.min(255, gray[p]));
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }

  return out;
}

/** Unsharp mask via 3×3 box blur. */
function sharpenGray(
  gray: Float32Array,
  width: number,
  height: number,
  amount = SHARPEN_AMOUNT,
): Float32Array {
  const out = new Float32Array(gray.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        out[index] = gray[index];
        continue;
      }

      let blur = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          blur += gray[(y + dy) * width + (x + dx)];
        }
      }
      blur /= 9;
      out[index] = gray[index] + amount * (gray[index] - blur);
    }
  }

  return out;
}

function contrastGray(gray: Float32Array, factor = CONTRAST_FACTOR): Float32Array {
  const out = new Float32Array(gray.length);

  for (let i = 0; i < gray.length; i += 1) {
    out[i] = (gray[i] - 128) * factor + 128;
  }

  return out;
}

function buildIntegral(gray: Float32Array, width: number, height: number): Float64Array {
  const integral = new Float64Array((width + 1) * (height + 1));

  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= width; x += 1) {
      rowSum += gray[(y - 1) * width + (x - 1)];
      integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + rowSum;
    }
  }

  return integral;
}

function localSum(
  integral: Float64Array,
  stride: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  return (
    integral[y1 * stride + x1] -
    integral[y0 * stride + x1] -
    integral[y1 * stride + x0] +
    integral[y0 * stride + x0]
  );
}

function adaptiveThresholdGrayWithC(
  gray: Float32Array,
  width: number,
  height: number,
  c: number,
): Float32Array {
  const radius = Math.floor(ADAPTIVE_WINDOW / 2);
  const integral = buildIntegral(gray, width, height);
  const stride = width + 1;
  const out = new Float32Array(gray.length);

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);

    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const count = (x1 - x0) * (y1 - y0);
      const mean = localSum(integral, stride, x0, y0, x1, y1) / Math.max(1, count);
      const index = y * width + x;
      out[index] = gray[index] < mean - c ? 0 : 255;
    }
  }

  return out;
}

function adaptiveThresholdGray(
  gray: Float32Array,
  width: number,
  height: number,
): Float32Array {
  return adaptiveThresholdGrayWithC(gray, width, height, ADAPTIVE_C);
}

/** Replace blown-out glare pixels with a local neighborhood median. */
export function suppressGlare(imageData: ImageData, threshold = 238): ImageData {
  const { width, height, data } = imageData;
  const out = cloneImageData(imageData);
  const dst = out.data;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = (y * width + x) * 4;
      const gray =
        data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;

      if (gray < threshold) {
        continue;
      }

      const samples: number[] = [];
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const j = ((y + dy) * width + (x + dx)) * 4;
          const neighbor =
            data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114;
          if (neighbor < threshold) {
            samples.push(neighbor);
          }
        }
      }

      if (samples.length === 0) {
        continue;
      }

      samples.sort((a, b) => a - b);
      const value = samples[Math.floor(samples.length / 2)];
      dst[i] = value;
      dst[i + 1] = value;
      dst[i + 2] = value;
    }
  }

  return out;
}

/** Several adaptive-threshold offsets for glare-heavy curved labels. */
export function applyThresholdVariants(imageData: ImageData): ImageData[] {
  const { width, height } = imageData;
  const deGlared = suppressGlare(imageData);
  const gray = contrastGray(sharpenGray(toGray(deGlared), width, height));

  return ADAPTIVE_C_VARIANTS.map((c) =>
    writeGray(imageData, adaptiveThresholdGrayWithC(gray, width, height, c)),
  );
}

/** Grayscale + sharpen + contrast. ZXing still applies its own binarizer. */
export function applyClarifyFilters(imageData: ImageData): ImageData {
  const { width, height } = imageData;
  const gray = contrastGray(sharpenGray(toGray(imageData), width, height));
  return writeGray(imageData, gray);
}

/** Full chain: clarify then local threshold (uneven glare / wrap lighting). */
export function applyCorrectionChain(imageData: ImageData): ImageData {
  const { width, height } = imageData;
  const clarified = contrastGray(sharpenGray(toGray(imageData), width, height));
  return writeGray(imageData, adaptiveThresholdGray(clarified, width, height));
}

/** Stronger sharpen + contrast for blurry / motion-soft crops. */
export function applyHardClarifyFilters(imageData: ImageData): ImageData {
  const { width, height } = imageData;
  const gray = toGray(imageData);
  const sharpened = sharpenGray(gray, width, height, HARD_SHARPEN_AMOUNT);
  const sharpenedTwice = sharpenGray(sharpened, width, height, HARD_SHARPEN_AMOUNT * 0.55);
  const clarified = contrastGray(sharpenedTwice, HARD_CONTRAST_FACTOR);
  return writeGray(imageData, clarified);
}

/** Hard-mode chain: aggressive clarify then adaptive threshold. */
export function applyHardCorrectionChain(imageData: ImageData): ImageData {
  const { width, height } = imageData;
  const gray = toGray(imageData);
  const sharpened = sharpenGray(gray, width, height, HARD_SHARPEN_AMOUNT);
  const clarified = contrastGray(sharpened, HARD_CONTRAST_FACTOR);
  return writeGray(imageData, adaptiveThresholdGray(clarified, width, height));
}

export function invertImageData(imageData: ImageData): ImageData {
  const copy = cloneImageData(imageData);
  const { data } = copy;

  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }

  return copy;
}
