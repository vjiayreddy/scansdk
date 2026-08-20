import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const baseUrl = process.env.SCAN_URL ?? "http://localhost:3001";

const browser = await chromium.launch();
const page = await browser.newPage();

page.on("console", (msg) => console.log("console:", msg.text()));
page.on("pageerror", (err) => console.log("pageerror:", err.message));

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.locator('input[type="file"]').setInputFiles(
  path.join(root, "test-fixtures", "pharma-bin.png"),
);

await page.waitForTimeout(90000);
console.log(await page.locator("body").innerText());

await browser.close();
