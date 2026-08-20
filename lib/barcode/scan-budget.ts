import type { ScanMode } from "./types";

/** Wall-clock budget so a dense pack photo cannot freeze/crash the tab. */
export const SCAN_BUDGET_MS = 2800;
/** Extended budget when the user opts into blur/perspective hard passes. */
export const HARD_SCAN_BUDGET_MS = 8800;
/** Auto-extended budget for large sparse scenes (bottle trays) in normal mode. */
export const SPARSE_SCAN_BUDGET_MS = 4800;
export const YIELD_EVERY_CROPS = 4;

export function budgetForMode(mode: ScanMode = "normal"): number {
  return mode === "hard" ? HARD_SCAN_BUDGET_MS : SCAN_BUDGET_MS;
}

export function createDeadline(budgetMs = SCAN_BUDGET_MS): number {
  return performance.now() + budgetMs;
}

export function createDeadlineForMode(mode: ScanMode = "normal"): number {
  return createDeadline(budgetForMode(mode));
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
