#!/usr/bin/env python3
"""Build local combined 2-class YOLO dataset (datamatrix + CODE128).

Source barcode merge: 0=EAN13 (drop), 1=CODE128, 2=GS1_128.
Target class 1 keeps CODE128 + GS1 (Code128-family for locate/decode).

Usage:
  python3 scripts/build-combined-2class-dataset.py
"""

from __future__ import annotations

import argparse
import shutil
import zipfile
from collections import Counter
from pathlib import Path

VALID_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def unwrap_if_nested(root: Path) -> Path:
    if (root / "images").exists():
        return root
    nested = list(root.rglob("images/train"))
    if nested:
        return nested[0].parent.parent
    for p in root.rglob("images"):
        if (p / "train").exists():
            return p.parent
    return root


def stage_source(src: Path, work: Path) -> Path:
    if src.is_dir():
        return unwrap_if_nested(src)
    if src.suffix.lower() == ".zip":
        dest = work / src.stem
        if dest.exists():
            shutil.rmtree(dest)
        dest.mkdir(parents=True)
        with zipfile.ZipFile(src, "r") as zf:
            zf.extractall(dest)
        return unwrap_if_nested(dest)
    raise SystemExit(f"Expected folder or zip: {src}")


def remap_label_lines(src_lbl: Path, class_map: dict[int, int]) -> list[str]:
    out_lines: list[str] = []
    if not src_lbl.exists():
        return out_lines
    for line in src_lbl.read_text().strip().splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        src_cid = int(float(parts[0]))
        if src_cid not in class_map:
            continue
        out_lines.append(" ".join([str(class_map[src_cid])] + parts[1:]))
    return out_lines


def copy_pair(
    src_img: Path,
    src_lbl: Path,
    dst_img_dir: Path,
    dst_lbl_dir: Path,
    class_map: dict[int, int],
    out_stem: str,
) -> bool:
    if not src_img.exists():
        return False
    out_lines = remap_label_lines(src_lbl, class_map)
    if not out_lines:
        return False
    dst_img = dst_img_dir / f"{out_stem}{src_img.suffix.lower()}"
    dst_lbl = dst_lbl_dir / f"{out_stem}.txt"
    shutil.copy2(src_img, dst_img)
    dst_lbl.write_text("\n".join(out_lines) + "\n")
    return True


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--dm",
        type=Path,
        default=root / "datasets/barcode_best_training_images",
    )
    ap.add_argument(
        "--bc",
        type=Path,
        default=Path.home() / "Downloads/barcode_dataset_merged.zip",
    )
    ap.add_argument(
        "--out",
        type=Path,
        default=root / "datasets/combined_2class_dm_code128",
    )
    args = ap.parse_args()

    work = root / ".tmp-2class-build"
    work.mkdir(exist_ok=True)

    dm_root = stage_source(args.dm, work / "dm")
    bc_root = stage_source(args.bc, work / "bc")
    print("DM:", dm_root)
    print("BC:", bc_root)

    out: Path = args.out
    if out.exists():
        shutil.rmtree(out)
    for split in ("train", "val", "test"):
        (out / "images" / split).mkdir(parents=True)
        (out / "labels" / split).mkdir(parents=True)

    dm_map = {i: 0 for i in range(32)}
    bc_map = {1: 1, 2: 1}  # CODE128 + GS1; drop EAN13

    for split in ("train", "val", "test"):
        dm_img_dir = dm_root / "images" / split
        if dm_img_dir.exists():
            for img in sorted(dm_img_dir.glob("*")):
                if img.suffix.lower() not in VALID_EXT:
                    continue
                copy_pair(
                    img,
                    dm_root / "labels" / split / f"{img.stem}.txt",
                    out / "images" / split,
                    out / "labels" / split,
                    dm_map,
                    f"dm_{img.stem}",
                )
        bc_img_dir = bc_root / "images" / split
        if not bc_img_dir.exists():
            continue
        for img in sorted(bc_img_dir.glob("*")):
            if img.suffix.lower() not in VALID_EXT:
                continue
            copy_pair(
                img,
                bc_root / "labels" / split / f"{img.stem}.txt",
                out / "images" / split,
                out / "labels" / split,
                bc_map,
                f"bc_{img.stem}",
            )

    box_counts: Counter[int] = Counter()
    img_counts: dict[str, int] = {}
    for split in ("train", "val", "test"):
        imgs = [
            p
            for p in (out / "images" / split).iterdir()
            if p.suffix.lower() in VALID_EXT
        ]
        img_counts[split] = len(imgs)
        for lf in (out / "labels" / split).glob("*.txt"):
            for line in lf.read_text().strip().splitlines():
                if line.strip():
                    box_counts[int(float(line.split()[0]))] += 1

    (out / "data.yaml").write_text(
        f"""path: {out.resolve()}
train: images/train
val: images/val
test: images/test
nc: 2
names:
  0: datamatrix
  1: CODE128
"""
    )
    print("Wrote", out)
    print("Image counts:", img_counts)
    print("Box counts:", dict(sorted(box_counts.items())))
    print("Classes: 0=datamatrix, 1=CODE128 (includes remapped GS1_128)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
