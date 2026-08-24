/**
 * YOLO locate eval on val set — same ORT Web path as the app.
 * Run: node scripts/eval-yolo-locate.mjs
 */
import { chromium } from "playwright";
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, ".tmp-eval-locate");
const dataRoot = path.join(root, "datasets/barcode_best_training_images");
const valImages = path.join(dataRoot, "images/val");
const valLabels = path.join(dataRoot, "labels/val");
const IOU_THRESH = 0.5;

if (!existsSync(valImages)) {
  console.error("Val images missing. Unpack barcode_best_training_images.zip to datasets/");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const entry = path.join(outDir, "entry.ts");
writeFileSync(
  entry,
  `
import * as ort from "onnxruntime-web/wasm";
import {
  parseYoloOutputData,
  rgbaToChw,
  boxIou,
} from "../lib/barcode/yolo-core";

const IMGSZ = 960;

function letterbox(bitmap: ImageBitmap) {
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const scale = Math.min(IMGSZ / sourceWidth, IMGSZ / sourceHeight);
  const newWidth = Math.round(sourceWidth * scale);
  const newHeight = Math.round(sourceHeight * scale);
  const padX = (IMGSZ - newWidth) / 2;
  const padY = (IMGSZ - newHeight) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = IMGSZ;
  canvas.height = IMGSZ;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "rgb(114, 114, 114)";
  ctx.fillRect(0, 0, IMGSZ, IMGSZ);
  ctx.drawImage(bitmap, padX, padY, newWidth, newHeight);
  const tensor = new Float32Array(3 * IMGSZ * IMGSZ);
  rgbaToChw(ctx.getImageData(0, 0, IMGSZ, IMGSZ).data, IMGSZ, tensor);
  return { tensor, scale, padX, padY, sourceWidth, sourceHeight };
}

let sessionPromise: Promise<ort.InferenceSession> | null = null;

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = "/ort/";
      const response = await fetch("/models/barcode-yolo11n.onnx");
      if (!response.ok) throw new Error("ONNX fetch failed");
      const model = new Uint8Array(await response.arrayBuffer());
      return ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
    })();
  }
  return sessionPromise;
}

export async function locateImage(url: string) {
  const session = await getSession();
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const { tensor, scale, padX, padY, sourceWidth, sourceHeight } = letterbox(bitmap);
  const inputName = session.inputNames[0] ?? "images";
  const input = new ort.Tensor("float32", tensor, [1, 3, IMGSZ, IMGSZ]);
  const results = await session.run({ [inputName]: input });
  const outputName = session.outputNames[0];
  const output = outputName ? results[outputName] : Object.values(results)[0];
  if (!output) return [];
  return parseYoloOutputData(
    output.data as Float32Array,
    output.dims,
    scale,
    padX,
    padY,
    sourceWidth,
    sourceHeight,
  );
}
`,
);

const bundle = spawnSync(
  "npx",
  [
    "esbuild",
    entry,
    "--bundle",
    "--format=esm",
    `--outfile=${path.join(outDir, "locate.js")}`,
    "--platform=browser",
    "--target=es2022",
    "--log-level=error",
  ],
  { cwd: root, encoding: "utf8" },
);

if (bundle.status !== 0) {
  console.error(bundle.stdout);
  console.error(bundle.stderr);
  process.exit(1);
}

const onnxBytes = readFileSync(path.join(root, "public/models/barcode-yolo11n.onnx"));

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url === "/locate.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    res.end(readFileSync(path.join(outDir, "locate.js")));
    return;
  }
  if (url === "/models/barcode-yolo11n.onnx") {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(onnxBytes);
    return;
  }
  if (url.startsWith("/ort/")) {
    const file = url.slice("/ort/".length);
    const filePath = path.join(root, "public/ort", file);
    if (existsSync(filePath)) {
      const type = file.endsWith(".wasm") ? "application/wasm" : "text/javascript";
      res.writeHead(200, { "Content-Type": type });
      res.end(readFileSync(filePath));
      return;
    }
  }
  if (url.startsWith("/val/")) {
    const file = decodeURIComponent(url.slice("/val/".length));
    const filePath = path.join(valImages, file);
    if (filePath.startsWith(valImages) && existsSync(filePath)) {
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      res.end(readFileSync(filePath));
      return;
    }
  }
  if (url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><html><body><script type="module">
      import { locateImage } from "/locate.js";
      window.__locateImage = locateImage;
      window.__ready = true;
    </script></body></html>`);
    return;
  }
  res.writeHead(404);
  res.end();
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const images = readdirSync(valImages).filter((f) => /\.(jpe?g|png)$/i.test(f));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(base);
await page.waitForFunction(() => window.__ready === true, { timeout: 60000 });

let tp = 0;
let fp = 0;
let fn = 0;
const misses = [];

for (const name of images) {
  const labelPath = path.join(valLabels, name.replace(/\.[^.]+$/, ".txt"));
  const gtLines = existsSync(labelPath)
    ? readFileSync(labelPath, "utf8").split("\n").filter(Boolean)
    : [];

  const result = await page.evaluate(
    async ({ imageUrl, gtLines, iouThresh }) => {
      const locateImage = window.__locateImage;
      if (typeof locateImage !== "function") {
        throw new Error("locateImage not ready");
      }
      const bitmap = await createImageBitmap(await (await fetch(imageUrl)).blob());
      const imgW = bitmap.width;
      const imgH = bitmap.height;

      const gt = gtLines.map((line) => {
        const parts = line.trim().split(/\s+/).map(Number);
        const [, cx, cy, w, h] = parts;
        const width = w * imgW;
        const height = h * imgH;
        return {
          x: cx * imgW - width / 2,
          y: cy * imgH - height / 2,
          width,
          height,
        };
      });

      const preds = await locateImage(imageUrl);

      function iou(a, b) {
        const ax2 = a.x + a.width;
        const ay2 = a.y + a.height;
        const bx2 = b.x + b.width;
        const by2 = b.y + b.height;
        const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
        const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
        const inter = ix * iy;
        const union = a.width * a.height + b.width * b.height - inter;
        return union <= 0 ? 0 : inter / union;
      }

      const matchedGt = new Set();
      const matchedPred = new Set();
      let localTp = 0;

      for (let pi = 0; pi < preds.length; pi += 1) {
        let bestGi = -1;
        let bestIou = 0;
        for (let gi = 0; gi < gt.length; gi += 1) {
          if (matchedGt.has(gi)) continue;
          const score = iou(preds[pi], gt[gi]);
          if (score > bestIou) {
            bestIou = score;
            bestGi = gi;
          }
        }
        if (bestGi >= 0 && bestIou >= iouThresh) {
          matchedGt.add(bestGi);
          matchedPred.add(pi);
          localTp += 1;
        }
      }

      return {
        gt: gt.length,
        pred: preds.length,
        tp: localTp,
        fp: preds.length - matchedPred.size,
        fn: gt.length - matchedGt.size,
      };
    },
    { imageUrl: `${base}/val/${encodeURIComponent(name)}`, gtLines, iouThresh: IOU_THRESH },
  );

  tp += result.tp;
  fp += result.fp;
  fn += result.fn;
  if (result.fn > 0) {
    misses.push({ name, ...result });
  }
}

await browser.close();
server.close();

const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
const recall = tp + fn > 0 ? tp / (tp + fn) : 0;

console.log(`Val images: ${images.length}`);
console.log(`IoU threshold: ${IOU_THRESH}`);
console.log(`TP=${tp} FP=${fp} FN=${fn}`);
console.log(`Precision: ${(precision * 100).toFixed(1)}%`);
console.log(`Recall: ${(recall * 100).toFixed(1)}%`);

if (misses.length > 0) {
  console.log(`\nMissed boxes in ${misses.length} images (first 10):`);
  for (const item of misses.slice(0, 10)) {
    console.log(`  ${item.name}: gt=${item.gt} pred=${item.pred} fn=${item.fn}`);
  }
}

const pass = recall >= 0.9 && precision >= 0.85;
console.log(pass ? "\nPASS locate eval" : "\nFAIL locate eval");
process.exit(pass ? 0 : 1);
