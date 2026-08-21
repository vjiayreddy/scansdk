# Barcode YOLO11n weights

App loads **`/models/barcode-yolo11n.onnx`** from `public/models/`.

| Item | Value |
|------|--------|
| Class | `0: barcode` |
| Input | `1 × 3 × 960 × 960` RGB, letterboxed |
| Output | `1 × 5 × 18900` (`cx, cy, w, h, score`) |
| Conf / NMS | `0.25` / `0.45` |

Export from a trained checkpoint:

```bash
.venv-yolo/bin/yolo export \
  model=runs/barcode/yolo11n_960_fresh/weights/best.pt \
  format=onnx imgsz=960 simplify=True

cp runs/barcode/yolo11n_960_fresh/weights/best.onnx \
  public/models/barcode-yolo11n.onnx
```

If the ONNX file is missing, upload scan falls back to the classical proposal pipeline.
