import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const imageBase64 = readFileSync(
  path.join(root, "test-fixtures", "pharma-bin-crop.png"),
).toString("base64");

const browser = await chromium.launch();
const page = await browser.newPage();

const result = await page.evaluate(async (base64) => {
  const { readBarcodes, prepareZXingModule } = await import(
    "https://fastly.jsdelivr.net/npm/zxing-wasm@3.1.3/dist/es/reader/index.js"
  );

  prepareZXingModule({
    overrides: {
      locateFile: (filePath) =>
        `https://fastly.jsdelivr.net/npm/zxing-wasm@3.1.3/dist/reader/${filePath}`,
    },
  });

  const blob = await fetch(`data:image/png;base64,${base64}`).then((r) => r.blob());
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);

  const options = {
    tryHarder: true,
    tryDenoise: true,
    tryDownscale: false,
    formats: ["DataMatrix"],
    maxNumberOfSymbols: 255,
  };

  async function scanRegion(x, y, w, h, upscale = 1) {
    const tile = document.createElement("canvas");
    tile.width = Math.round(w * upscale);
    tile.height = Math.round(h * upscale);
    const tctx = tile.getContext("2d");
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(canvas, x, y, w, h, 0, 0, tile.width, tile.height);
    const found = await readBarcodes(
      tctx.getImageData(0, 0, tile.width, tile.height),
      options,
    );
    return found.map((item) => item.text);
  }

  const attempts = [];
  const regions = [
    [40, 20, 120, 120],
    [60, 30, 100, 100],
    [300, 20, 120, 120],
    [540, 20, 120, 120],
    [40, 180, 120, 120],
  ];

  for (const [x, y, w, h] of regions) {
    attempts.push({
      region: [x, y, w, h],
      x1: await scanRegion(x, y, w, h, 1),
      x2: await scanRegion(x, y, w, h, 2),
      x4: await scanRegion(x, y, w, h, 4),
    });
  }

  return { size: { width: canvas.width, height: canvas.height }, attempts };
}, imageBase64);

console.log(JSON.stringify(result, null, 2));
await browser.close();
