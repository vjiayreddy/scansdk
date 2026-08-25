# Barcode YOLO11n weights

App loads **`/models/barcode-yolo11n.onnx`** from `public/models/`.

## Current: 2-class (`datamatrix` + `CODE128`)

| Item | Value |
|------|--------|
| Checkpoint | `runs/barcode/yolo11n_960_dm_code128_v1/weights/best.pt` |
| ONNX | `public/models/barcode-yolo11n.onnx` |
| Classes | `0: datamatrix`, `1: CODE128` |
| Output | `1 × 6 × 18900` |
| Train source | barcodesai Barcodes (2-class filter) fine-tune — Aug 2026 |
| Conf / NMS | DM `0.08` / CODE128 `0.25` (tiles ×0.75) / IoU DM `0.40` · CODE128 `0.18` |
| Strict mode | DM aspect ≤3.5; small-DM side ≥0.4% short side; tiny score floor `0.14` |
| Upload tiles | 4×4 normal / 5×5 hard, overlap **0.45**, long side ≥ **480** |
| UI class filter | Both / DataMatrix / Code128 (YOLO keeps selected classes only) |

### Improve accuracy (retrain)

**Preferred (barcodesai):** Kaggle notebook  
`notebooks/train_yolo11n_2class_barcodesai_kaggle.ipynb`

Upload a Kaggle Dataset with:
- `Barcodes.v1i.yolov11.zip` (DATAMATRIX + CODE128 filtered in-notebook)
- `best.pt` from `runs/barcode/yolo11n_960_dm_code128_v1/weights/best.pt`
- optional: `barcode_best_training_images.zip`, `barcode_dataset_merged.zip`

Older merge-only path: `notebooks/train_yolo11n_2class_dm_code128_kaggle.ipynb`  
(+ local `python3 scripts/build-combined-2class-dataset.py`).

Also add **your warehouse photos** with tight boxes on small DM + each 1D bar.

### Upload pipeline

1. YOLO locate (tiled) → boxes + class  
2. Crop decode: native BarcodeDetector (Chrome) then zxing-wasm with `Code128` + `DataMatrix`  
3. Vertical CODE128 gets extra pad + `tryRotate`
