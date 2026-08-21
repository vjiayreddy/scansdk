# Barcode YOLO11n weights

App loads models from `public/models/`.

| File | Use | Input |
|------|-----|--------|
| `barcode-yolo11n.onnx` | Upload / still scan | `1 × 3 × 960 × 960` |
| `barcode-yolo11n-live.onnx` | Live camera | `1 × 3 × 640 × 640` |

Both are class `0: barcode`. Live is intentionally smaller so phones can locate at usable FPS; upload keeps 960 for dense tiny codes.

## Export upload (960)

```bash
.venv-yolo/bin/yolo export \
  model=runs/barcode/yolo11n_960_fresh/weights/best.pt \
  format=onnx imgsz=960 simplify=True

cp runs/barcode/yolo11n_960_fresh/weights/best.onnx \
  public/models/barcode-yolo11n.onnx
```

## Export live (640)

```bash
.venv-yolo/bin/yolo export \
  model=runs/barcode/yolo11n_live_640_export/best.pt \
  format=onnx imgsz=640 simplify=True

cp runs/barcode/yolo11n_live_640_export/best.onnx \
  public/models/barcode-yolo11n-live.onnx
```

Or run `scripts/export-yolo-live-640.sh` after a 640 export exists under `runs/`.

If the ONNX file is missing, upload scan falls back to the classical proposal pipeline.
