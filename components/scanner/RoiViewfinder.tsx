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

  const onPointerDownMove = (e: ReactPointerEvent) => {
    if (!editing) {
      return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
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
      e.currentTarget.setPointerCapture(e.pointerId);
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

  const onPointerMove = (e: ReactPointerEvent) => {
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
  };

  const endDrag = () => {
    if (!dragRef.current) {
      return;
    }
    dragRef.current = null;
    draggingRef.current = false;
    setDragging(false);
    scheduleParentCommit(true);
  };

  return (
    <div
      ref={stageRef}
      className={cn("pointer-events-none absolute inset-0 z-10", className)}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        ref={frameRef}
        className={cn(
          "absolute rounded-2xl border-[2.5px] will-change-[left,top,width,height]",
          flash
            ? "border-success bg-success/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.38)]"
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

        {editing
          ? (["nw", "ne", "sw", "se"] as ResizeHandle[]).map((handle) => (
              <button
                key={handle}
                type="button"
                aria-label={`Resize ${handle}`}
                className={cn(
                  "pointer-events-auto absolute size-4 touch-none rounded-sm border-2 border-ink bg-canvas shadow-none",
                  handle === "nw" && "-left-2 -top-2 cursor-nwse-resize",
                  handle === "ne" && "-right-2 -top-2 cursor-nesw-resize",
                  handle === "sw" && "-bottom-2 -left-2 cursor-nesw-resize",
                  handle === "se" && "-bottom-2 -right-2 cursor-nwse-resize",
                )}
                onPointerDown={onPointerDownResize(handle)}
              />
            ))
          : null}
      </div>
    </div>
  );
}
