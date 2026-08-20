import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const baseUrl = process.env.SCAN_URL ?? "http://localhost:3001";

const fixtures = [
  {
    file: "qr-code.png",
    expectedValue: "HelloWorld",
    expectedFormat: "QR CODE",
  },
  {
    file: "ean13.png",
    expectedValue: "1234567890128",
    expectedFormat: "EAN 13",
  },
  {
    file: "code128.png",
    expectedValue: "Code128Test",
    expectedFormat: "CODE 128",
  },
  {
    file: "data-matrix.png",
    expectedValue: "DataMatrixTest",
    expectedFormat: "DATA MATRIX",
  },
];

const browser = await chromium.launch();
const page = await browser.newPage();

let passed = 0;
let failed = 0;

for (const fixture of fixtures) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  const filePath = path.join(root, "test-fixtures", fixture.file);
  await page.locator('input[type="file"]').setInputFiles(filePath);

  await page.getByText("Detected Barcodes", { exact: false }).waitFor({
    timeout: 30000,
  });

  const previewLoaded = await page.locator('img[alt="Uploaded preview"]').evaluate(
    (img) => img instanceof HTMLImageElement && img.naturalWidth > 0,
  );

  const overlayStats = await page.locator("svg rect, svg polygon").evaluateAll((nodes) => {
    return nodes.map((node) => {
      const shape = node;
      const box = shape.getBBox();
      const svg = shape.ownerSVGElement;
      const viewBox = svg?.viewBox.baseVal;

      return {
        width: box.width,
        height: box.height,
        inView:
          !!viewBox &&
          box.width > 0 &&
          box.height > 0 &&
          box.x + box.width > 0 &&
          box.y + box.height > 0 &&
          box.x < viewBox.width &&
          box.y < viewBox.height,
      };
    });
  });
  const hasBoundingBox = overlayStats.some((item) => item.inView);

  const valueVisible = await page
    .getByRole("listitem")
    .getByText(fixture.expectedValue, { exact: true })
    .isVisible();
  const formatVisible = await page
    .getByRole("listitem")
    .getByText(fixture.expectedFormat, { exact: true })
    .isVisible();

  if (valueVisible && formatVisible && previewLoaded && hasBoundingBox) {
    console.log(`PASS ${fixture.file}: ${fixture.expectedFormat} = ${fixture.expectedValue}`);
    passed += 1;
  } else {
    console.error(`FAIL ${fixture.file}`);
    console.error(`  expected value: ${fixture.expectedValue}`);
    console.error(`  expected format: ${fixture.expectedFormat}`);
    console.error(`  preview loaded: ${previewLoaded}`);
    console.error(`  bounding box overlay: ${hasBoundingBox}`);
    failed += 1;
  }
}

await browser.close();

console.log(`\nBrowser UI results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
