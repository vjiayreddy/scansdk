/** Wall-clock budget so a dense pack photo cannot freeze/crash the tab. */
export const SCAN_BUDGET_MS = 2800;
export const YIELD_EVERY_CROPS = 4;

export function createDeadline(budgetMs = SCAN_BUDGET_MS): number {
  return performance.now() + budgetMs;
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
