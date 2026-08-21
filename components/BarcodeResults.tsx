"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

const CROP_PAD = 0.12;
const THUMB_MAX = 96;
/** Reject / tighten crops that cover this much of the frame (looks like live camera). */
const MAX_CROP_FRAME_RATIO = 0.45;

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

function sourceSize(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

/** Freeze one video frame so thumbs are stills, not a live mini-preview. */
function snapshotMediaFrame(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
): HTMLCanvasElement | null {
  const { width, height } = sourceSize(source);
  if (width < 2 || height < 2) {
    return null;
  }
  if (source instanceof HTMLCanvasElement) {
    return source;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  try {
    ctx.drawImage(source, 0, 0, width, height);
  } catch {
    return null;
  }
  return canvas;
}

function cropBarcodeThumb(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  box: ScanDetection["boundingBox"],
): string | null {
  const { width: sourceWidth, height: sourceHeight } = sourceSize(source);

  if (sourceWidth < 2 || sourceHeight < 2) {
    return null;
  }

  let width = Math.max(1, box.width);
  let height = Math.max(1, box.height);
  let x = box.x;
  let y = box.y;

  // Oversized boxes (loose YOLO) look like a live camera tile — tighten to center.
  const frameArea = sourceWidth * sourceHeight;
  if ((width * height) / frameArea > MAX_CROP_FRAME_RATIO) {
    const target = Math.sqrt(frameArea * MAX_CROP_FRAME_RATIO * 0.5);
    const cx = x + width / 2;
    const cy = y + height / 2;
    width = Math.min(width, target);
    height = Math.min(height, target);
    x = cx - width / 2;
    y = cy - height / 2;
  }

  const padX = width * CROP_PAD;
  const padY = height * CROP_PAD;
  const sx = Math.max(0, Math.floor(x - padX));
  const sy = Math.max(0, Math.floor(y - padY));
  const sw = Math.min(sourceWidth - sx, Math.ceil(width + padX * 2));
  const sh = Math.min(sourceHeight - sy, Math.ceil(height + padY * 2));

  if (sw <= 1 || sh <= 1) {
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

/** Stable id so live box jitter does not re-crop every frame. */
function barcodeThumbIdentity(barcode: ScanDetection, index: number): string {
  if (barcode.status === "read" && barcode.rawValue) {
    return `read:${barcode.rawValue}`;
  }
  if (barcode.trackId !== undefined) {
    return `track:${barcode.trackId}`;
  }
  const qx = Math.round(barcode.boundingBox.x / 40);
  const qy = Math.round(barcode.boundingBox.y / 40);
  const qw = Math.round(barcode.boundingBox.width / 40);
  const qh = Math.round(barcode.boundingBox.height / 40);
  return `${barcode.status}:${qx}:${qy}:${qw}:${qh}:${index}`;
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
    const identities = ordered
      .map((barcode, index) => barcodeThumbIdentity(barcode, index))
      .join("|");
    if (file) {
      return `file:${file.name}:${file.size}:${file.lastModified}:${identities}`;
    }
    if (media) {
      return `media:${identities}`;
    }
    return "";
  }, [file, media, ordered]);

  const [thumbState, setThumbState] = useState<{
    key: string;
    thumbs: (string | null)[];
  }>({ key: "", thumbs: [] });

  /** Frozen stills for live media — do not refresh on every video frame. */
  const frozenLiveThumbsRef = useRef(new Map<string, string>());
  const lastMediaRef = useRef<typeof media>(null);

  const readCount = barcodes.filter((b) => b.status === "read").length;
  const unreadCount = barcodes.filter((b) => b.status === "unread").length;

  useEffect(() => {
    if (ordered.length === 0 || !thumbKey) {
      frozenLiveThumbsRef.current.clear();
      return;
    }

    let cancelled = false;

    const applyThumbs = (
      source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
      freezeLive: boolean,
    ) => {
      if (cancelled) {
        return;
      }

      if (freezeLive && lastMediaRef.current !== media) {
        frozenLiveThumbsRef.current.clear();
        lastMediaRef.current = media;
      }

      const frame = freezeLive ? snapshotMediaFrame(source) : source;
      if (!frame) {
        setThumbState({
          key: thumbKey,
          thumbs: ordered.map(() => null),
        });
        return;
      }

      const thumbs = ordered.map((barcode, index) => {
        const id = barcodeThumbIdentity(barcode, index);
        if (freezeLive) {
          const prior = frozenLiveThumbsRef.current.get(id);
          if (prior) {
            return prior;
          }
          // Live list: only freeze a still once the code is read/unread.
          // Located boxes move every frame and looked like a mini live camera.
          if (barcode.status === "located") {
            return null;
          }
        }

        const url = cropBarcodeThumb(frame, barcode.boundingBox);
        if (freezeLive && url) {
          frozenLiveThumbsRef.current.set(id, url);
        }
        return url;
      });

      // Drop stale identities so memory does not grow forever.
      if (freezeLive) {
        const liveIds = new Set(
          ordered.map((barcode, index) => barcodeThumbIdentity(barcode, index)),
        );
        for (const key of frozenLiveThumbsRef.current.keys()) {
          if (!liveIds.has(key) && !key.startsWith("read:")) {
            frozenLiveThumbsRef.current.delete(key);
          }
        }
      }

      setThumbState({ key: thumbKey, thumbs });
    };

    if (file) {
      frozenLiveThumbsRef.current.clear();
      void loadImageFromFile(file)
        .then((image) => applyThumbs(image, false))
        .catch(() => {
          if (!cancelled) {
            setThumbState({
              key: thumbKey,
              thumbs: ordered.map(() => null),
            });
          }
        });
    } else if (media) {
      applyThumbs(media, true);
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
