"use client";

import { Camera, List } from "lucide-react";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { BarcodeResults } from "@/components/BarcodeResults";
import { DetectionOverlayShape } from "@/components/DetectionOverlayShape";
import { ResultsBottomSheet } from "@/components/ResultsBottomSheet";
import { DevMetrics } from "@/components/scanner/DevMetrics";
import { LocateStatusStrip } from "@/components/scanner/LocateStatusStrip";
import { RoiViewfinder } from "@/components/scanner/RoiViewfinder";
import { ScannerDock } from "@/components/scanner/ScannerDock";
import { useScannerChrome } from "@/components/scanner/ScannerChromeContext";
import { Button } from "@/components/ui/button";
import { useCameraStream } from "@/hooks/useCameraStream";
import {
  useLiveRoiDecode,
  type LiveDecodedBox,
} from "@/hooks/useLiveRoiDecode";
import { useLiveYoloLocate } from "@/hooks/useLiveYoloLocate";
import type { ScanDetection } from "@/lib/barcode/types";
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

function liveBoxToScanDetection(box: LiveDecodedBox): ScanDetection {
  const format = (box.format ?? "unknown") as ScanDetection["format"];
  return {
    rawValue: box.rawValue ?? "",
    format,
    boundingBox: {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    },
    cornerPoints: [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
      { x: box.x, y: box.y + box.height },
    ],
    status: box.status,
    score: box.score,
    source: "yolo",
    trackId: box.id,
  };
}

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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mediaEl, setMediaEl] = useState<HTMLVideoElement | null>(null);
  const autoStartedRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const prevRoiHitRef = useRef(0);
  const lastFlashReadAtRef = useRef(0);
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

  const handleClearRoi = useCallback(() => {
    setRoi(DEFAULT_ROI);
  }, []);

  const {
    boxes,
    trackMeta,
    fps,
    inferenceMs,
    status: locateStatus,
    error: locateError,
    clearBoxes,
  } = useLiveYoloLocate({
    videoRef,
    enabled: ready,
  });

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
  }, [
    facingMode,
    roi,
    roiEnabled,
    stageSize.height,
    stageSize.width,
    videoSize.height,
    videoSize.width,
  ]);

  const {
    decodedBoxes,
    reads,
    readCount,
    decoding,
    clearReads,
    lastNewReadAt,
  } = useLiveRoiDecode({
    videoRef,
    enabled: ready,
    boxes,
    trackMeta,
    sourceRoi,
    roiEnabled,
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
    clearReads();
    stop();
    setStarting(false);
    setSheetOpen(false);
    setRoiEditing(false);
  }, [clearBoxes, clearReads, setRoiEditing, stop]);

  const handleFlip = useCallback(async () => {
    setStarting(true);
    try {
      await flipFacing();
    } finally {
      setStarting(false);
    }
  }, [flipFacing]);

  // Keep live control handlers in refs so we register once (avoids effect
  // churn on every locate tick that was resetting ROI chrome state).
  const handleStartRef = useRef(handleStart);
  const handleStopRef = useRef(handleStop);
  const handleFlipRef = useRef(handleFlip);
  handleStartRef.current = handleStart;
  handleStopRef.current = handleStop;
  handleFlipRef.current = handleFlip;

  useEffect(() => {
    registerLiveControls({
      onStart: () => {
        void handleStartRef.current();
      },
      onStop: () => {
        handleStopRef.current();
      },
      onToggleFacing: () => {
        void handleFlipRef.current();
      },
    });
    return () => {
      registerLiveControls(null);
    };
  }, [registerLiveControls]);

  useEffect(() => {
    registerRoiControls({
      onApplyPreset: handleApplyPreset,
      onClear: handleClearRoi,
    });
    return () => {
      registerRoiControls(null);
    };
  }, [handleApplyPreset, handleClearRoi, registerRoiControls]);

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

  const visibleBoxes = useMemo(() => {
    if (!sourceRoi) {
      return decodedBoxes;
    }
    return decodedBoxes.filter((box) => boxIntersectsRoi(box, sourceRoi));
  }, [decodedBoxes, sourceRoi]);

  const overlayBarcodes = useMemo(() => {
    // Live camera: hide unread clutter; one overlay entity per track / value.
    const seenTrack = new Set<number>();
    const seenValue = new Set<string>();
    const out: ReturnType<typeof liveBoxToScanDetection>[] = [];
    for (const box of visibleBoxes) {
      if (box.status === "unread") {
        continue;
      }
      if (seenTrack.has(box.id)) {
        continue;
      }
      if (box.status === "read" && box.rawValue) {
        if (seenValue.has(box.rawValue)) {
          continue;
        }
        seenValue.add(box.rawValue);
      }
      seenTrack.add(box.id);
      out.push(liveBoxToScanDetection(box));
    }
    return out;
  }, [visibleBoxes]);

  const listBarcodes = useMemo(() => {
    // Stable unique results from session reads (not every live track tick).
    const byValue = new Map<string, ScanDetection>();
    for (const box of visibleBoxes) {
      if (box.status !== "read" || !box.rawValue) {
        continue;
      }
      byValue.set(box.rawValue, liveBoxToScanDetection(box));
    }
    for (const read of reads) {
      if (byValue.has(read.rawValue)) {
        continue;
      }
      const format = (read.format || "unknown") as ScanDetection["format"];
      byValue.set(read.rawValue, {
        rawValue: read.rawValue,
        format,
        boundingBox: { x: 0, y: 0, width: 0, height: 0 },
        cornerPoints: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
        status: "read",
        score: 1,
        source: "yolo",
        trackId: read.trackId,
      });
    }
    return Array.from(byValue.values());
  }, [visibleBoxes, reads]);

  // #region agent log
  const renderCountRef = useRef(0);
  const lastListSigRef = useRef("");
  renderCountRef.current += 1;
  {
    const listSig = listBarcodes
      .map(
        (b) =>
          `${b.status}:${b.trackId ?? "?"}:${b.rawValue?.slice(0, 12) ?? ""}:${Math.round(b.boundingBox.x)}:${Math.round(b.boundingBox.y)}`,
      )
      .join("|");
    if (listSig !== lastListSigRef.current || renderCountRef.current % 30 === 1) {
      const changed = listSig !== lastListSigRef.current;
      lastListSigRef.current = listSig;
      fetch(
        "http://127.0.0.1:7835/ingest/0fbe70ba-5541-45af-9767-b65e9e5e5e90",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "45ff5c",
          },
          body: JSON.stringify({
            sessionId: "45ff5c",
            runId: "post-fix-5",
            hypothesisId: "H4",
            location: "LiveScanPage.tsx:render",
            message: changed ? "list_sig_changed" : "page_render",
            data: {
              renders: renderCountRef.current,
              listLen: listBarcodes.length,
              overlayLen: overlayBarcodes.length,
              readCount,
              listSig: listSig.slice(0, 200),
              fps,
              inferenceMs,
            },
            timestamp: Date.now(),
          }),
        },
      ).catch(() => {});
    }
  }
  // #endregion

  const unreadCount = listBarcodes.filter((b) => b.status === "unread").length;
  const locatedCount = listBarcodes.filter(
    (b) => b.status === "located",
  ).length;
  const totalCount = listBarcodes.length;

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

  useEffect(() => {
    if (!lastNewReadAt || lastNewReadAt === lastFlashReadAtRef.current) {
      return;
    }
    lastFlashReadAtRef.current = lastNewReadAt;
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 450);
    return () => window.clearTimeout(timer);
  }, [lastNewReadAt]);

  const statusLabel =
    locateStatus === "loading-model"
      ? "Loading YOLO model…"
      : decoding
        ? "Reading…"
        : locateStatus === "running"
          ? roiEnabled
            ? "Hold steady in ROI…"
            : "Locating barcodes…"
          : locateStatus === "error"
            ? "Locate error"
            : ready
              ? "Camera ready"
              : "Camera stopped";

  const error = cameraError ?? locateError;
  const running = ready;
  const showStopped = !running && !starting;

  useEffect(() => {
    setMediaEl(videoRef.current);
  }, [ready, videoRef, videoSize.height, videoSize.width]);

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
              className={cn(
                "cl-overlay",
                facingMode === "user" && "scale-x-[-1]",
              )}
              viewBox={`0 0 ${videoSize.width} ${videoSize.height}`}
              preserveAspectRatio="xMidYMid slice"
              aria-hidden="true"
            >
              {overlayBarcodes.map((barcode, index) => (
                <DetectionOverlayShape
                  key={
                    barcode.trackId !== undefined
                      ? `track-${barcode.trackId}`
                      : `i-${index}-${barcode.rawValue || "loc"}`
                  }
                  barcode={barcode}
                  index={index}
                />
              ))}
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
                  Start again to continue live locate and decode.
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

          {running && totalCount > 0 ? (
            <div className="pointer-events-auto absolute bottom-[max(5.5rem,env(safe-area-inset-bottom))] left-4 z-30 md:hidden">
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
            </div>
          ) : null}

          <ScannerDock>
            <LocateStatusStrip
              visible={running}
              statusLabel={statusLabel}
              boxCount={overlayBarcodes.length}
              fps={fps}
              inferenceMs={inferenceMs}
              readCount={readCount}
              decoding={decoding}
            />
          </ScannerDock>
        </div>
      </section>

      <aside className="hidden w-full max-w-md flex-col border-l border-[var(--border-soft)] bg-[var(--background)] md:flex">
        <div className="border-b border-[var(--border-soft)] px-5 py-4">
          <h2 className="text-base font-semibold text-ink dark:text-[var(--foreground)]">
            Detected barcodes
            {totalCount > 0 ? `: ${totalCount}` : ""}
          </h2>
          <p className="text-sm text-[var(--muted)]">
            {running
              ? `${readCount} read · ${unreadCount} unread · ${locatedCount} located`
              : "Start the camera to begin localization."}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <DevMetrics
            metrics={[
              { label: "Locate FPS", value: fps },
              { label: "Inference ms", value: inferenceMs },
              { label: "Boxes", value: visibleBoxes.length },
              { label: "Reads", value: readCount },
              {
                label: "ROI",
                value: roiEnabled ? (roiEditing ? "editing" : "on") : "off",
              },
            ]}
          />
          <div className="mt-4">
            <BarcodeResults
              barcodes={listBarcodes}
              media={mediaEl}
              imageSize={videoSize}
              compact
            />
          </div>
        </div>
      </aside>

      <ResultsBottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        barcodes={listBarcodes}
        media={mediaEl}
        imageSize={videoSize}
        title="Detected barcodes"
        subtitle={
          totalCount > 0
            ? `${readCount} read · ${unreadCount} unread · ${locatedCount} located`
            : undefined
        }
      />
    </div>
  );
}
