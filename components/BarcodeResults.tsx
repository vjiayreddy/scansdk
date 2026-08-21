"use client";

import { useCallback, useState } from "react";

import type { ScanDetection } from "@/lib/barcode/types";

interface BarcodeResultsProps {
  barcodes: ScanDetection[];
  durationMs?: number;
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
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function BarcodeResults({ barcodes, durationMs }: BarcodeResultsProps) {
  const read = barcodes.filter((barcode) => barcode.status !== "unread");
  const unread = barcodes.filter((barcode) => barcode.status === "unread");

  if (barcodes.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-6 py-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-base font-medium text-zinc-900 dark:text-zinc-100">
          No barcodes found in this image
        </p>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          For small Data Matrix codes in wide photos, try a close-up shot of one
          or two labels, better lighting, and the original high-resolution image
          (not a screenshot).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Detected Barcodes ({read.length}
          {unread.length > 0 ? `, ${unread.length} unread` : ""})
        </h2>
        {durationMs !== undefined ? (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            Scanned in {durationMs}ms
          </span>
        ) : null}
      </div>

      <ul className="space-y-3">
        {read.map((barcode, index) => (
          <li
            key={`${barcode.format}-${barcode.rawValue}-${index}`}
            className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                {formatLabel(barcode.format)}
              </span>
              <CopyButton value={barcode.rawValue} />
            </div>
            <p className="break-all font-mono text-sm text-zinc-900 dark:text-zinc-100">
              {barcode.rawValue}
            </p>
          </li>
        ))}
        {unread.map((barcode, index) => (
          <li
            key={`unread-${index}`}
            className="rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-800 dark:bg-red-900 dark:text-red-100">
                Located
              </span>
            </div>
            <p className="text-sm text-red-800 dark:text-red-200">
              Barcode found but not decoded
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
