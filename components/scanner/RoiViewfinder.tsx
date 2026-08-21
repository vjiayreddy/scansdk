"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  moveRoi,
  resizeRoi,
  type NormalizedRoi,
  type ResizeHandle,
} from "@/lib/roi";
import { cn } from "@/lib/utils";

type RoiViewfinderProps = {
  roi: NormalizedRoi;
  onChange: (roi: NormalizedRoi) => void;
  editing: boolean;
  flash?: boolean;
  className?: string;
};

type DragMode =
  | { type: "move"; startX: number; startY: number; origin: NormalizedRoi }
  | {
      type: "resize";
      handle: ResizeHandle;
      startX: number;
      startY: number;
      origin: NormalizedRoi;
    };

function applyFrameStyle(el: HTMLDivElement | null, next: NormalizedRoi) {
  if (!el) {
    return;
  }
  el.style.left = `${next.x * 100}%`;
  el.style.top = `${next.y * 100}%`;
  el.style.width = `${next.width * 100}%`;
  el.style.height = `${next.height * 100}%`;
}

/**
 * Smooth ROI drag: paint the frame via DOM during pointer move (no React
 * layout thrash), commit parent state on rAF / pointer up.
 * Move/up listeners attach to the window while dragging so mobile capture
 * works even though the stage wrapper is pointer-events-none.
 */
export function RoiViewfinder({
  roi,
  onChange,
  editing,
  flash,
  className,
}: RoiViewfinderProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragMode | null>(null);
  const stageSizeRef = useRef({ width: 1, height: 1 });
  const liveRoiRef = useRef<NormalizedRoi>(roi);
  const rafCommitRef = useRef(0);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (draggingRef.current) {
      return;
    }
    liveRoiRef.current = roi;
    applyFrameStyle(frameRef.current, roi);
  }, [roi]);

  useEffect(() => {
    applyFrameStyle(frameRef.current, liveRoiRef.current);
  }, []);

  const cacheStageSize = () => {
    const el = stageRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    stageSizeRef.current = {
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    };
  };

  const scheduleParentCommit = useCallback(
    (immediate = false) => {
      if (immediate) {
        if (rafCommitRef.current) {
          cancelAnimationFrame(rafCommitRef.current);
          rafCommitRef.current = 0;
        }
        onChange(liveRoiRef.current);
        return;
      }
      if (rafCommitRef.current) {
        return;
      }
      rafCommitRef.current = requestAnimationFrame(() => {
        rafCommitRef.current = 0;
        onChange(liveRoiRef.current);
      });
    },
    [onChange],
  );

  const endDrag = useCallback(() => {
    if (!dragRef.current) {
      return;
    }
    dragRef.current = null;
    draggingRef.current = false;
    setDragging(false);
    scheduleParentCommit(true);
  }, [scheduleParentCommit]);

  const onWindowPointerMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      const { width, height } = stageSizeRef.current;
      const dx = (e.clientX - drag.startX) / width;
      const dy = (e.clientY - drag.startY) / height;
      const next =
        drag.type === "move"
          ? moveRoi(drag.origin, dx, dy)
          : resizeRoi(drag.origin, drag.handle, dx, dy);
      liveRoiRef.current = next;
      applyFrameStyle(frameRef.current, next);
      scheduleParentCommit(false);
    },
    [scheduleParentCommit],
  );

  useEffect(() => {
    if (!dragging) {
      return;
    }
    const onUp = () => endDrag();
    window.addEventListener("pointermove", onWindowPointerMove, {
      passive: true,
    });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, endDrag, onWindowPointerMove]);

  // Leave edit mode: cancel any in-flight drag.
  useEffect(() => {
    if (!editing && dragRef.current) {
      endDrag();
    }
  }, [editing, endDrag]);

  const onPointerDownMove = (e: ReactPointerEvent) => {
    if (!editing) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    cacheStageSize();
    draggingRef.current = true;
    setDragging(true);
    dragRef.current = {
      type: "move",
      startX: e.clientX,
      startY: e.clientY,
      origin: { ...liveRoiRef.current },
    };
  };

  const onPointerDownResize =
    (handle: ResizeHandle) => (e: ReactPointerEvent) => {
      if (!editing) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      cacheStageSize();
      draggingRef.current = true;
      setDragging(true);
      dragRef.current = {
        type: "resize",
        handle,
        startX: e.clientX,
        startY: e.clientY,
        origin: { ...liveRoiRef.current },
      };
    };

  return (
    <div
      ref={stageRef}
      className={cn(
        "pointer-events-none absolute inset-0",
        editing ? "z-[25]" : "z-10",
        className,
      )}
    >
      <div
        ref={frameRef}
        className={cn(
          "absolute rounded-2xl border-[2.5px] will-change-[left,top,width,height]",
          flash
            ? "border-success bg-success/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.38)]"
            : editing
              ? "border-brand-pink shadow-[0_0_0_9999px_rgba(0,0,0,0.32)]"
              : "border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,0.32)]",
          !dragging && "transition-colors duration-200",
          editing && "pointer-events-auto cursor-move touch-none",
        )}
        onPointerDown={onPointerDownMove}
      >
        <span className="pointer-events-none absolute -left-0.5 -top-0.5 size-7 rounded-tl-2xl border-l-[3.5px] border-t-[3.5px] border-canvas" />
        <span className="pointer-events-none absolute -right-0.5 -top-0.5 size-7 rounded-tr-2xl border-r-[3.5px] border-t-[3.5px] border-canvas" />
        <span className="pointer-events-none absolute -bottom-0.5 -left-0.5 size-7 rounded-bl-2xl border-b-[3.5px] border-l-[3.5px] border-canvas" />
        <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 size-7 rounded-br-2xl border-b-[3.5px] border-r-[3.5px] border-canvas" />
        <div className="pointer-events-none absolute inset-x-8 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-white/70 to-transparent" />

        {editing ? (
          <span className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-brand-pink px-2.5 py-0.5 text-[10px] font-semibold text-white shadow-sm">
            Drag to move · corners to resize
          </span>
        ) : null}

        {editing
          ? (["nw", "ne", "sw", "se"] as ResizeHandle[]).map((handle) => (
              <button
                key={handle}
                type="button"
                aria-label={`Resize ${handle}`}
                className={cn(
                  "pointer-events-auto absolute z-10 flex size-11 touch-none items-center justify-center",
                  handle === "nw" && "-left-5 -top-5 cursor-nwse-resize",
                  handle === "ne" && "-right-5 -top-5 cursor-nesw-resize",
                  handle === "sw" && "-bottom-5 -left-5 cursor-nesw-resize",
                  handle === "se" && "-bottom-5 -right-5 cursor-nwse-resize",
                )}
                onPointerDown={onPointerDownResize(handle)}
              >
                <span className="size-4 rounded-sm border-2 border-ink bg-canvas shadow-sm" />
              </button>
            ))
          : null}
      </div>
    </div>
  );
}
