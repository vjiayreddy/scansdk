"use client";

import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import type { ScanDetection } from "@/lib/barcode/types";
import { cn } from "@/lib/utils";

interface BarcodeResultsProps {
  barcodes: ScanDetection[];
  durationMs?: number;
  /** Tighter list for the scanner aside panel. */
  compact?: boolean;
}

function formatLabel(format: string): string {
  return format.replaceAll("_", " ").toUpperCase();
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [value]);

  return (
    <Button type="button" variant="secondary" size="sm" onClick={handleCopy}>
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function BarcodeResults({
  barcodes,
  durationMs,
  compact = false,
}: BarcodeResultsProps) {
  const located = barcodes.filter((barcode) => barcode.status === "located");
  const read = barcodes.filter((barcode) => barcode.status === "read");
  const unread = barcodes.filter((barcode) => barcode.status === "unread");

  if (barcodes.length === 0) {
    return (
      <div
        className={cn(
          "text-sm text-muted",
          !compact &&
            "rounded-xl border border-hairline bg-surface-soft px-5 py-8 text-center dark:border-[var(--border)] dark:bg-[var(--surface)]",
        )}
      >
        <p
          className={cn(
            "font-medium text-ink dark:text-[var(--foreground)]",
            compact ? "text-sm" : "text-base",
          )}
        >
          No barcodes found in this image
        </p>
        <p className="mt-2 text-sm text-muted">
          Try a closer shot, better lighting, or Scan harder for blurry codes.
        </p>
      </div>
    );
  }

  if (located.length === barcodes.length) {
    return (
      <div className="space-y-3">
        {!compact ? (
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink dark:text-[var(--foreground)]">
              YOLO located {located.length}
            </h2>
            {durationMs !== undefined ? (
              <span className="text-sm text-muted">{durationMs} ms</span>
            ) : null}
          </div>
        ) : null}
        <ul className="divide-y divide-hairline dark:divide-[var(--border-soft)]">
          {located.map((barcode, index) => (
            <li
              key={`located-${index}`}
              className="flex items-center justify-between gap-3 py-3 text-sm"
            >
              <span className="inline-flex items-center gap-2 font-semibold text-ink dark:text-[var(--foreground)]">
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-brand-pink px-1.5 text-[11px] text-white">
                  {index + 1}
                </span>
                Located
              </span>
              <span className="text-muted">
                {barcode.score !== undefined
                  ? `${Math.round(barcode.score * 100)}%`
                  : "—"}
                {` · ${Math.round(barcode.boundingBox.width)}×${Math.round(barcode.boundingBox.height)}`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!compact ? (
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink dark:text-[var(--foreground)]">
            Detected ({read.length}
            {unread.length > 0 ? `, ${unread.length} unread` : ""})
          </h2>
          {durationMs !== undefined ? (
            <span className="text-sm text-muted">{durationMs} ms</span>
          ) : null}
        </div>
      ) : null}

      <ul className="divide-y divide-hairline dark:divide-[var(--border-soft)]">
        {read.map((barcode, index) => (
          <li key={`${barcode.format}-${barcode.rawValue}-${index}`} className="py-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="inline-flex rounded-sm border border-hairline px-2.5 py-0.5 text-xs font-semibold text-ink dark:border-[var(--border)] dark:text-[var(--foreground)]">
                {formatLabel(barcode.format)}
              </span>
              <CopyButton value={barcode.rawValue} />
            </div>
            <p className="break-all font-mono text-sm font-medium text-ink dark:text-[var(--foreground)]">
              {barcode.rawValue}
            </p>
          </li>
        ))}
        {unread.map((barcode, index) => (
          <li key={`unread-${index}`} className="py-3">
            <span className="mb-1 inline-flex rounded-sm border border-error/30 bg-error/10 px-2.5 py-0.5 text-xs font-semibold text-error">
              Located · unread
            </span>
            <p className="mt-1 text-sm text-muted">
              Found but not decoded
              {barcode.score !== undefined
                ? ` (${Math.round(barcode.score * 100)}% locate)`
                : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
