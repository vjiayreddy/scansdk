"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { useCameraStream } from "@/hooks/useCameraStream";
import { useLiveYoloLocate } from "@/hooks/useLiveYoloLocate";

const DETECT_STROKE_LOCATED = "#1151ff";

export function LiveScanPage() {
  const {
    videoRef,
    error: cameraError,
    ready,
    facingMode,
    start,
    stop,
    flipFacing,
  } = useCameraStream();

  const [videoSize, setVideoSize] = useState({ width: 1280, height: 720 });

  const {
    boxes,
    fps,
    inferenceMs,
    status: locateStatus,
    error: locateError,
  } = useLiveYoloLocate({
    videoRef,
    enabled: ready,
  });

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth < 1) {
      return;
    }
    setVideoSize({ width: video.videoWidth, height: video.videoHeight });
  }, [videoRef]);

  const statusLabel =
    locateStatus === "loading-model"
      ? "Loading YOLO model…"
      : locateStatus === "running"
        ? "Locating barcodes…"
        : locateStatus === "error"
          ? "Locate error"
          : ready
            ? "Camera ready"
            : "Camera stopped";

  const error = cameraError ?? locateError;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Live barcode locate
          </h1>
          <Link
            href="/"
            className="text-sm font-medium text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
          >
            Upload scan
          </Link>
        </div>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Point the camera at barcodes to test YOLO localization. Boxes only —
          no decode in this mode.
        </p>
      </header>

      {error ? (
        <div
          className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-900 dark:border-zinc-800">
        <video
          ref={videoRef}
          className="block aspect-video w-full object-contain"
          playsInline
          muted
          autoPlay
          onLoadedMetadata={handleLoadedMetadata}
        />

        {ready ? (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 ${videoSize.width} ${videoSize.height}`}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
          >
            {boxes.map((box) => {
              const strokeWidth = Math.max(
                2,
                Math.min(box.width, box.height) * 0.04,
              );
              return (
                <g key={box.id}>
                  <rect
                    x={box.x}
                    y={box.y}
                    width={box.width}
                    height={box.height}
                    fill="none"
                    stroke={DETECT_STROKE_LOCATED}
                    strokeWidth={strokeWidth}
                  />
                  <text
                    x={box.x + strokeWidth}
                    y={box.y + strokeWidth * 4}
                    fill={DETECT_STROKE_LOCATED}
                    fontSize={Math.max(12, strokeWidth * 3)}
                    fontFamily="ui-sans-serif, system-ui, sans-serif"
                  >
                    {(box.score * 100).toFixed(0)}%
                  </text>
                </g>
              );
            })}
          </svg>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80 px-6 text-center text-sm text-zinc-300">
            Start the camera to begin live YOLO localization.
          </div>
        )}

        {ready ? (
          <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
            {statusLabel} · {boxes.length} box{boxes.length === 1 ? "" : "es"} ·{" "}
            {fps} FPS · {inferenceMs} ms
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3">
        {!ready ? (
          <button
            type="button"
            onClick={() => void start()}
            className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Start camera
          </button>
        ) : (
          <button
            type="button"
            onClick={stop}
            className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Stop camera
          </button>
        )}
        <button
          type="button"
          onClick={() => void flipFacing()}
          disabled={!ready}
          className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          Flip ({facingMode === "environment" ? "rear" : "front"})
        </button>
      </div>
    </div>
  );
}
