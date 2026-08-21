"use client";

import type { ScanDetection } from "@/lib/barcode/types";

const DETECT_FILL_READ = "rgba(34, 197, 94, 0.55)";
const DETECT_FILL_UNREAD = "rgba(239, 68, 68, 0.45)";
const DETECT_STROKE_LOCATED = "#ff4d8b";
const DETECT_STROKE_READ = "#22c55e";
const DETECT_STROKE_UNREAD = "#ef4444";

/** Same green/red/pink overlay shapes used on upload ImagePreview. */
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
  const fill = locateOnly
    ? "none"
    : unread
      ? DETECT_FILL_UNREAD
      : DETECT_FILL_READ;
  const stroke = locateOnly
    ? DETECT_STROKE_LOCATED
    : unread
      ? DETECT_STROKE_UNREAD
      : DETECT_STROKE_READ;
  const strokeWidth = Math.max(2, Math.min(box.width, box.height) * 0.035);
  const glyphSize = Math.max(
    16,
    Math.min(box.width, box.height) * (locateOnly ? 0 : 0.42),
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
        />
      ) : (
        <polygon
          points={barcode.cornerPoints
            .map((point) => `${point.x},${point.y}`)
            .join(" ")}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      )}
      {hasBox && !locateOnly ? (
        unread ? (
          <g
            aria-hidden
            stroke="#ffffff"
            strokeWidth={glyphStroke}
            strokeLinecap="round"
            fill="none"
          >
            <line
              x1={cx - glyphSize / 2}
              y1={cy - glyphSize / 2}
              x2={cx + glyphSize / 2}
              y2={cy + glyphSize / 2}
            />
            <line
              x1={cx + glyphSize / 2}
              y1={cy - glyphSize / 2}
              x2={cx - glyphSize / 2}
              y2={cy + glyphSize / 2}
            />
          </g>
        ) : (
          <polyline
            aria-hidden
            points={`${cx - glyphSize * 0.35},${cy} ${cx - glyphSize * 0.08},${cy + glyphSize * 0.32} ${cx + glyphSize * 0.4},${cy - glyphSize * 0.32}`}
            fill="none"
            stroke="#ffffff"
            strokeWidth={glyphStroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      ) : null}
      {hasBox ? (
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
