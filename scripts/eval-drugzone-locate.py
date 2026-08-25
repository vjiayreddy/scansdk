#!/usr/bin/env python3
"""Batch YOLO locate eval on VijayTestingSampleDrugzone (no GT).

Mirrors app postprocess: per-class conf, class-aware NMS, strict geometry,
full-frame + 3x3 tiles. Writes overlays + report.json (+ optional REPORT.md).

Usage:
  .venv-yolo/bin/python scripts/eval-drugzone-locate.py
  .venv-yolo/bin/python scripts/eval-drugzone-locate.py --images /path/to/dir
"""

from __future__ import annotations

import argparse
import json
import math
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_IMAGES = Path("/Users/vijay/Desktop/uidevs/VijayTestingSampleDrugzone")
ONNX = ROOT / "public/models/barcode-yolo11n.onnx"
OUT_DIR = ROOT / ".tmp-drugzone-eval"

IMGSZ = 960
CLASS_NAMES = {0: "datamatrix", 1: "CODE128"}
YOLO_CONF = 0.18
YOLO_CONF_BY_CLASS = {0: 0.08, 1: 0.25}
YOLO_IOU = 0.4
YOLO_IOU_BY_CLASS = {0: 0.4, 1: 0.18}
YOLO_TILE_CONF_SCALE = 0.75
YOLO_TILE_MIN_LONG_SIDE = 480
TILE_GRID = 4
TILE_OVERLAP = 0.45

# strict-barcode.ts mirrors (small-DM recall)
MIN_DM_AREA_FRAC = 0.00005
MIN_DM_SIDE_FRAC = 0.004
TINY_DM_AREA_FRAC = 0.00022
TINY_DM_MIN_SCORE = 0.14
MAX_DM_ASPECT = 3.5

VALID_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


@dataclass
class Box:
    x: float
    y: float
    width: float
    height: float
    score: float
    class_id: int
    tags: list[str] = field(default_factory=list)

    @property
    def name(self) -> str:
        return CLASS_NAMES.get(self.class_id, f"class_{self.class_id}")


def letterbox_chw(im: Image.Image) -> tuple[np.ndarray, float, float, float]:
    w, h = im.size
    scale = min(IMGSZ / w, IMGSZ / h)
    nw, nh = int(round(w * scale)), int(round(h * scale))
    pad_x, pad_y = (IMGSZ - nw) / 2.0, (IMGSZ - nh) / 2.0
    canvas = Image.new("RGB", (IMGSZ, IMGSZ), (114, 114, 114))
    canvas.paste(im.resize((nw, nh), Image.BILINEAR), (int(pad_x), int(pad_y)))
    arr = np.asarray(canvas).astype(np.float32) / 255.0
    chw = np.transpose(arr, (2, 0, 1))[None]
    return chw, scale, pad_x, pad_y


def box_iou(a: Box, b: Box) -> float:
    ax2, ay2 = a.x + a.width, a.y + a.height
    bx2, by2 = b.x + b.width, b.y + b.height
    ix = max(0.0, min(ax2, bx2) - max(a.x, b.x))
    iy = max(0.0, min(ay2, by2) - max(a.y, b.y))
    inter = ix * iy
    union = a.width * a.height + b.width * b.height - inter
    return 0.0 if union <= 0 else inter / union


def nms(boxes: list[Box], iou_thresh: float) -> list[Box]:
    ordered = sorted(boxes, key=lambda b: b.score, reverse=True)
    kept: list[Box] = []
    for box in ordered:
        class_iou = YOLO_IOU_BY_CLASS.get(box.class_id, iou_thresh)
        ok = True
        for existing in kept:
            if existing.class_id != box.class_id:
                continue
            thresh = min(class_iou, YOLO_IOU_BY_CLASS.get(existing.class_id, iou_thresh))
            if box_iou(existing, box) >= thresh:
                ok = False
                break
        if ok:
            kept.append(box)
    return kept


