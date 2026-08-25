import type { YoloBox } from "./yolo-core";
import { boxIou, nms, YOLO_IOU } from "./yolo-core";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pharma shipping labels: DataMatrix on the right, 1–2 horizontal CODE128
 * (often GS1-128) stacked on the left. When YOLO finds DM but misses 1D,
 * invent tight sibling strips beside each DM for decode.
 */
export function proposeCode128BesideDatamatrix(
  boxes: YoloBox[],
  canvasWidth: number,
  canvasHeight: number,
  maxProposals = 8,
): YoloBox[] {
  const datamatrix = boxes.filter(
    (box) => box.classId === 0 || box.classId === undefined,
  );
  if (datamatrix.length === 0 || canvasWidth < 32 || canvasHeight < 32) {
    return [];
  }

  const existingCode128 = boxes.filter((box) => box.classId === 1);
  const proposals: YoloBox[] = [];

  for (const dm of datamatrix) {
    if (proposals.length >= maxProposals) {
      break;
    }

    const side = Math.max(dm.width, dm.height);
    if (side < 12) {
      continue;
    }

    // Prefer left of DM (common label layout); also try right if near left edge.
    const barWidth = clamp(Math.round(side * 3.2), 48, Math.round(canvasWidth * 0.55));
    const barHeight = clamp(Math.round(side * 0.42), 14, Math.round(side * 0.85));
    const gap = Math.max(4, Math.round(side * 0.12));

    const leftX = clamp(dm.x - gap - barWidth, 0, canvasWidth - 1);
    const rightX = clamp(dm.x + dm.width + gap, 0, canvasWidth - 1);
    const useLeft = leftX + barWidth * 0.5 < dm.x;
    const anchorX = useLeft ? leftX : rightX;
    const width = Math.min(barWidth, canvasWidth - anchorX);
    if (width < 40) {
      continue;
    }

    // Two stacked bars covering DM vertical span (+ slight extend).
    const stackTop = clamp(dm.y - barHeight * 0.15, 0, canvasHeight - 1);
    const positions = [
      stackTop,
      stackTop + barHeight + Math.max(6, Math.round(barHeight * 0.25)),
    ];

    for (const y of positions) {
      if (proposals.length >= maxProposals) {
        break;
      }
      const height = Math.min(barHeight, canvasHeight - Math.round(y));
      if (height < 12) {
        continue;
      }

      const proposal: YoloBox = {
        x: anchorX,
        y: Math.round(y),
        width,
        height,
        score: Math.min(0.35, (dm.score ?? 0.2) * 0.55),
        classId: 1,
      };

      const overlapsExisting = [...existingCode128, ...proposals].some(
        (box) => boxIou(box, proposal) > 0.35,
      );
      if (overlapsExisting) {
        continue;
      }
      proposals.push(proposal);
    }
  }

  return proposals;
}

/** Merge YOLO boxes with pharma CODE128 siblings; NMS keeps stacked bars. */
export function enrichLocateWithCode128Siblings(
  boxes: YoloBox[],
  canvasWidth: number,
  canvasHeight: number,
): YoloBox[] {
  const siblings = proposeCode128BesideDatamatrix(
    boxes,
    canvasWidth,
    canvasHeight,
  );
  if (siblings.length === 0) {
    return boxes;
  }
  return nms([...boxes, ...siblings], YOLO_IOU);
}
