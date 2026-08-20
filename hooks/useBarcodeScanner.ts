"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  prewarmBarcodeDetector,
  scanImage,
} from "@/lib/barcode/detector";
import type { ScanResult, ScannerStatus } from "@/lib/barcode/types";

interface UseBarcodeScannerResult {
  status: ScannerStatus;
  results: ScanResult | null;
  error: string | null;
  scan: (file: File) => Promise<ScanResult | null>;
  reset: () => void;
  isReady: boolean;
}

export function useBarcodeScanner(): UseBarcodeScannerResult {
  const [status, setStatus] = useState<ScannerStatus>("loading-wasm");
  const [results, setResults] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const scanIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    prewarmBarcodeDetector()
      .then(() => {
        if (!cancelled) {
          setIsReady(true);
          setStatus("idle");
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to initialize scanner",
          );
          setStatus("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const reset = useCallback(() => {
    scanIdRef.current += 1;
    setResults(null);
    setError(null);
    setStatus(isReady ? "idle" : "loading-wasm");
  }, [isReady]);

  const scan = useCallback(
    async (file: File): Promise<ScanResult | null> => {
      const scanId = ++scanIdRef.current;
      setError(null);
      setResults(null);
      setStatus(isReady ? "scanning" : "loading-wasm");

      try {
        const result = await scanImage(file);

        if (scanId !== scanIdRef.current) {
          return null;
        }

        setResults(result);
        setStatus("done");
        return result;
      } catch (err: unknown) {
        if (scanId !== scanIdRef.current) {
          return null;
        }

        const message =
          err instanceof Error ? err.message : "Barcode scan failed";
        setError(message);
        setStatus("error");
        return null;
      }
    },
    [isReady],
  );

  return {
    status,
    results,
    error,
    scan,
    reset,
    isReady,
  };
}
