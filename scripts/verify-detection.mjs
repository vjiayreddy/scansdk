/**
 * Headless verification script for barcode detection.
 * Run: node --experimental-vm-modules scripts/verify-detection.mjs
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const { BarcodeDetector, prepareZXingModule } = await import(
  "barcode-detector/ponyfill"
);

const wasmPath = path.join(root, "public/wasm/zxing_reader.wasm");
const wasmUrl = `file://${wasmPath}`;

prepareZXingModule({
  overrides: {
    locateFile: (filePath) => {
      if (filePath.endsWith(".wasm")) {
        return wasmUrl;
      }
      return filePath;
    },
  },
});

const detector = new BarcodeDetector();

const fixtures = [
  {
    file: "qr-code.png",
    expectedFormat: "qr_code",
    expectedValue: "HelloWorld",
  },
  {
    file: "ean13.png",
    expectedFormat: "ean_13",
    expectedValue: "1234567890128",
  },
  {
    file: "code128.png",
    expectedFormat: "code_128",
    expectedValue: "Code128Test",
  },
];

let passed = 0;
let failed = 0;

for (const fixture of fixtures) {
  const buffer = await readFile(path.join(root, "test-fixtures", fixture.file));
  const blob = new Blob([buffer], { type: "image/png" });
  const results = await detector.detect(blob);

  const match = results.find(
    (item) =>
      item.format === fixture.expectedFormat &&
      item.rawValue === fixture.expectedValue,
  );

  if (match) {
    console.log(`PASS ${fixture.file}: ${match.format} = ${match.rawValue}`);
    passed += 1;
  } else {
    console.error(`FAIL ${fixture.file}`);
    console.error("  expected:", fixture);
    console.error("  got:", results);
    failed += 1;
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
