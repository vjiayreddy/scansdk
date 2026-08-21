"use client";

import type { ReactNode } from "react";

import { AppTopbar } from "@/components/scanner/AppTopbar";
import { ScannerChromeProvider } from "@/components/scanner/ScannerChromeContext";

export function ScannerShell({ children }: { children: ReactNode }) {
  return (
    <ScannerChromeProvider>
      <div className="flex h-dvh flex-col overflow-hidden bg-canvas dark:bg-[var(--background)]">
        <AppTopbar />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </div>
    </ScannerChromeProvider>
  );
}
