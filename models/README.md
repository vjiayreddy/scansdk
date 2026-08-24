# Barcode YOLO11n weights

App loads **`/models/barcode-yolo11n.onnx`** from `public/models/`.

## Current test branch: 4-class (`test/yolo11n-4class-locate`)

| Item | Value |
|------|--------|
| Checkpoint | `runs/barcode/yolo11n_960_dm_ean_code128_gs1/weights/best.pt` (`best_4class.pt`) |
| Classes | `0: datamatrix`, `1: EAN13`, `2: CODE128`, `3: GS1_128` |
| Input | `1 × 3 × 960 × 960` RGB, letterboxed |
| Output | `1 × 8 × 18900` (`cx, cy, w, h, cls0..cls3`) |
| Conf / NMS | `0.20` / `0.45` |
| Upload locate | Full-frame + overlapping tiles (2×2 normal / 3×3 hard) when long side ≥ 1200 |

Previous single-class DataMatrix ONNX kept as:

- `public/models/barcode-yolo11n.datamatrix-prev.bak.onnx`

## Legacy single-class contract (previous)

| Item | Value |
|------|--------|
| Class | `0: datamatrix` |
| Output | `1 × 5 × 18900` (`cx, cy, w, h, score`) |

`lib/barcode/yolo-core.ts` accepts both `1×5×N` and `1×(4+nc)×N`.

Export from a trained checkpoint:

```bash
.venv-yolo/bin/yolo export \
  model=best.pt \
  format=onnx imgsz=960 simplify=True

cp best.onnx public/models/barcode-yolo11n.onnx
```

If the ONNX file is missing, upload scan falls back to the classical proposal pipeline.