def parse_output(
    pred: np.ndarray,
    scale: float,
    pad_x: float,
    pad_y: float,
    canvas_w: int,
    canvas_h: int,
    class_conf_scale: float = 1.0,
) -> list[Box]:
    # pred: (C, N) channel-major
    if pred.ndim == 3:
        pred = pred[0]
    channels, count = int(pred.shape[0]), int(pred.shape[1])
    num_classes = max(1, channels - 4)
    scale_floor = min(1.0, max(0.5, class_conf_scale))
    boxes: list[Box] = []
    for i in range(count):
        cx, cy, w, h = float(pred[0, i]), float(pred[1, i]), float(pred[2, i]), float(pred[3, i])
        if num_classes == 1:
            score, class_id = float(pred[4, i]), 0
        else:
            scores = pred[4 : 4 + num_classes, i]
            class_id = int(scores.argmax())
            score = float(scores[class_id])
        floor = (YOLO_CONF_BY_CLASS.get(class_id, YOLO_CONF)) * scale_floor
        if score < floor:
            continue
        x = (cx - w / 2 - pad_x) / scale
        y = (cy - h / 2 - pad_y) / scale
        mw, mh = w / scale, h / scale
        x = max(0.0, x)
        y = max(0.0, y)
        mw = min(mw, canvas_w - x)
        mh = min(mh, canvas_h - y)
        if mw < 2 or mh < 2:
            continue
        boxes.append(Box(x, y, mw, mh, score, class_id))
    return nms(boxes, YOLO_IOU)


def is_plausible(box: Box, canvas_w: int, canvas_h: int) -> bool:
    area = box.width * box.height
    image_area = max(1, canvas_w * canvas_h)
    frac = area / image_area
    short_side = min(canvas_w, canvas_h)
    min_side = min(box.width, box.height)
    max_side = max(box.width, box.height)
    if frac > 0.12:
        return False
    if box.width < 8 or box.height < 8:
        return False
    ratio = max_side / max(1.0, min_side)
    if box.class_id == 0:
        if ratio > MAX_DM_ASPECT:
            return False
        if frac < MIN_DM_AREA_FRAC:
            return False
        if min_side < short_side * MIN_DM_SIDE_FRAC:
            return False
        if frac < TINY_DM_AREA_FRAC and box.score < TINY_DM_MIN_SCORE:
            return False
        return True
    if box.class_id == 1:
        if ratio < 2.2 or ratio > 18:
            return False
        if frac < 0.00012:
            return False
        if max_side < short_side * 0.04:
            return False
        return True
    return ratio >= 1.4 and ratio <= 10 and frac >= 0.00012


def tag_fp_suspects(boxes: list[Box], canvas_w: int, canvas_h: int) -> list[Box]:
    image_area = max(1, canvas_w * canvas_h)
    short_side = min(canvas_w, canvas_h)
    out: list[Box] = []
    for box in boxes:
        tags: list[str] = []
        frac = (box.width * box.height) / image_area
        ratio = max(box.width, box.height) / max(1.0, min(box.width, box.height))
        min_side = min(box.width, box.height)
        if box.class_id == 0 and frac < TINY_DM_AREA_FRAC:
            tags.append("tiny_dm")
        if box.class_id == 0 and min_side < short_side * 0.015:
            tags.append("small_dm")
        if box.class_id == 1 and ratio < 2.5:
            tags.append("near_square_code128")
        if frac > 0.08:
            tags.append("huge_slab")
        if box.score < 0.2:
            tags.append("low_score")
        # mostly on image edge
        margin = 0.02 * short_side
        if (
            box.x < margin
            or box.y < margin
            or box.x + box.width > canvas_w - margin
            or box.y + box.height > canvas_h - margin
        ) and frac < 0.001:
            tags.append("edge_blob")
        box.tags = tags
        out.append(box)
    return out


def merge_boxes(all_boxes: list[Box]) -> list[Box]:
    return nms(all_boxes, YOLO_IOU)


def run_full_frame(sess: ort.InferenceSession, im: Image.Image) -> list[Box]:
    w, h = im.size
    tensor, scale, pad_x, pad_y = letterbox_chw(im)
    in_name = sess.get_inputs()[0].name
    pred = sess.run(None, {in_name: tensor})[0]
    return parse_output(pred, scale, pad_x, pad_y, w, h, 1.0)


