#!/usr/bin/env python3
"""Probe YOLO ONNX: max score + raw count per class (pre-NMS).

Works for 1-class (5ch), 2-class (6ch), or 4-class (8ch) Ultralytics detect exports.

Usage:
  python3 scripts/probe-yolo-classes.py [image ...]
  python3 scripts/probe-yolo-classes.py  # defaults to test-fixtures/pharma-*.png
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ONNX = ROOT / "public/models/barcode-yolo11n.onnx"
DEFAULT_NAMES = {
    2: {0: "datamatrix", 1: "CODE128"},
    4: {0: "datamatrix", 1: "EAN13", 2: "CODE128", 3: "GS1_128"},
    1: {0: "barcode"},
}
IMGSZ = 960
CONF_SWEEP = (0.2, 0.15, 0.1, 0.05, 0.01)


def letterbox_chw(path: Path) -> np.ndarray:
    im = Image.open(path).convert("RGB")
    w, h = im.size
    scale = min(IMGSZ / w, IMGSZ / h)
    nw, nh = int(round(w * scale)), int(round(h * scale))
    pad_x, pad_y = (IMGSZ - nw) / 2, (IMGSZ - nh) / 2
    canvas = Image.new("RGB", (IMGSZ, IMGSZ), (114, 114, 114))
    canvas.paste(im.resize((nw, nh), Image.BILINEAR), (int(pad_x), int(pad_y)))
    arr = np.asarray(canvas).astype(np.float32) / 255.0
    return np.transpose(arr, (2, 0, 1))[None]


def main() -> int:
    paths = [Path(p) for p in sys.argv[1:]]
    if not paths:
        paths = sorted((ROOT / "test-fixtures").glob("pharma*.png"))
    if not paths:
        print("No images", file=sys.stderr)
        return 1
    if not ONNX.is_file():
        print(f"Missing {ONNX}", file=sys.stderr)
        return 1

    sess = ort.InferenceSession(str(ONNX), providers=["CPUExecutionProvider"])
    in_name = sess.get_inputs()[0].name
    out_shape = sess.get_outputs()[0].shape
    print("ONNX out shape:", out_shape)

    for path in paths:
        pred = sess.run(None, {in_name: letterbox_chw(path)})[0][0]
        channels = int(pred.shape[0])
        num_classes = max(1, channels - 4)
        names = DEFAULT_NAMES.get(num_classes) or {
            c: f"class_{c}" for c in range(num_classes)
        }
        scores = pred[4 : 4 + num_classes]
        print(f"\n{path}  (nc={num_classes})")
        for c in range(num_classes):
            print(f"  max {names[c]:12s} {float(scores[c].max()):.4f}")
        cls = scores.argmax(axis=0)
        best = scores.max(axis=0)
        for conf in CONF_SWEEP:
            keep = best >= conf
            hist = {names[c]: int(((cls == c) & keep).sum()) for c in range(num_classes)}
            print(f"  pre-NMS conf>={conf}: {hist} total={int(keep.sum())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
