"use client";

import { useCallback, useState } from "react";

import { BarcodeResults } from "@/components/BarcodeResults";
import { ImagePreview } from "@/components/ImagePreview";
import { ImageUploader } from "@/components/ImageUploader";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";

function StatusBanner({
  status,
  error,
}: {
  status: string;
  error: string | null;
}) {
  if (status === "loading-wasm") {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
        Initializing scanner…
      </div>
    );
  }

  if (status === "scanning") {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
        Scanning image for barcodes… Photos with many small Data Matrix codes may
        take a little longer.
      </div>
    );
  }

  if (status === "scanning-hard") {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
        Running enhanced scan for blurry, tilted, or curved codes… This can take
        up to 10 seconds.
      </div>
    );
  }

  if (status === "error" && error) {
    return (
      <div
        className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        role="alert"
      >
        {error}
      </div>
    );
  }

  return null;
}

export function ScanPage() {
  const { status, results, error, scan, scanHarder, reset, isReady } =
    useBarcodeScanner();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const isBusy =
    status === "loading-wasm" ||
    status === "scanning" ||
    status === "scanning-hard";

  const handleFileSelect = useCallback(
    async (file: File) => {
      setSelectedFile(file);
      await scan(file);
    },
    [scan],
  );

  const handleReset = useCallback(() => {
    setSelectedFile(null);
    reset();
  }, [reset]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Barcode Scanner
        </h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Upload an image to detect QR codes, Data Matrix, EAN, UPC, Code128,
          PDF417, and other barcode formats directly in your browser. Green
          boxes were decoded; red boxes were located but not read.
        </p>
      </header>

      <StatusBanner status={status} error={error} />

      {!selectedFile ? (
        <ImageUploader onFileSelect={handleFileSelect} disabled={isBusy} />
      ) : (
        <div className="space-y-6">
          <ImagePreview
            key={`${selectedFile.name}-${selectedFile.size}-${selectedFile.lastModified}`}
            file={selectedFile}
            barcodes={results?.barcodes ?? []}
            imageSize={results?.imageSize}
          />

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => scanHarder(selectedFile)}
              disabled={isBusy || !isReady}
              className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Scan Harder
            </button>
            <button
              type="button"
              onClick={() => scan(selectedFile)}
              disabled={isBusy || !isReady}
              className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              Scan Again
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={isBusy}
              className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              Upload New Image
            </button>
          </div>

          {status === "done" && results ? (
            <BarcodeResults
              barcodes={results.barcodes}
              durationMs={results.durationMs}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