def run_tiles(sess: ort.InferenceSession, im: Image.Image) -> list[Box]:
    w, h = im.size
    if max(w, h) < YOLO_TILE_MIN_LONG_SIDE:
        return []
    grid = TILE_GRID
    overlap = TILE_OVERLAP
    # tile size so consecutive tiles overlap by overlap fraction
    # step = tile * (1 - overlap)
    tile_w = int(math.ceil(w / (grid - (grid - 1) * overlap)))
    tile_h = int(math.ceil(h / (grid - (grid - 1) * overlap)))
    step_x = max(1, int(tile_w * (1 - overlap)))
    step_y = max(1, int(tile_h * (1 - overlap)))
    boxes: list[Box] = []
    in_name = sess.get_inputs()[0].name
    for ty in range(0, max(1, h - tile_h + 1), step_y):
        for tx in range(0, max(1, w - tile_w + 1), step_x):
            tw = min(tile_w, w - tx)
            th = min(tile_h, h - ty)
            crop = im.crop((tx, ty, tx + tw, ty + th))
            tensor, scale, pad_x, pad_y = letterbox_chw(crop)
            pred = sess.run(None, {in_name: tensor})[0]
            local = parse_output(
                pred, scale, pad_x, pad_y, tw, th, YOLO_TILE_CONF_SCALE
            )
            for b in local:
                boxes.append(
                    Box(
                        b.x + tx,
                        b.y + ty,
                        b.width,
                        b.height,
                        b.score,
                        b.class_id,
                    )
                )
        # ensure last column/row covered
    # also cover bottom-right if steps missed edge
    if h > tile_h:
        ty = h - tile_h
        for tx in range(0, max(1, w - tile_w + 1), step_x):
            tw = min(tile_w, w - tx)
            crop = im.crop((tx, ty, tx + tw, ty + tile_h))
            tensor, scale, pad_x, pad_y = letterbox_chw(crop)
            pred = sess.run(None, {in_name: tensor})[0]
            local = parse_output(
                pred, scale, pad_x, pad_y, tw, tile_h, YOLO_TILE_CONF_SCALE
            )
            for b in local:
                boxes.append(
                    Box(b.x + tx, b.y + ty, b.width, b.height, b.score, b.class_id)
                )
    return merge_boxes(boxes)


def draw_overlay(im: Image.Image, boxes: list[Box], path: Path) -> None:
    img = im.copy().convert("RGB")
    # downscale huge images for overlay size
    max_side = 1600
    w, h = img.size
    scale = 1.0
    if max(w, h) > max_side:
        scale = max_side / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.BILINEAR)
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None
    for box in boxes:
        x1 = int(box.x * scale)
        y1 = int(box.y * scale)
        x2 = int((box.x + box.width) * scale)
        y2 = int((box.y + box.height) * scale)
        suspect = bool(box.tags)
        if suspect:
            color = (255, 0, 255)  # magenta FP-suspect
        elif box.class_id == 0:
            color = (0, 220, 255)  # cyan DM
        else:
            color = (255, 140, 0)  # orange CODE128
        draw.rectangle([x1, y1, x2, y2], outline=color, width=3)
        label = f"{box.name} {box.score:.2f}"
        if box.tags:
            label += " [" + ",".join(box.tags[:2]) + "]"
        draw.text((x1 + 2, max(0, y1 - 12)), label, fill=color, font=font)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, quality=85)


def evaluate_image(
    sess: ort.InferenceSession,
    path: Path,
    overlays: Path,
    out_root: Path,
    portrait: bool = False,
) -> dict:
    im = Image.open(path).convert("RGB")
    rotated = False
    if portrait and im.size[0] > im.size[1]:
        # Landscape → portrait (90° CCW) to match phone portrait upload
        im = im.transpose(Image.Transpose.ROTATE_90)
        rotated = True
    w, h = im.size
    full = run_full_frame(sess, im)
    tiled = run_tiles(sess, im)
    merged_raw = merge_boxes(full + tiled)
    after_strict = [b for b in merged_raw if is_plausible(b, w, h)]
    after_strict = tag_fp_suspects(after_strict, w, h)

    by_class_raw = Counter(b.name for b in merged_raw)
    by_class = Counter(b.name for b in after_strict)
    fp_suspect = sum(1 for b in after_strict if b.tags)

    overlay_path = overlays / f"{path.stem}_overlay.jpg"
    draw_overlay(im, after_strict, overlay_path)

    return {
        "file": path.name,
        "width": w,
        "height": h,
        "portrait_rotated": rotated,
        "orientation": "portrait" if h >= w else "landscape",
        "full_frame": len(full),
        "from_tiles": len(tiled),
        "raw_merged": len(merged_raw),
        "after_strict": len(after_strict),
        "by_class_raw": dict(by_class_raw),
        "by_class": dict(by_class),
        "fp_suspect_count": fp_suspect,
        "fp_tag_hist": dict(
            Counter(t for b in after_strict for t in b.tags)
        ),
        "boxes": [
            {
                **{k: v for k, v in asdict(b).items() if k != "class_id"},
                "class_id": b.class_id,
                "class": b.name,
            }
            for b in after_strict
        ],
        "overlay": str(overlay_path.relative_to(out_root)),
    }


