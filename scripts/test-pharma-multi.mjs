/**
 * Headless multi Data Matrix recall check via UI.
 * Primary fixture is synthetic multi-data-matrix.png (pharma JPEGs are soft/low-res).
 *
 * Run with: SCAN_URL=http://localhost:3000 node scripts/test-pharma-multi.mjs
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const baseUrl = process.env.SCAN_URL ?? "http://localhost:3000";

const cases = [
  { file: "multi-data-matrix.png", minCount: 6 },
  { file: "data-matrix.png", minCount: 1 },
];

const browser = await chromium.launch();
const page = await browser.newPage();

let passed = 0;
let failed = 0;

for (const testCase of cases) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  const filePath = path.join(root, "test-fixtures", testCase.file);
  await page.locator('input[type="file"]').setInputFiles(filePath);

  await page.getByText("Detected Barcodes", { exact: false }).waitFor({
    timeout: 120000,
  });

  const heading = await page
    .getByText(/Detected Barcodes \(\d+\)/)
    .textContent();
  const match = heading?.match(/Detected Barcodes \((\d+)\)/);
  const count = match ? Number(match[1]) : 0;

  const dataMatrixLabels = await page
    .getByRole("listitem")
    .getByText("DATA MATRIX", { exact: true })
    .count();

  if (count >= testCase.minCount && dataMatrixLabels >= testCase.minCount) {
    console.log(
      `PASS ${testCase.file}: ${count} barcodes (${dataMatrixLabels} Data Matrix) >= ${testCase.minCount}`,
    );
    passed += 1;
  } else {
    console.error(
      `FAIL ${testCase.file}: got ${count} barcodes / ${dataMatrixLabels} Data Matrix, need >= ${testCase.minCount}`,
    );
    failed += 1;
  }
}

await browser.close();

console.log(`\nPharma multi results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
