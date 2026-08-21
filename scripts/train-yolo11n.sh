#!/usr/bin/env bash
# Fresh local YOLO11n barcode locator training (pretrained yolo11n.pt fine-tune).
# Usage: ./scripts/train-yolo11n.sh [path/to/barcode_best_training_images.zip]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZIP="${1:-$HOME/Downloads/barcode_best_training_images.zip}"
DATA_DIR="$ROOT/datasets/barcode_best_training_images"
VENV="$ROOT/.venv-yolo"
PROJECT="$ROOT/runs/barcode"
RUN_NAME="yolo11n_960_fresh"

if [[ ! -f "$ZIP" ]]; then
  echo "Dataset zip not found: $ZIP" >&2
  exit 1
fi

mkdir -p "$DATA_DIR"
if [[ ! -f "$DATA_DIR/data.yaml" ]]; then
  echo "Unpacking dataset..."
  unzip -q -o "$ZIP" -d "$DATA_DIR"
fi

if [[ ! -f "$DATA_DIR/data.yaml" ]]; then
  echo "Expected $DATA_DIR/data.yaml after unzip" >&2
  exit 1
fi

python3 - <<PY
from pathlib import Path
p = Path("$DATA_DIR") / "data.yaml"
text = p.read_text()
lines = []
for line in text.splitlines():
    if line.startswith("path:"):
        lines.append("path: $DATA_DIR")
    else:
        lines.append(line)
p.write_text("\n".join(lines) + "\n")
print("data.yaml path -> $DATA_DIR")
PY

if [[ ! -x "$VENV/bin/python" ]]; then
  echo "Creating venv at $VENV"
  python3 -m venv "$VENV"
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"
python -m pip install -U pip
python -m pip install ultralytics

DEVICE="$(python - <<'PY'
import torch
print("mps" if torch.backends.mps.is_available() else "cpu")
PY
)"
echo "Training device: $DEVICE"

# batch=8 is safer on MacBook Air at imgsz=960 than the default 16.
yolo detect train \
  model=yolo11n.pt \
  data="$DATA_DIR/data.yaml" \
  imgsz=960 \
  epochs=100 \
  batch=8 \
  device="$DEVICE" \
  project="$PROJECT" \
  name="$RUN_NAME" \
  exist_ok=True
