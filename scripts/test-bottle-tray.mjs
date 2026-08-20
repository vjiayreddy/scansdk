/**
 * Quick test for pharma bottle tray fixture.
 * Run: node scripts/test-bottle-tray.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { createServer } from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, ".tmp-verify");

spawnSync(
  "npx",
  [
    "esbuild",
    path.join(outDir, "entry.ts"),
    "--bundle",
    "--format=esm",
    `--outfile=${path.join(outDir, "pipeline.js")}`,
    "--platform=browser",
    "--target=es2022",
    "--log-level=error",
  ],
  { cwd: root, stdio: "inherit" },
);

const wasmBytes = readFileSync(path.join(root, "public/wasm/zxing_reader.wasm"));
const fixture = "pharma-bottles-tray.png";
const buffer = readFileSync(path.join(root, "test-fixtures", fixture));

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

const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__ready === true);

for (const mode of ["normal", "hard"]) {
  const started = Date.now();
  const result = await page.evaluate(
    async ({ bytes, name, mode: scanMode }) => {
      const file = new File([new Uint8Array(bytes)], name, { type: "image/png" });
      const { prepareCanvasFromFile } = await import("/pipeline.js");
      return window.__scanFile(file, scanMode);
    },
    { bytes: [...buffer], name: fixture, mode },
  ).catch(async () => {
    const startedInner = Date.now();
    const result = await page.evaluate(
      async ({ bytes, name }) => {
        const file = new File([new Uint8Array(bytes)], name, { type: "image/png" });
        return window.__scanFile(file);
      },
      { bytes: [...buffer], name: fixture },
    );
    return { ...result, elapsed: Date.now() - startedInner, mode: "normal-fallback" };
  });

  console.log(
    `${mode}: ${result.count} barcodes in ${Date.now() - started}ms`,
    result.values?.slice(0, 12),
  );
}

await browser.close();
server.close();
