"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Camera,
  CircleStop,
  Crop,
  ImageIcon,
  Maximize2,
  Minimize2,
  MoreVertical,
  RectangleHorizontal,
  RectangleVertical,
  Square,
  SwitchCamera,
  X,
} from "lucide-react";

import { useScannerChrome } from "@/components/scanner/ScannerChromeContext";
import { Button } from "@/components/ui/button";
import {
  ROI_PRESETS,
  ROI_PRESET_ORDER,
  type RoiPresetId,
} from "@/lib/roi";
import { cn } from "@/lib/utils";

const PRESET_ICONS: Record<RoiPresetId, ReactNode> = {
  "center-sm": <Minimize2 className="size-4 shrink-0" />,
  "center-md": <Square className="size-4 shrink-0" />,
  "center-lg": <Maximize2 className="size-4 shrink-0" />,
  strip: <RectangleHorizontal className="size-4 shrink-0" />,
  portrait: <RectangleVertical className="size-4 shrink-0" />,
};

export function AppTopbar() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const {
    running,
    facing,
    roiEditing,
    roiEnabled,
    roiPresetId,
    setRoiEditing,
    setRoiEnabled,
    setRoiPresetId,
    applyRoiPreset,
    stop,
    toggleFacing,
  } = useScannerChrome();
  const isLive = pathname === "/live" || pathname.startsWith("/live/");
  const isUpload = pathname === "/";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const toggleRoi = () => {
    if (!roiEnabled) {
      setRoiEnabled(true);
      setRoiEditing(true);
      return;
    }
    if (roiEditing) {
      setRoiEditing(false);
      return;
    }
    setRoiEditing(true);
  };

  const clearRoi = () => {
    setRoiEditing(false);
    setRoiEnabled(false);
    setRoiPresetId(null);
  };

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-hairline bg-canvas px-3 pt-[env(safe-area-inset-top,0px)] dark:border-[var(--border)] dark:bg-[var(--background)] md:h-16 md:px-6">
      <Link href="/" className="min-w-0 shrink" aria-label="ScanSDK home">
        <span className="text-base font-semibold tracking-tight text-ink dark:text-[var(--foreground)]">
          ScanSDK
        </span>
      </Link>

      <div className="flex items-center gap-1">
        {isLive ? (
          <div className="mr-0.5 flex items-center gap-0.5 rounded-md border border-hairline bg-surface-soft p-0.5 dark:border-[var(--border)] dark:bg-[var(--surface)]">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 rounded-[10px] hover:bg-canvas dark:hover:bg-[var(--background)]"
              aria-label={
                facing === "environment"
                  ? "Switch to front camera"
                  : "Switch to back camera"
              }
              onClick={toggleFacing}
            >
              <SwitchCamera className="size-4" />
            </Button>
            {running ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-8 rounded-[10px] hover:bg-canvas dark:hover:bg-[var(--background)]",
                    (roiEditing || roiEnabled) &&
                      "bg-canvas text-ink ring-1 ring-hairline dark:bg-[var(--background)]",
                  )}
                  aria-label={
                    !roiEnabled
                      ? "Enable ROI"
                      : roiEditing
                        ? "Done editing ROI"
                        : "Edit ROI"
                  }
                  aria-pressed={roiEditing || roiEnabled}
                  onClick={toggleRoi}
                >
                  <Crop className="size-4" />
                </Button>
                {roiEnabled ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-[10px] text-error hover:bg-error/10 dark:hover:bg-error/15"
                    aria-label="Clear ROI"
                    onClick={clearRoi}
                  >
                    <X className="size-4" />
                  </Button>
                ) : null}
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-[10px] bg-canvas px-2.5 text-xs font-semibold text-ink ring-1 ring-hairline transition-colors hover:bg-error/10 hover:text-error hover:ring-error/30 active:bg-error/15 dark:bg-[var(--background)] dark:text-[var(--foreground)] dark:ring-[var(--border)]"
                  aria-label="Stop camera"
                  onClick={stop}
                >
                  <CircleStop className="size-3.5 shrink-0" strokeWidth={2} />
                  Stop
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="relative" ref={menuRef}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreVertical className="size-5" />
          </Button>
          {menuOpen ? (
            <div className="absolute right-0 top-full z-50 mt-1 max-h-[min(70dvh,28rem)] w-56 overflow-y-auto overflow-x-hidden rounded-md border border-hairline bg-canvas py-1 shadow-md dark:border-[var(--border)] dark:bg-[var(--background)]">
              <p className="px-3 py-1.5 text-xs font-semibold text-muted">
                Scanner
              </p>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-ink hover:bg-surface-soft dark:text-[var(--foreground)] dark:hover:bg-[var(--surface)]",
                  isLive && "bg-surface-soft dark:bg-[var(--surface)]",
                )}
                onClick={() => {
                  setMenuOpen(false);
                  router.push("/live");
                }}
              >
                <Camera className="size-4 shrink-0" />
                Live
                {isLive ? (
                  <span className="ml-auto text-xs text-muted">Active</span>
                ) : null}
              </button>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-ink hover:bg-surface-soft dark:text-[var(--foreground)] dark:hover:bg-[var(--surface)]",
                  isUpload && "bg-surface-soft dark:bg-[var(--surface)]",
                )}
                onClick={() => {
                  setMenuOpen(false);
                  router.push("/");
                }}
              >
                <ImageIcon className="size-4 shrink-0" />
                Upload
                {isUpload ? (
                  <span className="ml-auto text-xs text-muted">Active</span>
                ) : null}
              </button>

              {isLive ? (
                <>
                  <div className="my-1 h-px bg-hairline dark:bg-[var(--border)]" />
                  <p className="px-3 py-1.5 text-xs font-semibold text-muted">
                    ROI
                  </p>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-ink hover:bg-surface-soft dark:text-[var(--foreground)] dark:hover:bg-[var(--surface)]"
                    onClick={() => {
                      setMenuOpen(false);
                      toggleRoi();
                    }}
                  >
                    <Crop className="size-4 shrink-0" />
                    {!roiEnabled
                      ? "Enable ROI"
                      : roiEditing
                        ? "Done editing"
                        : "Edit ROI"}
                  </button>
                  {roiEnabled ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-error hover:bg-error/10"
                      onClick={() => {
                        setMenuOpen(false);
                        clearRoi();
                      }}
                    >
                      <X className="size-4 shrink-0" />
                      Clear ROI
                    </button>
                  ) : null}

                  <div className="my-1 h-px bg-hairline dark:bg-[var(--border)]" />
                  <p className="px-3 py-1.5 text-xs font-semibold text-muted">
                    ROI presets
                  </p>
                  {ROI_PRESET_ORDER.map((id) => {
                    const selected = roiEnabled && roiPresetId === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-ink hover:bg-surface-soft dark:text-[var(--foreground)] dark:hover:bg-[var(--surface)]",
                          selected && "bg-surface-soft dark:bg-[var(--surface)]",
                        )}
                        onClick={() => {
                          setMenuOpen(false);
                          applyRoiPreset(id);
                        }}
                      >
                        {PRESET_ICONS[id]}
                        {ROI_PRESETS[id].label}
                        {selected ? (
                          <span className="ml-auto text-xs text-muted">
                            Active
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
