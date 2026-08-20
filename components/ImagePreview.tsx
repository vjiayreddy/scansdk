"use client";

import { useEffect, useMemo, useState } from "react";

import type { DetectedBarcode, ImageSize } from "@/lib/barcode/types";

interface ImagePreviewProps {
  file: File;
  barcodes?: DetectedBarcode[];
  imageSize?: ImageSize;
}

const DETECT_FILL = "rgba(34, 197, 94, 0.78)";

export function ImagePreview({
  file,
  barcodes = [],
  imageSize,
}: ImagePreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [naturalSize, setNaturalSize] = useState<ImageSize>({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    let cancelled = false;

    const reader = new FileReader();

    reader.onload = () => {
      if (cancelled || typeof reader.result !== "string") {
        return;
      }

      setPreviewUrl(reader.result);
      setLoadError(false);
    };

    reader.onerror = () => {
      if (!cancelled) {
        setLoadError(true);
        setPreviewUrl(null);
      }
    };

    reader.readAsDataURL(file);

    return () => {
      cancelled = true;
    };
  }, [file]);

  const viewBoxSize = useMemo(() => {
    if (naturalSize.width && naturalSize.height) {
      return naturalSize;
    }

    if (imageSize?.width && imageSize?.height) {
      return imageSize;
    }

    return { width: 0, height: 0 };
  }, [imageSize, naturalSize]);

  const overlayBarcodes = useMemo(() => {
    if (
      !imageSize?.width ||
      !naturalSize.width ||
      imageSize.width === naturalSize.width
    ) {
      return barcodes;
    }

    const scaleX = naturalSize.width / imageSize.width;
    const scaleY = naturalSize.height / imageSize.height;

    return barcodes.map((barcode) => ({
      ...barcode,
      boundingBox: {
        x: barcode.boundingBox.x * scaleX,
        y: barcode.boundingBox.y * scaleY,
        width: barcode.boundingBox.width * scaleX,
        height: barcode.boundingBox.height * scaleY,
      },
      cornerPoints: barcode.cornerPoints.map((point) => ({
        x: point.x * scaleX,
        y: point.y * scaleY,
      })) as DetectedBarcode["cornerPoints"],
    }));
  }, [barcodes, imageSize, naturalSize]);

  const showOverlay = overlayBarcodes.length > 0 && viewBoxSize.width > 0;

  return (
    <div className="flex w-full justify-center">
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
        {loadError ? (
          <div className="flex min-h-[200px] min-w-[280px] items-center justify-center px-6 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Preview unavailable for this image format, but scanning may still
            work.
          </div>
        ) : previewUrl ? (
          <div className="relative inline-flex max-h-[480px] max-w-full leading-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Uploaded preview"
              className="block max-h-[480px] max-w-full"
              onLoad={(event) => {
                setNaturalSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                });
              }}
              onError={() => setLoadError(true)}
            />

            {showOverlay ? (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                viewBox={`0 0 ${viewBoxSize.width} ${viewBoxSize.height}`}
                preserveAspectRatio="xMidYMid meet"
                aria-hidden="true"
              >
                {overlayBarcodes.map((barcode, index) => {
                  const box = barcode.boundingBox;
                  const hasBox = box.width > 1 && box.height > 1;

                  return (
                    <g key={`${barcode.rawValue}-${index}`}>
                      {hasBox ? (
                        <rect
                          x={box.x}
                          y={box.y}
                          width={box.width}
                          height={box.height}
                          fill={DETECT_FILL}
                          stroke="none"
                        />
                      ) : (
                        <polygon
                          points={barcode.cornerPoints
                            .map((point) => `${point.x},${point.y}`)
                            .join(" ")}
                          fill={DETECT_FILL}
                          stroke="none"
                        />
                      )}
                    </g>
                  );
                })}
              </svg>
            ) : null}
          </div>
        ) : (
          <div className="flex min-h-[200px] min-w-[280px] items-center justify-center px-6 py-12 text-sm text-zinc-500 dark:text-zinc-400">
            Loading preview…
          </div>
        )}
      </div>
    </div>
  );
}
