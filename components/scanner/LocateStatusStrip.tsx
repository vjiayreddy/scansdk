"use client";

import { cn } from "@/lib/utils";

type LocateStatusStripProps = {
  statusLabel: string;
  boxCount: number;
  fps: number;
  inferenceMs: number;
  visible?: boolean;
  className?: string;
};

export function LocateStatusStrip({
  statusLabel,
  boxCount,
  fps,
  inferenceMs,
  visible = true,
  className,
}: LocateStatusStripProps) {
  if (!visible) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-white/15 bg-canvas/95 p-3 text-ink shadow-none backdrop-blur-sm",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-brand-pink px-1.5 text-[11px] font-semibold text-white">
            {boxCount}
          </span>
          <p className="truncate text-sm font-semibold leading-snug">
            {statusLabel}
          </p>
        </div>
        <p className="mt-1 text-[11px] font-medium text-muted">
          {fps} FPS · {inferenceMs} ms inference
        </p>
      </div>
    </div>
  );
}
