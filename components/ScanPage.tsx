"use client";

import {
  Camera,
  ImagePlus,
  Images,
  List,
  ScanSearch,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ImagePreview,
  type ImagePreviewHandle,
} from "@/components/ImagePreview";
import { ResultsBottomSheet } from "@/components/ResultsBottomSheet";
import { Button } from "@/components/ui/button";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_FILE_SIZE_BYTES,
} from "@/lib/barcode/types";

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function guessImageMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    default:
      // Mobile camera captures are almost always JPEG when type is blank.
      return "image/jpeg";
  }
}

export function ScanPage() {
  const { status, results, error, scan, scanHarder, reset } =
    useBarcodeScanner();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<ImagePreviewHandle>(null);
  const autoOpenedForRef = useRef<string | null>(null);

  const isBusy =
    status === "locating" ||
    status === "scanning" ||
    status === "scanning-hard" ||
    status === "loading-wasm";
  const bannerError = validationError ?? (status === "error" ? error : null);
  const totalCount = results?.barcodes.length ?? 0;
  const readCount =
    results?.barcodes.filter((barcode) => barcode.status === "read").length ??
    0;
  const unreadCount =
    results?.barcodes.filter((barcode) => barcode.status === "unread")
      .length ?? 0;
  const fileKey = selectedFile
    ? `${selectedFile.name}-${selectedFile.size}-${selectedFile.lastModified}`
    : null;
  const canScanHarder =
    Boolean(selectedFile) && status === "done" && unreadCount > 0;

  const statusBanner =
    !bannerError && selectedFile
      ? status === "locating" || status === "loading-wasm"
        ? "Locating barcodes…"
        : status === "scanning-hard"
          ? "Reading harder…"
          : status === "scanning"
            ? "Reading barcodes…"
            : null
      : null;

  const acceptFile = useCallback(
    async (file: File | undefined) => {
      if (!file) {
        return;
      }

      const mime = file.type || guessImageMime(file.name);
      if (
        !ACCEPTED_IMAGE_TYPES.includes(
          mime as (typeof ACCEPTED_IMAGE_TYPES)[number],
        )
      ) {
        setValidationError(
          "Please upload a JPEG, PNG, WebP, GIF, or BMP image.",
        );
        return;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        setValidationError(
          `File is too large (${formatFileSize(file.size)}). Max size is ${formatFileSize(MAX_FILE_SIZE_BYTES)}.`,
        );
        return;
      }

      setValidationError(null);
      setSheetOpen(false);
      setZoom(1);
      autoOpenedForRef.current = null;
      // Normalize empty MIME from some camera apps so downstream decode is happy.
      const normalized =
        file.type === mime
          ? file
          : new File([file], file.name || `capture.${mime.split("/")[1] ?? "jpg"}`, {
              type: mime,
              lastModified: file.lastModified,
            });
      setSelectedFile(normalized);
      await scan(normalized);
    },
    [scan],
  );

  const handleScanHarder = useCallback(async () => {
    if (!selectedFile) {
      return;
    }
    setSheetOpen(false);
    autoOpenedForRef.current = null;
    await scanHarder(selectedFile);
  }, [scanHarder, selectedFile]);

  const handleReset = useCallback(() => {
    setSelectedFile(null);
    setValidationError(null);
    setSheetOpen(false);
    setZoom(1);
    autoOpenedForRef.current = null;
    reset();
  }, [reset]);

  // Open results sheet once when a scan finishes for the current file.
  useEffect(() => {
    if (status !== "done" || !results || !fileKey) {
      return;
    }
    if (autoOpenedForRef.current === fileKey) {
      return;
    }
    autoOpenedForRef.current = fileKey;
    setSheetOpen(true);
  }, [status, results, fileKey]);

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface-soft dark:bg-[var(--surface)]">
      <div
        className={
          selectedFile
            ? "cl-stage relative min-h-0 w-full flex-1 overflow-hidden bg-surface-dark"
            : "relative min-h-0 w-full flex-1 overflow-hidden bg-surface-soft dark:bg-[var(--surface)]"
        }
      >
        {!selectedFile ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 px-6 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-brand-lavender/80 text-ink">
              <Images className="size-6" />
            </span>
            <div className="flex flex-col gap-2">
              <span className="text-lg font-semibold tracking-tight text-ink dark:text-[var(--foreground)]">
                Upload an image
              </span>
              <span className="mx-auto max-w-sm text-sm leading-relaxed text-muted">
                Pick from your gallery or take a photo. Results open in a sheet
                when done.
              </span>
              <span className="text-xs text-muted">
                JPEG, PNG, WebP up to {formatFileSize(MAX_FILE_SIZE_BYTES)}
              </span>
            </div>
            <div className="flex w-full max-w-sm flex-col gap-2 sm:flex-row sm:justify-center">
              <Button
                type="button"
                className="h-12 w-full rounded-full px-6 sm:w-auto"
                disabled={isBusy}
                onClick={() => galleryInputRef.current?.click()}
              >
                <Images className="size-5" />
                Gallery
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-12 w-full rounded-full px-6 sm:w-auto"
                disabled={isBusy}
                onClick={() => cameraInputRef.current?.click()}
              >
                <Camera className="size-5" />
                Camera
              </Button>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0">
            <ImagePreview
              key={fileKey ?? "preview"}
              ref={previewRef}
              file={selectedFile}
              barcodes={results?.barcodes ?? []}
              imageSize={results?.imageSize}
              variant="stage"
              objectFit="contain"
              onZoomChange={setZoom}
            />
          </div>
        )}

        {bannerError ? (
          <div
            className="absolute left-3 right-3 top-3 z-20 rounded-md bg-canvas px-3 py-2.5 text-sm text-error ring-1 ring-hairline dark:bg-[var(--background)]"
            role="alert"
          >
            {bannerError}
          </div>
        ) : null}

        {statusBanner ? (
          <div
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-6"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-2.5 rounded-full bg-black/80 px-5 py-3 text-sm font-semibold tracking-tight text-white shadow-lg backdrop-blur-sm">
              <span
                className="size-4 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white"
                aria-hidden
              />
              {statusBanner}
            </div>
          </div>
        ) : null}

        {selectedFile ? (
          <div className="pointer-events-auto absolute right-3 top-3 z-20 flex items-center gap-1 rounded-full border border-hairline bg-canvas/95 p-1 shadow-md backdrop-blur-sm dark:border-[var(--border)] dark:bg-[var(--background)]/95">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-10 rounded-full"
              disabled={zoom <= 1}
              aria-label="Zoom out"
              onClick={() => previewRef.current?.zoomOut()}
            >
              <ZoomOut className="size-5" />
            </Button>
            <span className="min-w-10 text-center text-xs font-semibold tabular-nums text-ink dark:text-[var(--foreground)]">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-10 rounded-full"
              disabled={zoom >= 5}
              aria-label="Zoom in"
              onClick={() => previewRef.current?.zoomIn()}
            >
              <ZoomIn className="size-5" />
            </Button>
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex items-end justify-between gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-16">
          <div className="pointer-events-auto flex items-center gap-2">
            {selectedFile && status === "done" && totalCount > 0 ? (
              <Button
                type="button"
                size="icon"
                variant="onColor"
                className="relative size-12 rounded-full shadow-md ring-1 ring-hairline"
                aria-label={`Show ${totalCount} results`}
                onClick={() => setSheetOpen(true)}
              >
                <List className="size-5" />
                <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-pink px-1 text-[10px] font-semibold text-white">
                  {totalCount}
                </span>
              </Button>
            ) : null}
            {canScanHarder ? (
              <Button
                type="button"
                variant="onColor"
                className="h-12 rounded-full px-4 shadow-md ring-1 ring-hairline"
                aria-label={`Scan harder — ${unreadCount} unread`}
                onClick={() => void handleScanHarder()}
              >
                <ScanSearch className="size-5" />
                Scan harder
              </Button>
            ) : null}
          </div>

          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-hairline bg-canvas/95 p-1 shadow-md backdrop-blur-sm dark:border-[var(--border)] dark:bg-[var(--background)]/95">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-11 rounded-full"
              disabled={isBusy}
              aria-label={
                selectedFile ? "Choose another from gallery" : "Choose from gallery"
              }
              onClick={() => galleryInputRef.current?.click()}
            >
              <ImagePlus className="size-5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-11 rounded-full"
              disabled={isBusy}
              aria-label={selectedFile ? "Take another photo" : "Take a photo"}
              onClick={() => cameraInputRef.current?.click()}
            >
              <Camera className="size-5" />
            </Button>
            {selectedFile ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-11 rounded-full text-error hover:bg-error/10"
                disabled={isBusy}
                aria-label="Clear image"
                onClick={handleReset}
              >
                <Trash2 className="size-5" />
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <input
        ref={galleryInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        className="sr-only"
        disabled={isBusy}
        onChange={(event) => {
          void acceptFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        disabled={isBusy}
        onChange={(event) => {
          void acceptFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      <ResultsBottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        barcodes={results?.barcodes ?? []}
        durationMs={results?.durationMs}
        file={selectedFile}
        imageSize={results?.imageSize}
        title="Detected barcodes"
        subtitle={
          status === "done" && results
            ? `${readCount} read · ${unreadCount} unread · ${results.durationMs} ms`
            : undefined
        }
      />
    </div>
  );
}
