"use client";

import type { ScanDetection } from "@/lib/barcode/types";

const DETECT_FILL_READ = "rgba(34, 197, 94, 0.55)";
const DETECT_STROKE_LOCATED = "#ff4d8b";
const DETECT_STROKE_READ = "#22c55e";

/** Same green/pink overlay shapes used on upload ImagePreview (and live). */
export function DetectionOverlayShape({
  barcode,
  index,
}: {
  barcode: ScanDetection;
  index: number;
}) {
  const box = barcode.boundingBox;
  const hasBox = box.width > 1 && box.height > 1;
  const locateOnly = barcode.status === "located";
  const unread = barcode.status === "unread";
  const fill = locateOnly || unread ? "none" : DETECT_FILL_READ;
  const stroke = locateOnly
    ? DETECT_STROKE_LOCATED
    : unread
      ? "rgba(239, 68, 68, 0.55)"
      : DETECT_STROKE_READ;
  // Locate-only: thin quiet stroke; read keeps stronger chrome.
  // Unread (upload): soft outline only — no heavy red fill / X (live hides unread).
  const strokeWidth = locateOnly
    ? Math.max(1.5, Math.min(box.width, box.height) * 0.018)
    : unread
      ? Math.max(1.5, Math.min(box.width, box.height) * 0.022)
      : Math.max(2, Math.min(box.width, box.height) * 0.035);
  const glyphSize = Math.max(
    16,
    Math.min(box.width, box.height) * (locateOnly || unread ? 0 : 0.42),
  );
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const glyphStroke = Math.max(2.5, glyphSize * 0.12);

  return (
    <g key={`${barcode.status}-${barcode.rawValue || index}-${index}`}>
      {hasBox ? (
        <rect
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={locateOnly || unread ? 0.85 : 1}
        />
      ) : (
        <polygon
          points={barcode.cornerPoints
            .map((point) => `${point.x},${point.y}`)
            .join(" ")}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={locateOnly || unread ? 0.85 : 1}
        />
      )}
      {hasBox && !locateOnly && !unread ? (
        <polyline
          aria-hidden
          points={`${cx - glyphSize * 0.35},${cy} ${cx - glyphSize * 0.08},${cy + glyphSize * 0.32} ${cx + glyphSize * 0.4},${cy - glyphSize * 0.32}`}
          fill="none"
          stroke="#ffffff"
          strokeWidth={glyphStroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {hasBox && !locateOnly && !unread ? (
        <text
          x={box.x + strokeWidth}
          y={box.y + strokeWidth * 4}
          fill={stroke}
          fontSize={Math.max(12, strokeWidth * 3.5)}
          fontWeight={600}
          fontFamily="Inter, system-ui, sans-serif"
        >
          {index + 1}
          {barcode.score !== undefined
            ? ` ${Math.round(barcode.score * 100)}%`
            : ""}
        </text>
      ) : null}
    </g>
  );
}
