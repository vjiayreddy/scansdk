"use client";

import { Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_FILE_SIZE_BYTES,
} from "@/lib/barcode/types";
import { cn } from "@/lib/utils";

interface ImageUploaderProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Standalone dropzone — ScanPage uses an inline stage empty-state instead. */
export function ImageUploader({ onFileSelect, disabled }: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const validateAndSelect = useCallback(
    (file: File | undefined) => {
      if (!file) {
        return;
      }

      if (
        !ACCEPTED_IMAGE_TYPES.includes(
          file.type as (typeof ACCEPTED_IMAGE_TYPES)[number],
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
      onFileSelect(file);
    },
    [onFileSelect],
  );

  const handleDrag = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "dragenter" || event.type === "dragover") {
      setDragActive(true);
    } else if (event.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDragActive(false);
      if (disabled) {
        return;
      }
      validateAndSelect(event.dataTransfer.files[0]);
    },
    [disabled, validateAndSelect],
  );

  return (
    <div className="w-full">
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={cn(
          "flex w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 transition-colors",
          dragActive
            ? "border-ink bg-surface-soft"
            : "border-hairline bg-canvas hover:border-muted hover:bg-surface-soft",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-brand-lavender/80 text-ink">
          <Upload className="size-5" />
        </div>
        <p className="text-base font-semibold text-ink">
          Drop an image here or click to upload
        </p>
        <p className="mt-1 text-sm text-muted">
          JPEG, PNG, WebP, GIF, BMP up to {formatFileSize(MAX_FILE_SIZE_BYTES)}
        </p>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          validateAndSelect(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      {validationError ? (
        <p className="mt-3 text-sm text-error" role="alert">
          {validationError}
        </p>
      ) : null}

      <div className="mt-3 flex justify-center sm:hidden">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          Choose image
        </Button>
      </div>
    </div>
  );
}
