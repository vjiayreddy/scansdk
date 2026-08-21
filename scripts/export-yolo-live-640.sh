#!/usr/bin/env bash
# Export a 640×640 ONNX for live camera locate from the 960-trained best.pt.
# Usage: ./scripts/export-yolo-live-640.sh [path/to/best.pt]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEIGHTS="${1:-$ROOT/runs/barcode/yolo11n_960_fresh/weights/best.pt}"
VENV="$ROOT/.venv-yolo"
WORK="$ROOT/runs/barcode/yolo11n_live_640_export"
PUBLIC_MODEL="$ROOT/public/models/barcode-yolo11n-live-640.onnx"

if [[ ! -f "$WEIGHTS" ]]; then
  echo "Weights not found: $WEIGHTS" >&2
  exit 1
fi

if [[ ! -x "$VENV/bin/python" ]]; then
  echo "Missing venv at $VENV — run ./scripts/train-yolo11n.sh first" >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"
python -m pip install -q ultralytics onnx

rm -rf "$WORK"
mkdir -p "$WORK" "$(dirname "$PUBLIC_MODEL")"
cp "$WEIGHTS" "$WORK/best.pt"

echo "Exporting imgsz=640 ONNX from $WORK/best.pt …"
yolo export \
  model="$WORK/best.pt" \
  format=onnx \
  imgsz=640 \
  simplify=True

EXPORTED="$WORK/best.onnx"
if [[ ! -f "$EXPORTED" ]]; then
  echo "Export did not produce $EXPORTED" >&2
  exit 1
fi

python - <<PY
from pathlib import Path
import shutil
import onnx

src = Path("$EXPORTED")
model = onnx.load(str(src))
inp = model.graph.input[0]
dims = [d.dim_value for d in inp.type.tensor_type.shape.dim]
print(f"ONNX input dims: {dims} from {src}")
if dims != [1, 3, 640, 640] and 640 not in dims:
    raise SystemExit(f"Expected 640 input, got {dims}")

dest = Path("$PUBLIC_MODEL")
shutil.copy2(src, dest)
print(f"Copied -> {dest} ({dest.stat().st_size} bytes)")
PY

echo "Done: $PUBLIC_MODEL"
