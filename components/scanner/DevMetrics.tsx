"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

type Metric = { label: string; value: string | number };

export function DevMetrics({
  metrics,
  className,
}: {
  metrics: Metric[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn("w-full", className)}>
      <button
        type="button"
        className="flex w-full items-center justify-between py-2 text-left text-xs font-semibold text-muted"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Dev metrics
        <span className="text-[10px] uppercase tracking-wide">
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {open ? (
        <div className="grid grid-cols-2 gap-2 pb-2">
          {metrics.map((metric) => (
            <div key={metric.label} className="bg-[var(--surface)] p-3">
              <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
                {metric.label}
              </span>
              <strong className="text-lg font-medium">{metric.value}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