def write_report_md(results: list[dict], out: Path, title_suffix: str = "") -> None:
    total_images = len(results)
    total_boxes = sum(r["after_strict"] for r in results)
    total_dm = sum(r["by_class"].get("datamatrix", 0) for r in results)
    total_c128 = sum(r["by_class"].get("CODE128", 0) for r in results)
    total_fp = sum(r["fp_suspect_count"] for r in results)
    dropped = sum(r["raw_merged"] - r["after_strict"] for r in results)
    rotated_n = sum(1 for r in results if r.get("portrait_rotated"))

    worst = sorted(
        results,
        key=lambda r: (r["fp_suspect_count"], -r["after_strict"]),
        reverse=True,
    )[:8]
    sparse = sorted(results, key=lambda r: r["after_strict"])[:8]

    title = "# Drugzone YOLO locate eval" + (f" ({title_suffix})" if title_suffix else "")
    lines = [
        title,
        "",
        f"- Images: **{total_images}** (`VijayTestingSampleDrugzone`)",
        f"- Model: `public/models/barcode-yolo11n.onnx` (2-class DM + CODE128)",
        f"- Postprocess: app conf (DM `{YOLO_CONF_BY_CLASS[0]}`, CODE128 `{YOLO_CONF_BY_CLASS[1]}`), "
        f"tiles ×`{YOLO_TILE_CONF_SCALE}`, strict geometry",
        f"- Portrait mode: rotated landscape→portrait: **{rotated_n}/{total_images}**",
        f"- **No ground truth** — counts are detections, not recall/precision.",
        "",
        "## Totals (after strict filter)",
        "",
        f"| Metric | Value |",
        f"|--------|------:|",
        f"| Boxes kept | {total_boxes} |",
        f"| datamatrix | {total_dm} |",
        f"| CODE128 | {total_c128} |",
        f"| FP-suspect (heuristic tags) | {total_fp} |",
        f"| Dropped by strict (raw−kept) | {dropped} |",
        f"| Mean boxes / image | {total_boxes / max(1, total_images):.1f} |",
        "",
        "## Per-image",
        "",
        "| Image | orient | raw | kept | DM | C128 | FP-suspect |",
        "|-------|--------|----:|-----:|---:|-----:|-----------:|",
    ]
    for r in sorted(results, key=lambda x: x["file"]):
        orient = r.get("orientation", "?")
        if r.get("portrait_rotated"):
            orient += "*"
        lines.append(
            f"| `{r['file']}` | {orient} | {r['raw_merged']} | {r['after_strict']} | "
            f"{r['by_class'].get('datamatrix', 0)} | {r['by_class'].get('CODE128', 0)} | "
            f"{r['fp_suspect_count']} |"
        )

    lines += [
        "",
        "## Highest FP-suspect images",
        "",
    ]
    for r in worst:
        tags = r.get("fp_tag_hist") or {}
        lines.append(
            f"- `{r['file']}`: kept={r['after_strict']}, fp_suspect={r['fp_suspect_count']}, tags={tags}"
        )

    lines += [
        "",
        "## Sparse detections (possible misses / hard scenes)",
        "",
    ]
    for r in sparse:
        lines.append(
            f"- `{r['file']}`: kept={r['after_strict']} "
            f"(DM={r['by_class'].get('datamatrix', 0)}, "
            f"C128={r['by_class'].get('CODE128', 0)})"
        )

    lines += [
        "",
        "## Why blind spots (false positives)?",
        "",
        "1. **Domain gap:** Fine-tune data (barcodesai) is mostly flat multi-code collages. "
        "Drugzone scenes have LUPIN tape logos, bin rims, beams, packing texture that look "
        "barcode-like at mid confidence.",
        "2. **Heuristic tags** (`tiny_dm`, `edge_blob`, `near_square_code128`, `low_score`) "
        "flag likely FPs in overlays (magenta). Strict filters remove many but not all.",
        "3. **Tiles** improve small-code recall but also re-fire on logo squares / grain.",
        "4. **Portrait rotation** changes letterbox aspect vs native landscape training photos — "
        "compare totals to the landscape run.",
        "",
        "## Why not ~99% DM + CODE128 locate?",
        "",
        "1. **No GT here** — we cannot claim 99% recall; sparse images + visual overlay review "
        "show misses on far/small codes and side-angle DataMatrix.",
        "2. **Train distribution** lacks warehouse perspective, glare, stacked GS1 dual bars.",
        "3. **App tradeoff:** CODE128 conf `0.25` + aspect ≥2.2 cuts rim FPs but also weak true bars; "
        "DM conf `0.12` + tiny-score gate cut tape logos but suppress marginal DMs.",
        "4. **Side-angle DM** still under-detected (axis-aligned YOLO + limited skewed examples).",
        "",
        "## Recommended next fix",
        "",
        "1. Label 40–80 Drugzone fails (tight DM + each CODE128; empty labels on tape-only crops).",
        "2. Short Kaggle fine-tune from current `best.pt` (30–50 epochs) + these images.",
        "3. Re-run this script; compare FP-suspect rate and sparse-image box counts.",
        "",
        "## Artifacts",
        "",
        "- Overlays: `overlays/*_overlay.jpg` (cyan=DM, orange=CODE128, magenta=FP-suspect)",
        "- Machine JSON: `report.json`",
        "- `orient*` = landscape rotated 90° CCW to portrait for this run",
        "",
    ]
    out.write_text("\n".join(lines) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", type=Path, default=DEFAULT_IMAGES)
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    ap.add_argument("--onnx", type=Path, default=ONNX)
    ap.add_argument(
        "--portrait",
        action="store_true",
        help="Rotate landscape images 90° CCW so height>=width before locate",
    )
    args = ap.parse_args()

    out_dir: Path = args.out
    if args.portrait and out_dir == OUT_DIR:
        out_dir = ROOT / ".tmp-drugzone-eval-portrait"

    if not args.onnx.is_file():
        print(f"Missing ONNX: {args.onnx}")
        return 1
    if not args.images.is_dir():
        print(f"Missing images dir: {args.images}")
        return 1

    paths = sorted(
        p
        for p in args.images.iterdir()
        if p.is_file() and p.suffix.lower() in VALID_EXT
    )
    if not paths:
        print("No images found")
        return 1

    out_dir.mkdir(parents=True, exist_ok=True)
    overlays = out_dir / "overlays"
    overlays.mkdir(exist_ok=True)

    print(f"ONNX: {args.onnx}")
    print(f"Images: {len(paths)} from {args.images}")
    print(f"Portrait mode: {args.portrait}")
    print(f"Out: {out_dir}")
    sess = ort.InferenceSession(str(args.onnx), providers=["CPUExecutionProvider"])
    print("OUT shape:", sess.get_outputs()[0].shape)

    results: list[dict] = []
    for i, path in enumerate(paths, 1):
        print(f"[{i}/{len(paths)}] {path.name} …", flush=True)
        results.append(
            evaluate_image(sess, path, overlays, out_dir, portrait=args.portrait)
        )
        r = results[-1]
        print(
            f"    {r['width']}x{r['height']} {r['orientation']}"
            f"{' (rotated)' if r.get('portrait_rotated') else ''} "
            f"raw={r['raw_merged']} kept={r['after_strict']} "
            f"DM={r['by_class'].get('datamatrix', 0)} "
            f"C128={r['by_class'].get('CODE128', 0)} "
            f"fp_suspect={r['fp_suspect_count']}"
        )

    report = {
        "images_dir": str(args.images),
        "onnx": str(args.onnx),
        "imgsz": IMGSZ,
        "portrait": args.portrait,
        "conf_by_class": YOLO_CONF_BY_CLASS,
        "tile_conf_scale": YOLO_TILE_CONF_SCALE,
        "results": results,
    }
    (out_dir / "report.json").write_text(json.dumps(report, indent=2))
    write_report_md(
        results,
        out_dir / "REPORT.md",
        title_suffix="portrait mode" if args.portrait else "",
    )
    print(f"\nWrote {out_dir / 'report.json'}")
    print(f"Wrote {out_dir / 'REPORT.md'}")
    print(f"Overlays: {overlays}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
