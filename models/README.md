# Barcode YOLO11n weights

App loads **`/models/barcode-yolo11n.onnx`** from `public/models/`.

| Item | Value |
|------|--------|
| Class | `0: datamatrix` |
| Input | `1 × 3 × 960 × 960` RGB, letterboxed |
| Output | `1 × 5 × 18900` (`cx, cy, w, h, score`) |
| Conf / NMS | `0.20` / `0.45` |
| Upload locate | Full-frame + overlapping tiles (2×2 normal / 3×3 hard) when long side ≥ 1200 |

Export from a trained checkpoint:

```bash
.venv-yolo/bin/yolo export \
  model=best.pt \
  format=onnx imgsz=960 simplify=True

cp best.onnx public/models/barcode-yolo11n.onnx
```

If the ONNX file is missing, upload scan falls back to the classical proposal pipeline.
