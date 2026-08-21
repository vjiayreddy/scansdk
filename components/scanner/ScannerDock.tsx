import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type ScannerDockProps = {
  className?: string;
  children?: ReactNode;
};

/** Bottom overlay for locate status strip — no primary Start control. */
export function ScannerDock({ className, children }: ScannerDockProps) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 z-30 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-16",
        className,
      )}
    >
      <div className="pointer-events-auto mx-auto flex max-w-md flex-col gap-2">
        {children}
      </div>
    </div>
  );
}
