"use client";

import { Camera } from "lucide-react";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { DevMetrics } from "@/components/scanner/DevMetrics";
import { LocateStatusStrip } from "@/components/scanner/LocateStatusStrip";
import { RoiViewfinder } from "@/components/scanner/RoiViewfinder";
import { ScannerDock } from "@/components/scanner/ScannerDock";
import { useScannerChrome } from "@/components/scanner/ScannerChromeContext";
import { Button } from "@/components/ui/button";
import { useCameraStream } from "@/hooks/useCameraStream";
import { useLiveYoloLocate } from "@/hooks/useLiveYoloLocate";
import {
  DEFAULT_ROI,
  ROI_PRESETS,
  boxIntersectsRoi,
  matchRoiPreset,
  normalizedRoiToSourceBBox,
  type NormalizedRoi,
  type RoiPresetId,
} from "@/lib/roi";
import { cn } from "@/lib/utils";

const DETECT_STROKE = "#22c55e";
const DETECT_SCORE = "#ff4d8b";

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

  const {
    setFacing,
    setRunning: setChromeRunning,
    registerLiveControls,
    registerRoiControls,
    setRoiPresetId,
    roiEditing,
    roiEnabled,
    setRoiEditing,
  } = useScannerChrome();

  const [videoSize, setVideoSize] = useState({ width: 1280, height: 720 });
  const [starting, setStarting] = useState(false);
  const [roi, setRoi] = useState<NormalizedRoi>(DEFAULT_ROI);
  const [flash, setFlash] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 1, height: 1 });
  const autoStartedRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const prevRoiHitRef = useRef(0);

  const handleRoiChange = useCallback(
    (next: NormalizedRoi) => {
      startTransition(() => {
        setRoi(next);
        setRoiPresetId(matchRoiPreset(next));
      });
    },
    [setRoiPresetId],
  );

  const handleApplyPreset = useCallback(
    (id: RoiPresetId) => {
      const next = ROI_PRESETS[id].roi;
      setRoi(next);
      setRoiPresetId(id);
    },
    [setRoiPresetId],
  );

  const {
    boxes,
    fps,
    inferenceMs,
    status: locateStatus,
    error: locateError,
    clearBoxes,
  } = useLiveYoloLocate({
    videoRef,
    enabled: ready,
  });

  const handleStart = useCallback(async () => {
    setStarting(true);
    try {
      await start();
    } finally {
      setStarting(false);
    }
  }, [start]);

  const handleStop = useCallback(() => {
    clearBoxes();
    stop();
    setStarting(false);
    // Keep ROI on; re-open edit/presets next time camera starts.
    setRoiEditing(true);
  }, [clearBoxes, setRoiEditing, stop]);

  const handleFlip = useCallback(async () => {
    setStarting(true);
    try {
      await flipFacing();
    } finally {
      setStarting(false);
    }
  }, [flipFacing]);

  useEffect(() => {
    registerLiveControls({
      onStart: () => {
        void handleStart();
      },
      onStop: handleStop,
      onToggleFacing: () => {
        void handleFlip();
      },
    });
    return () => {
      registerLiveControls(null);
    };
  }, [handleFlip, handleStart, handleStop, registerLiveControls]);

  useEffect(() => {
    registerRoiControls({
      onApplyPreset: handleApplyPreset,
    });
    return () => {
      registerRoiControls(null);
    };
  }, [handleApplyPreset, registerRoiControls]);

  useEffect(() => {
    setChromeRunning(ready);
  }, [ready, setChromeRunning]);

  useEffect(() => {
    setFacing(facingMode);
  }, [facingMode, setFacing]);

  useEffect(() => {
    if (autoStartedRef.current) {
      return;
    }
    autoStartedRef.current = true;
    void handleStart();
  }, [handleStart]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const update = () => {
      setStageSize({
        width: stage.clientWidth || 1,
        height: stage.clientHeight || 1,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [ready]);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth < 1) {
      return;
    }
    setVideoSize({ width: video.videoWidth, height: video.videoHeight });
  }, [videoRef]);

  const sourceRoi = useMemo(() => {
    if (!roiEnabled) {
      return null;
    }
    return normalizedRoiToSourceBBox(
      roi,
      videoSize.width,
      videoSize.height,
      stageSize.width,
      stageSize.height,
      facingMode === "user",
      "cover",
    );
  }, [facingMode, roi, roiEnabled, stageSize.height, stageSize.width, videoSize.height, videoSize.width]);

  const visibleBoxes = useMemo(() => {
    if (!sourceRoi) {
      return boxes;
    }
    return boxes.filter((box) => boxIntersectsRoi(box, sourceRoi));
  }, [boxes, sourceRoi]);

  useEffect(() => {
    if (!roiEnabled || !ready) {
      prevRoiHitRef.current = 0;
      return;
    }
    const hit = visibleBoxes.length;
    if (hit > 0 && prevRoiHitRef.current === 0) {
      setFlash(true);
      const timer = window.setTimeout(() => setFlash(false), 450);
      prevRoiHitRef.current = hit;
      return () => window.clearTimeout(timer);
    }
    prevRoiHitRef.current = hit;
  }, [ready, roiEnabled, visibleBoxes.length]);

  const statusLabel =
    locateStatus === "loading-model"
      ? "Loading YOLO model…"
      : locateStatus === "running"
        ? roiEnabled
          ? "Locating in ROI…"
          : "Locating barcodes…"
        : locateStatus === "error"
          ? "Locate error"
          : ready
            ? "Camera ready"
            : "Camera stopped";

  const error = cameraError ?? locateError;
  const running = ready;
  const showStopped = !running && !starting;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
      <section className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={stageRef}
          className="cl-stage relative min-h-[calc(100dvh-3.5rem)] w-full flex-1 bg-surface-dark md:min-h-0"
        >
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            onLoadedMetadata={handleLoadedMetadata}
            className={cn(
              "absolute inset-0 h-full w-full object-cover",
              facingMode === "user" && "scale-x-[-1]",
            )}
          />

          {running ? (
            <svg
              className="cl-overlay"
              viewBox={`0 0 ${videoSize.width} ${videoSize.height}`}
              preserveAspectRatio="xMidYMid slice"
              aria-hidden="true"
            >
              {visibleBoxes.map((box) => {
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
                      stroke={DETECT_STROKE}
                      strokeWidth={strokeWidth}
                    />
                    <text
                      x={box.x + strokeWidth}
                      y={box.y + strokeWidth * 4}
                      fill={DETECT_SCORE}
                      fontSize={Math.max(12, strokeWidth * 3)}
                      fontFamily="Inter, system-ui, sans-serif"
                    >
                      {(box.score * 100).toFixed(0)}%
                    </text>
                  </g>
                );
              })}
            </svg>
          ) : null}

          {running && roiEnabled ? (
            <RoiViewfinder
              roi={roi}
              onChange={handleRoiChange}
              editing={roiEditing}
              flash={flash}
              className="pb-24"
            />
          ) : null}

          {starting && !running ? (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface-dark/80 px-6 text-center">
              <div className="size-8 animate-pulse rounded-full bg-brand-lavender" />
              <p className="text-sm font-medium text-white">
                Starting{" "}
                {facingMode === "environment" ? "back" : "front"} camera…
              </p>
            </div>
          ) : null}

          {showStopped ? (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-surface-soft px-6 text-center dark:bg-[var(--surface)]">
              <div className="flex size-16 items-center justify-center rounded-xl bg-brand-lavender/80 text-ink">
                <Camera className="size-8" strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-lg font-semibold tracking-tight text-ink dark:text-[var(--foreground)]">
                  Camera stopped
                </p>
                <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">
                  Start again to continue live YOLO barcode localization.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                className="min-w-[120px]"
                onClick={() => void handleStart()}
              >
                Start
              </Button>
            </div>
          ) : null}

          {error ? (
            <div
              className="absolute left-3 right-3 top-3 z-20 rounded-md bg-canvas px-3 py-2.5 text-sm text-error ring-1 ring-hairline dark:bg-[var(--background)] dark:text-[var(--destructive)]"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          <ScannerDock>
            <LocateStatusStrip
              visible={running}
              statusLabel={statusLabel}
              boxCount={visibleBoxes.length}
              fps={fps}
              inferenceMs={inferenceMs}
            />
          </ScannerDock>
        </div>
      </section>

      <aside className="hidden w-full max-w-md flex-col border-l border-[var(--border-soft)] bg-[var(--background)] md:flex">
        <div className="border-b border-[var(--border-soft)] px-5 py-4">
          <h2 className="text-base font-semibold text-ink dark:text-[var(--foreground)]">
            Live locate
          </h2>
          <p className="text-sm text-[var(--muted)]">
            YOLO boxes only — decode is skipped in this mode.
            {roiEnabled ? " · ROI filter on" : ""}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-4 text-sm text-[var(--muted)]">
            {running
              ? `${visibleBoxes.length} box${visibleBoxes.length === 1 ? "" : "es"} on screen`
              : "Start the camera to begin localization."}
          </p>
          <DevMetrics
            metrics={[
              { label: "Locate FPS", value: fps },
              { label: "Inference ms", value: inferenceMs },
              { label: "Boxes", value: visibleBoxes.length },
              {
                label: "ROI",
                value: roiEnabled ? (roiEditing ? "editing" : "on") : "off",
              },
            ]}
          />
        </div>
      </aside>
    </div>
  );
}
