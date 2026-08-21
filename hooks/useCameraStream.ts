"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type FacingMode = "environment" | "user";

interface UseCameraStreamResult {
  videoRef: RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  error: string | null;
  ready: boolean;
  facingMode: FacingMode;
  start: (facing?: FacingMode) => Promise<void>;
  stop: () => void;
  flipFacing: () => Promise<void>;
}

function stopTracks(stream: MediaStream | null) {
  if (!stream) {
    return;
  }
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function cameraErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      return "Camera permission denied. Allow camera access and try again.";
    }
    if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      return "No camera found on this device.";
    }
    if (err.name === "NotReadableError" || err.name === "TrackStartError") {
      return "Camera is already in use by another app.";
    }
    if (err.name === "SecurityError") {
      return "Camera requires HTTPS or localhost.";
    }
  }
  return err instanceof Error ? err.message : "Failed to open camera";
}

export function useCameraStream(): UseCameraStreamResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [facingMode, setFacingMode] = useState<FacingMode>("environment");

  const stop = useCallback(() => {
    stopTracks(streamRef.current);
    streamRef.current = null;
    setStream(null);
    setReady(false);
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }
  }, []);

  const start = useCallback(
    async (facing: FacingMode = facingMode) => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setError("Camera API is not available in this browser.");
        return;
      }

      setError(null);
      setReady(false);
      stopTracks(streamRef.current);
      streamRef.current = null;

      try {
        const next = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        streamRef.current = next;
        setStream(next);
        setFacingMode(facing);

        const video = videoRef.current;
        if (video) {
          video.srcObject = next;
          await video.play().catch(() => {
            /* autoplay may reject until user gesture; srcObject is still set */
          });
        }

        setReady(true);
      } catch (err: unknown) {
        stopTracks(streamRef.current);
        streamRef.current = null;
        setStream(null);
        setReady(false);
        setError(cameraErrorMessage(err));
      }
    },
    [facingMode],
  );

  const flipFacing = useCallback(async () => {
    const next: FacingMode = facingMode === "environment" ? "user" : "environment";
    await start(next);
  }, [facingMode, start]);

  useEffect(() => {
    return () => {
      stopTracks(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  return {
    videoRef,
    stream,
    error,
    ready,
    facingMode,
    start,
    stop,
    flipFacing,
  };
}
