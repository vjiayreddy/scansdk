/**
 * Headless recall check using the real lib/barcode pipeline (esbuild CLI bundle).
 * Run: node scripts/verify-pharma-pipeline.mjs
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, ".tmp-verify");
mkdirSync(outDir, { recursive: true });

const entry = path.join(outDir, "entry.ts");
writeFileSync(
  entry,
  `
import { prepareZXingModule } from "zxing-wasm/reader";
import { prepareCanvasFromFile } from "../lib/barcode/preprocess";
import { scanCanvas } from "../lib/barcode/tile-scan";

prepareZXingModule({
  overrides: {
    locateFile: (filePath: string, prefix: string) => {
      if (filePath.endsWith(".wasm")) {
        return "/wasm/" + filePath;
      }
      return prefix + filePath;
    },
  },
});

export async function scanFile(file: File) {
  const { canvas, originalSize } = await prepareCanvasFromFile(file);
  const barcodes = await scanCanvas(canvas);
  return {
    count: barcodes.length,
    formats: barcodes.map((b) => b.format),
    values: barcodes.map((b) => b.rawValue),
    imageSize: originalSize,
  };
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
    `--outfile=${path.join(outDir, "pipeline.js")}`,
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

const wasmBytes = readFileSync(
  path.join(root, "public/wasm/zxing_reader.wasm"),
);

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url === "/pipeline.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    res.end(readFileSync(path.join(outDir, "pipeline.js")));
    return;
  }
  if (url === "/wasm/zxing_reader.wasm") {
    res.writeHead(200, { "Content-Type": "application/wasm" });
    res.end(wasmBytes);
    return;
  }
  if (url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><html><body><script type="module">
      import { scanFile } from "/pipeline.js";
      window.__scanFile = scanFile;
      window.__ready = true;
    </script></body></html>`);
    return;
  }
  res.writeHead(404);
  res.end();
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());

const fixtures = [
  // Hard scattered grid — primary multi-detect regression.
  { file: "multi-data-matrix.png", minCount: 6 },
  { file: "multi-data-matrix-tiny.png", minCount: 5 },
  { file: "data-matrix.png", minCount: 1 },
  // Real pharma JPEGs are heavily compressed; treat as soft (informational) checks.
  { file: "pharma-bin-crop.png", minCount: 1, soft: true },
  { file: "pharma-bin.png", minCount: 1, soft: true },
];

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (err) => console.error("pageerror:", err.message));
page.on("console", (msg) => {
  if (msg.type() === "error") console.error("console:", msg.text());
});

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__ready === true, null, {
  timeout: 30000,
});

let failed = 0;

for (const fixture of fixtures) {
  const buffer = readFileSync(path.join(root, "test-fixtures", fixture.file));
  const started = Date.now();
  const result = await page.evaluate(
    async ({ bytes, name, type }) => {
      const file = new File([new Uint8Array(bytes)], name, { type });
      return window.__scanFile(file);
    },
    {
      bytes: [...buffer],
      name: fixture.file,
      type: "image/png",
    },
  );
  const elapsed = Date.now() - started;

  const ok = result.count >= fixture.minCount;
  const label = fixture.soft ? (ok ? "SOFT-PASS" : "SOFT-MISS") : ok ? "PASS" : "FAIL";
  console.log(
    `${label} ${fixture.file}: ${result.count} barcodes (need >= ${fixture.minCount}) in ${elapsed}ms (${result.imageSize.width}x${result.imageSize.height})`,
  );
  if (result.values?.length) {
    console.log(`  values: ${result.values.slice(0, 8).join(" | ")}`);
  }
  if (!ok && !fixture.soft) failed += 1;
}

await browser.close();
server.close();
process.exit(failed > 0 ? 1 : 0);
