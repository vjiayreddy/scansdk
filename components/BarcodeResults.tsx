"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { ImageSize, ScanDetection } from "@/lib/barcode/types";
import { cn } from "@/lib/utils";

interface BarcodeResultsProps {
  barcodes: ScanDetection[];
  durationMs?: number;
  /** Source image for crop thumbnails. */
  file?: File | null;
  /** Live camera / canvas source for crop thumbnails (when no file). */
  media?: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement | null;
  imageSize?: ImageSize;
  /** Tighter list for the scanner aside panel. */
  compact?: boolean;
}

const CROP_PAD = 0.1;
const THUMB_MAX = 96;

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

function cropBarcodeThumb(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  box: ScanDetection["boundingBox"],
): string | null {
  const sourceWidth =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : source instanceof HTMLImageElement
        ? source.naturalWidth
        : source.width;
  const sourceHeight =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : source instanceof HTMLImageElement
        ? source.naturalHeight
        : source.height;

  const padX = box.width * CROP_PAD;
  const padY = box.height * CROP_PAD;
  const sx = Math.max(0, Math.floor(box.x - padX));
  const sy = Math.max(0, Math.floor(box.y - padY));
  const sw = Math.min(sourceWidth - sx, Math.ceil(box.width + padX * 2));
  const sh = Math.min(sourceHeight - sy, Math.ceil(box.height + padY * 2));

  if (sw <= 0 || sh <= 0 || sourceWidth < 2 || sourceHeight < 2) {
    return null;
  }

  const scale = Math.min(1, THUMB_MAX / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, dw, dh);
  try {
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  }
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for crop thumbnails"));
    };
    image.src = url;
  });
}

export function BarcodeResults({
  barcodes,
  durationMs,
  file = null,
  media = null,
  compact = false,
}: BarcodeResultsProps) {
  const ordered = useMemo(() => {
    const read = barcodes.filter((barcode) => barcode.status === "read");
    const unread = barcodes.filter((barcode) => barcode.status === "unread");
    const located = barcodes.filter((barcode) => barcode.status === "located");
    return [...read, ...unread, ...located];
  }, [barcodes]);

  const thumbKey = useMemo(() => {
    const boxes = ordered
      .map(
        (barcode) =>
          `${Math.round(barcode.boundingBox.x)},${Math.round(barcode.boundingBox.y)},${Math.round(barcode.boundingBox.width)},${Math.round(barcode.boundingBox.height)},${barcode.status},${barcode.rawValue}`,
      )
      .join("|");
    if (file) {
      return `file:${file.name}:${file.size}:${file.lastModified}:${boxes}`;
    }
    if (media) {
      return `media:${boxes}`;
    }
    return "";
  }, [file, media, ordered]);

  const [thumbState, setThumbState] = useState<{
    key: string;
    thumbs: (string | null)[];
  }>({ key: "", thumbs: [] });

  const readCount = barcodes.filter((b) => b.status === "read").length;
  const unreadCount = barcodes.filter((b) => b.status === "unread").length;

  useEffect(() => {
    if (ordered.length === 0 || !thumbKey) {
      return;
    }

    let cancelled = false;

    const applyThumbs = (
      source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
    ) => {
      if (cancelled) {
        return;
      }
      setThumbState({
        key: thumbKey,
        thumbs: ordered.map((barcode) =>
          cropBarcodeThumb(source, barcode.boundingBox),
        ),
      });
    };

    if (file) {
      void loadImageFromFile(file)
        .then(applyThumbs)
        .catch(() => {
          if (!cancelled) {
            setThumbState({
              key: thumbKey,
              thumbs: ordered.map(() => null),
            });
          }
        });
    } else if (media) {
      applyThumbs(media);
    }

    return () => {
      cancelled = true;
    };
  }, [file, media, ordered, thumbKey]);

  const thumbs =
    thumbState.key === thumbKey ? thumbState.thumbs : ordered.map(() => null);

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

  return (
    <div className="space-y-3">
      {!compact ? (
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink dark:text-[var(--foreground)]">
            {readCount + unreadCount > 0
              ? `Detected (${readCount}${unreadCount > 0 ? `, ${unreadCount} unread` : ""})`
              : `Located (${barcodes.length})`}
          </h2>
          {durationMs !== undefined ? (
            <span className="text-sm text-muted">{durationMs} ms</span>
          ) : null}
        </div>
      ) : null}

      <ul className="divide-y divide-hairline dark:divide-[var(--border-soft)]">
        {ordered.map((barcode, index) => {
          const thumb = thumbs[index] ?? null;
          const isUnread = barcode.status === "unread";
          const isLocated = barcode.status === "located";
          const isRead = barcode.status === "read";

          return (
            <li
              key={`${barcode.status}-${barcode.rawValue}-${index}`}
              className="flex items-start gap-3 py-3"
            >
              <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-soft dark:bg-[var(--surface)]">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumb}
                    alt=""
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-[10px] font-semibold text-muted">
                    #{index + 1}
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  {isRead ? (
                    <span className="inline-flex rounded-sm border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
                      Read
                    </span>
                  ) : null}
                  {isUnread ? (
                    <span className="inline-flex rounded-sm border border-error/30 bg-error/10 px-2.5 py-0.5 text-xs font-semibold text-error">
                      Unread
                    </span>
                  ) : null}
                  {isLocated ? (
                    <span className="inline-flex rounded-sm bg-brand-pink px-2 py-0.5 text-xs font-semibold text-white">
                      Located
                    </span>
                  ) : null}
                  {isRead ? (
                    <span className="inline-flex rounded-sm border border-hairline px-2.5 py-0.5 text-xs font-semibold text-ink dark:border-[var(--border)] dark:text-[var(--foreground)]">
                      {formatLabel(barcode.format)}
                    </span>
                  ) : null}
                  {barcode.score !== undefined ? (
                    <span className="text-xs text-muted">
                      {Math.round(barcode.score * 100)}%
                    </span>
                  ) : null}
                </div>

                {isRead ? (
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 break-all font-mono text-sm font-medium text-ink dark:text-[var(--foreground)]">
                      {barcode.rawValue}
                    </p>
                    <CopyButton value={barcode.rawValue} />
                  </div>
                ) : (
                  <p className="text-sm text-muted">
                    {isUnread
                      ? "Located but decode failed — hold steady or move closer"
                      : "Located — reading…"}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
