import type { ScanMode } from "./types";

/** Wall-clock budget so a dense pack photo cannot freeze/crash the tab. */
export const SCAN_BUDGET_MS = 2800;
/** Extended budget when the user opts into blur/perspective hard passes. */
export const HARD_SCAN_BUDGET_MS = 8800;
/** Auto-extended budget for large sparse scenes (bottle trays) in normal mode. */
export const SPARSE_SCAN_BUDGET_MS = 4800;
export const YIELD_EVERY_CROPS = 4;

/** Per YOLO box decode allowance (fast path + occasional deep). */
export const YOLO_MS_PER_BOX_NORMAL = 380;
export const YOLO_MS_PER_BOX_HARD = 550;
/** Caps so a 100+ pack cannot hang the tab forever. */
export const YOLO_BUDGET_CAP_NORMAL_MS = 60_000;
export const YOLO_BUDGET_CAP_HARD_MS = 120_000;

export function budgetForMode(mode: ScanMode = "normal"): number {
  return mode === "hard" ? HARD_SCAN_BUDGET_MS : SCAN_BUDGET_MS;
}

/** Scale decode time with YOLO box count so dense packs get a fair attempt. */
export function budgetForYoloDecode(
  mode: ScanMode = "normal",
  boxCount: number,
): number {
  const base = budgetForMode(mode);
  const perBox =
    mode === "hard" ? YOLO_MS_PER_BOX_HARD : YOLO_MS_PER_BOX_NORMAL;
  const cap =
    mode === "hard" ? YOLO_BUDGET_CAP_HARD_MS : YOLO_BUDGET_CAP_NORMAL_MS;
  const scaled = Math.max(0, boxCount) * perBox;
  return Math.min(cap, Math.max(base, scaled));
}

export function createDeadline(budgetMs = SCAN_BUDGET_MS): number {
  return performance.now() + budgetMs;
}

export function createDeadlineForMode(mode: ScanMode = "normal"): number {
  return createDeadline(budgetForMode(mode));
}

export function createDeadlineForYoloDecode(
  mode: ScanMode = "normal",
  boxCount: number,
): number {
  return createDeadline(budgetForYoloDecode(mode, boxCount));
}

export function isExpired(deadline: number): boolean {
  return performance.now() >= deadline;
}

export function remainingMs(deadline: number): number {
  return deadline - performance.now();
}

/** Let the browser paint so the page stays responsive during WASM decode. */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
