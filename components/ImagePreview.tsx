"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import type { DetectedBarcode, ImageSize, ScanDetection } from "@/lib/barcode/types";
import { cn } from "@/lib/utils";

export interface ImagePreviewHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  getZoom: () => number;
}

interface ImagePreviewProps {
  file: File;
  barcodes?: ScanDetection[];
  imageSize?: ImageSize;
  /** Full-bleed stage (contain) vs card preview. */
  variant?: "stage" | "card";
  /** Stage image fit — cover fills width/height; contain letterboxes. */
  objectFit?: "cover" | "contain";
  onZoomChange?: (zoom: number) => void;
}

const DETECT_FILL_READ = "rgba(34, 197, 94, 0.55)";
const DETECT_FILL_UNREAD = "rgba(239, 68, 68, 0.45)";
const DETECT_STROKE_LOCATED = "#ff4d8b";
const DETECT_STROKE_READ = "#22c55e";

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.5;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
}

export const ImagePreview = forwardRef<ImagePreviewHandle, ImagePreviewProps>(
  function ImagePreview(
    {
      file,
      barcodes = [],
      imageSize,
      variant = "card",
      objectFit = "contain",
      onZoomChange,
    },
    ref,
  ) {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [naturalSize, setNaturalSize] = useState<ImageSize>({
      width: 0,
      height: 0,
    });
    const [zoom, setZoom] = useState(MIN_ZOOM);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

    const viewportRef = useRef<HTMLDivElement>(null);
    const zoomRef = useRef(zoom);
    const panRef = useRef(pan);
    const dragRef = useRef<{
      pointerId: number;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    } | null>(null);
    const pinchRef = useRef<{
      startDistance: number;
      startZoom: number;
    } | null>(null);
    const pointersRef = useRef<Map<number, { x: number; y: number }>>(
      new Map(),
    );

    zoomRef.current = zoom;
    panRef.current = pan;

    useLayoutEffect(() => {
      if (variant !== "stage") {
        return;
      }
      const el = viewportRef.current;
      if (!el) {
        return;
      }
      const update = () => {
        const rect = el.getBoundingClientRect();
        setViewportSize({
          width: Math.max(0, rect.width),
          height: Math.max(0, rect.height),
        });
      };
      update();
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }, [previewUrl, variant]);

    const srcWidth = naturalSize.width || imageSize?.width || 0;
    const srcHeight = naturalSize.height || imageSize?.height || 0;

    const displayLayout = useMemo(() => {
      if (
        !srcWidth ||
        !srcHeight ||
        !viewportSize.width ||
        !viewportSize.height
      ) {
        return null;
      }

      const fitScale =
        objectFit === "cover"
          ? Math.max(
              viewportSize.width / srcWidth,
              viewportSize.height / srcHeight,
            )
          : Math.min(
              viewportSize.width / srcWidth,
              viewportSize.height / srcHeight,
            );

      const width = srcWidth * fitScale * zoom;
      const height = srcHeight * fitScale * zoom;
      const left = (viewportSize.width - width) / 2 + pan.x;
      const top = (viewportSize.height - height) / 2 + pan.y;

      return { width, height, left, top };
    }, [
      objectFit,
      pan.x,
      pan.y,
      srcHeight,
      srcWidth,
      viewportSize.height,
      viewportSize.width,
      zoom,
    ]);

    const setZoomClamped = useCallback(
      (next: number | ((prev: number) => number)) => {
        setZoom((prev) => {
          const raw = typeof next === "function" ? next(prev) : next;
          return clampZoom(raw);
        });
      },
      [],
    );

    useEffect(() => {
      onZoomChange?.(zoom);
      if (zoom <= MIN_ZOOM) {
        setPan({ x: 0, y: 0 });
      }
    }, [zoom, onZoomChange]);

    useImperativeHandle(
      ref,
      () => ({
        zoomIn: () => setZoomClamped((z) => z + ZOOM_STEP),
        zoomOut: () => setZoomClamped((z) => z - ZOOM_STEP),
        resetZoom: () => {
          setZoomClamped(MIN_ZOOM);
          setPan({ x: 0, y: 0 });
        },
        getZoom: () => zoomRef.current,
      }),
      [setZoomClamped],
    );

    // Data URL via FileReader — survives React Strict Mode (blob URLs get revoked
    // on the first effect cleanup and break the remounted <img>).
    useEffect(() => {
      let cancelled = false;
      const reader = new FileReader();

      reader.onload = () => {
        if (cancelled || typeof reader.result !== "string") {
          return;
        }
        setPreviewUrl(reader.result);
        setLoadError(false);
        setNaturalSize({ width: 0, height: 0 });
        setZoom(MIN_ZOOM);
        setPan({ x: 0, y: 0 });
      };

      reader.onerror = () => {
        if (!cancelled) {
          setPreviewUrl(null);
          setLoadError(true);
        }
      };

      reader.readAsDataURL(file);

      return () => {
        cancelled = true;
        reader.abort();
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
    const isStage = variant === "stage";
    const canPan = zoom > MIN_ZOOM;

    const pointerDistance = useCallback(() => {
      const points = [...pointersRef.current.values()];
      if (points.length < 2) {
        return 0;
      }
      const [a, b] = points;
      return Math.hypot(a.x - b.x, a.y - b.y);
    }, []);

    const onPointerDown = useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!isStage) {
          return;
        }
        pointersRef.current.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
        });

        if (pointersRef.current.size === 2) {
          dragRef.current = null;
          pinchRef.current = {
            startDistance: pointerDistance(),
            startZoom: zoomRef.current,
          };
          return;
        }

        if (zoomRef.current <= MIN_ZOOM) {
          return;
        }

        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: panRef.current.x,
          originY: panRef.current.y,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      [isStage, pointerDistance],
    );

    const onPointerMove = useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!pointersRef.current.has(event.pointerId)) {
          return;
        }
        pointersRef.current.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
        });

        if (pinchRef.current && pointersRef.current.size >= 2) {
          const distance = pointerDistance();
          if (pinchRef.current.startDistance > 0) {
            const ratio = distance / pinchRef.current.startDistance;
            setZoomClamped(pinchRef.current.startZoom * ratio);
          }
          return;
        }

        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) {
          return;
        }
        setPan({
          x: drag.originX + (event.clientX - drag.startX),
          y: drag.originY + (event.clientY - drag.startY),
        });
      },
      [pointerDistance, setZoomClamped],
    );

    const endPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
      pointersRef.current.delete(event.pointerId);
      if (pointersRef.current.size < 2) {
        pinchRef.current = null;
      }
      if (dragRef.current?.pointerId === event.pointerId) {
        dragRef.current = null;
      }
    }, []);

    const onWheel = useCallback(
      (event: ReactWheelEvent<HTMLDivElement>) => {
        if (!isStage) {
          return;
        }
        event.preventDefault();
        const delta = event.deltaY > 0 ? -ZOOM_STEP / 2 : ZOOM_STEP / 2;
        setZoomClamped((z) => z + delta);
      },
      [isStage, setZoomClamped],
    );

    const onDoubleClick = useCallback(() => {
      if (!isStage) {
        return;
      }
      if (zoomRef.current > MIN_ZOOM) {
        setZoomClamped(MIN_ZOOM);
        setPan({ x: 0, y: 0 });
      } else {
        setZoomClamped(2);
      }
    }, [isStage, setZoomClamped]);

    if (loadError) {
      return (
        <div
          className={cn(
            "flex items-center justify-center px-6 text-center text-sm text-muted",
            isStage ? "absolute inset-0 bg-surface-dark" : "min-h-[200px]",
          )}
        >
          Preview unavailable for this image format, but scanning may still work.
        </div>
      );
    }

    if (!previewUrl) {
      return (
        <div
          className={cn(
            "flex items-center justify-center text-sm text-muted",
            isStage ? "absolute inset-0 bg-surface-soft" : "min-h-[200px]",
          )}
        >
          Loading preview…
        </div>
      );
    }

    if (isStage) {
      return (
        <div
          ref={viewportRef}
          className={cn(
            "absolute inset-0 touch-none overflow-hidden bg-surface-dark",
            canPan ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onWheel={onWheel}
          onDoubleClick={onDoubleClick}
        >
          <div
            className="absolute"
            style={
              displayLayout
                ? {
                    width: displayLayout.width,
                    height: displayLayout.height,
                    left: displayLayout.left,
                    top: displayLayout.top,
                  }
                : {
                    inset: 0,
                  }
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Uploaded preview"
              draggable={false}
              className={
                displayLayout
                  ? "block h-full w-full select-none object-fill"
                  : "block h-full w-full select-none object-contain"
              }
              onLoad={(event) => {
                setNaturalSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                });
              }}
              onError={() => setLoadError(true)}
            />
            {showOverlay && displayLayout ? (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                viewBox={`0 0 ${viewBoxSize.width} ${viewBoxSize.height}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {overlayBarcodes.map((barcode, index) =>
                  renderOverlayShape(barcode, index),
                )}
              </svg>
            ) : null}
          </div>
        </div>
      );
    }

    return (
      <div className="flex w-full justify-center">
        <div className="overflow-hidden rounded-xl border border-hairline bg-surface-soft dark:border-[var(--border)] dark:bg-[var(--surface)]">
          <div className="relative inline-flex max-h-[min(60dvh,480px)] max-w-full leading-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Uploaded preview"
              className="block max-h-[min(60dvh,480px)] max-w-full"
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
                {overlayBarcodes.map((barcode, index) =>
                  renderOverlayShape(barcode, index),
                )}
              </svg>
            ) : null}
          </div>
        </div>
      </div>
    );
  },
);

function renderOverlayShape(barcode: ScanDetection, index: number) {
  const box = barcode.boundingBox;
  const hasBox = box.width > 1 && box.height > 1;
  const locateOnly = barcode.status === "located";
  const unread = barcode.status === "unread";
  const fill = locateOnly
    ? "none"
    : unread
      ? DETECT_FILL_UNREAD
      : DETECT_FILL_READ;
  const stroke = locateOnly
    ? DETECT_STROKE_LOCATED
    : unread
      ? "#ef4444"
      : DETECT_STROKE_READ;
  const strokeWidth = Math.max(2, Math.min(box.width, box.height) * 0.035);
  const glyphSize = Math.max(
    16,
    Math.min(box.width, box.height) * (locateOnly ? 0 : 0.42),
  );
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const glyphStroke = Math.max(2.5, glyphSize * 0.12);

  return (
    <g key={`${barcode.rawValue}-${index}`}>
      {hasBox ? (
        <rect
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      ) : (
        <polygon
          points={barcode.cornerPoints
            .map((point) => `${point.x},${point.y}`)
            .join(" ")}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      )}
      {hasBox && !locateOnly ? (
        unread ? (
          <g
            aria-hidden
            stroke="#ffffff"
            strokeWidth={glyphStroke}
            strokeLinecap="round"
            fill="none"
          >
            <line
              x1={cx - glyphSize / 2}
              y1={cy - glyphSize / 2}
              x2={cx + glyphSize / 2}
              y2={cy + glyphSize / 2}
            />
            <line
              x1={cx + glyphSize / 2}
              y1={cy - glyphSize / 2}
              x2={cx - glyphSize / 2}
              y2={cy + glyphSize / 2}
            />
          </g>
        ) : (
          <polyline
            aria-hidden
            points={`${cx - glyphSize * 0.35},${cy} ${cx - glyphSize * 0.08},${cy + glyphSize * 0.32} ${cx + glyphSize * 0.4},${cy - glyphSize * 0.32}`}
            fill="none"
            stroke="#ffffff"
            strokeWidth={glyphStroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      ) : null}
      {hasBox ? (
        <text
          x={box.x + strokeWidth}
          y={box.y + strokeWidth * 4}
          fill={stroke}
          fontSize={Math.max(12, strokeWidth * 3.5)}
          fontWeight={600}
          fontFamily="Inter, system-ui, sans-serif"
        >
          {index + 1}
          {barcode.score !== undefined
            ? ` ${Math.round(barcode.score * 100)}%`
            : ""}
        </text>
      ) : null}
    </g>
  );
}
