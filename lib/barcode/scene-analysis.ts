import type { DetectedBarcode } from "./types";

export interface SceneProfile {
  /** Large image with few hits — curved trays, sparse packs. */
  sparse: boolean;
  /** Run blur/perspective/cylinder passes on every crop. */
  aggressive: boolean;
  maxProposals: number;
}

/** Tune proposal budget from image size vs hits found so far. */
export function analyzeScene(
  canvasWidth: number,
  canvasHeight: number,
  knownHits: DetectedBarcode[],
  hardMode = false,
): SceneProfile {
  const pixels = canvasWidth * canvasHeight;
  const hitCount = knownHits.length;
  const sparse =
    pixels > 350_000 && hitCount < 8 && hitCount < pixels / 120_000;

  return {
    sparse,
    aggressive: hardMode || sparse || hitCount < 4,
    maxProposals: hardMode ? 140 : sparse ? 120 : 40,
  };
}
