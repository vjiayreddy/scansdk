"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

import { BarcodeResults } from "@/components/BarcodeResults";
import { Button } from "@/components/ui/button";
import type { ImageSize, ScanDetection } from "@/lib/barcode/types";
import { cn } from "@/lib/utils";

type ResultsBottomSheetProps = {
  open: boolean;
  onClose: () => void;
  barcodes: ScanDetection[];
  durationMs?: number;
  file?: File | null;
  media?: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement | null;
  imageSize?: ImageSize;
  title?: string;
  subtitle?: string;
};

export function ResultsBottomSheet({
  open,
  onClose,
  barcodes,
  durationMs,
  file = null,
  media = null,
  imageSize,
  title = "Detected barcodes",
  subtitle,
}: ResultsBottomSheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      panelRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
        aria-label="Close results"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative z-10 flex max-h-[min(78dvh,36rem)] w-full flex-col rounded-t-2xl bg-canvas shadow-lg outline-none dark:bg-[var(--background)]",
          "sm:max-w-md sm:rounded-2xl",
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-hairline sm:hidden" />
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3 dark:border-[var(--border)]">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-base font-semibold text-ink dark:text-[var(--foreground)]"
            >
              {title}
              {barcodes.length > 0 ? `: ${barcodes.length}` : ""}
            </h2>
            {subtitle ? (
              <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
            ) : durationMs !== undefined ? (
              <p className="mt-0.5 text-xs text-muted">
                Scanned in {durationMs} ms
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <BarcodeResults
            barcodes={barcodes}
            durationMs={durationMs}
            file={file}
            media={media}
            imageSize={imageSize}
            compact
          />
        </div>
      </div>
    </div>
  );
}
