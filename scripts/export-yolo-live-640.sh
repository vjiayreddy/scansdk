#!/usr/bin/env bash
# Copy / refresh the live 640 ONNX into public/models.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$ROOT/runs/barcode/yolo11n_live_640_export/best.onnx}"
DST="$ROOT/public/models/barcode-yolo11n-live.onnx"

if [[ ! -f "$SRC" ]]; then
  echo "Missing live ONNX: $SRC" >&2
  echo "Export first: yolo export model=.../best.pt format=onnx imgsz=640 simplify=True" >&2
  exit 1
fi

mkdir -p "$(dirname "$DST")"
cp "$SRC" "$DST"
echo "Installed live model → $DST ($(du -h "$DST" | awk '{print $1}'))"
