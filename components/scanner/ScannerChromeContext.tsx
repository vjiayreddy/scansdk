"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_ROI_PRESET,
  type RoiPresetId,
} from "@/lib/roi";

export type FacingMode = "environment" | "user";

type LiveControls = {
  onStart: () => void;
  onStop: () => void;
  onToggleFacing: () => void;
};

type RoiControls = {
  onApplyPreset: (id: RoiPresetId) => void;
  onClear: () => void;
};

type ScannerChromeState = {
  running: boolean;
  facing: FacingMode;
  roiEditing: boolean;
  roiEnabled: boolean;
  roiPresetId: RoiPresetId | null;
  setRunning: (running: boolean) => void;
  setFacing: (facing: FacingMode) => void;
  setRoiEditing: (editing: boolean) => void;
  setRoiEnabled: (enabled: boolean) => void;
  setRoiPresetId: (id: RoiPresetId | null) => void;
  applyRoiPreset: (id: RoiPresetId) => void;
  toggleRoiEditing: () => void;
  clearRoi: () => void;
  start: () => void;
  stop: () => void;
  toggleFacing: () => void;
  registerLiveControls: (controls: LiveControls | null) => void;
  registerRoiControls: (controls: RoiControls | null) => void;
};

const ScannerChromeContext = createContext<ScannerChromeState | null>(null);

export function ScannerChromeProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState(false);
  const [facing, setFacing] = useState<FacingMode>("environment");
  const [roiEditing, setRoiEditing] = useState(false);
  const [roiEnabled, setRoiEnabled] = useState(true);
  const [roiPresetId, setRoiPresetId] = useState<RoiPresetId | null>(
    DEFAULT_ROI_PRESET,
  );
  const controlsRef = useRef<LiveControls | null>(null);
  const roiControlsRef = useRef<RoiControls | null>(null);

  const registerLiveControls = useCallback((controls: LiveControls | null) => {
    controlsRef.current = controls;
    if (!controls) {
      // Only mark camera chrome as stopped. Do NOT reset ROI here —
      // LiveScanPage re-registers controls when callbacks change (every
      // locate tick), and resetting was undoing Edit ROI / Clear ROI.
      setRunning(false);
    }
  }, []);

  const registerRoiControls = useCallback((controls: RoiControls | null) => {
    roiControlsRef.current = controls;
  }, []);

  const applyRoiPreset = useCallback((id: RoiPresetId) => {
    setRoiEnabled(true);
    setRoiEditing(true);
    setRoiPresetId(id);
    roiControlsRef.current?.onApplyPreset(id);
  }, []);

  const toggleRoiEditing = useCallback(() => {
    setRoiEnabled((enabled) => {
      if (!enabled) {
        setRoiEditing(true);
        return true;
      }
      setRoiEditing((editing) => !editing);
      return true;
    });
  }, []);

  const clearRoi = useCallback(() => {
    setRoiEditing(false);
    setRoiEnabled(false);
    setRoiPresetId(null);
    roiControlsRef.current?.onClear();
  }, []);

  const start = useCallback(() => {
    controlsRef.current?.onStart();
  }, []);

  const stop = useCallback(() => {
    controlsRef.current?.onStop();
  }, []);

  const toggleFacing = useCallback(() => {
    controlsRef.current?.onToggleFacing();
  }, []);

  const value = useMemo(
    () => ({
      running,
      facing,
      roiEditing,
      roiEnabled,
      roiPresetId,
      setRunning,
      setFacing,
      setRoiEditing,
      setRoiEnabled,
      setRoiPresetId,
      applyRoiPreset,
      toggleRoiEditing,
      clearRoi,
      start,
      stop,
      toggleFacing,
      registerLiveControls,
      registerRoiControls,
    }),
    [
      running,
      facing,
      roiEditing,
      roiEnabled,
      roiPresetId,
      applyRoiPreset,
      toggleRoiEditing,
      clearRoi,
      start,
      stop,
      toggleFacing,
      registerLiveControls,
      registerRoiControls,
    ],
  );

  return (
    <ScannerChromeContext.Provider value={value}>
      {children}
    </ScannerChromeContext.Provider>
  );
}

export function useScannerChrome() {
  const ctx = useContext(ScannerChromeContext);
  if (!ctx) {
    throw new Error("useScannerChrome must be used within ScannerChromeProvider");
  }
  return ctx;
}
