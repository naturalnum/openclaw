#!/usr/bin/env python3
"""Replace slide-level static images with a generic placeholder image.

This preserves slide masters/layout backgrounds and only rewrites image
relationships that live under ``ppt/slides/_rels``.
"""

from __future__ import annotations

import argparse
from io import BytesIO
from pathlib import Path
import posixpath
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw, ImageFont


REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
ET.register_namespace("", REL_NS)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Replace slide images with placeholders.")
    parser.add_argument("--input", required=True, help="Input PPTX path")
    parser.add_argument("--output", required=True, help="Output PPTX path")
    return parser.parse_args()


def build_placeholder_png() -> bytes:
    width, height = 1600, 900
    image = Image.new("RGB", (width, height), (232, 241, 244))
    draw = ImageDraw.Draw(image)

    border = (39, 146, 158)
    fill = (209, 233, 236)
    draw.rounded_rectangle((70, 70, width - 70, height - 70), 36, outline=border, width=8, fill=fill)

    draw.line((180, 180, width - 180, height - 180), fill=border, width=10)
    draw.line((width - 180, 180, 180, height - 180), fill=border, width=10)

    try:
        font_main = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", 72)
        font_sub = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", 34)
    except OSError:
        font_main = ImageFont.load_default()
        font_sub = ImageFont.load_default()

    main_text = "静态图片占位"
    sub_text = "后续替换为项目相关图片 / 图表"

    main_box = draw.textbbox((0, 0), main_text, font=font_main)
    sub_box = draw.textbbox((0, 0), sub_text, font=font_sub)
    main_x = (width - (main_box[2] - main_box[0])) / 2
    sub_x = (width - (sub_box[2] - sub_box[0])) / 2

    draw.text((main_x, 345), main_text, fill=border, font=font_main)
    draw.text((sub_x, 455), sub_text, fill=(72, 96, 102), font=font_sub)

    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def rewrite_slide_relationships(rels_path: Path, placeholder_target: str) -> bool:
    root = ET.fromstring(rels_path.read_bytes())
    changed = False
    for rel in root.findall(f"{{{REL_NS}}}Relationship"):
        rel_type = rel.attrib.get("Type", "")
        target = rel.attrib.get("Target", "")
        if rel_type.endswith("/image") and target.startswith("../media/"):
            rel.set("Target", placeholder_target)
            changed = True
    if changed:
        rels_path.write_bytes(ET.tostring(root, encoding="utf-8", xml_declaration=True))
    return changed


def collect_referenced_media_paths(root_dir: Path) -> set[str]:
    referenced: set[str] = set()
    for rels_path in root_dir.rglob("*.rels"):
        rel_root = ET.fromstring(rels_path.read_bytes())
        rels_rel = rels_path.relative_to(root_dir).as_posix()
        if "/_rels/" in rels_rel:
            source_rel = rels_rel.replace("/_rels/", "/").removesuffix(".rels")
            source_base = posixpath.dirname(source_rel)
        else:
            source_base = posixpath.dirname(rels_rel)
        for rel in rel_root.findall(f"{{{REL_NS}}}Relationship"):
            target = rel.attrib.get("Target", "")
            if not target or target.startswith(("http://", "https://", "file://")):
                continue
            normalized = posixpath.normpath(posixpath.join(source_base, target))
            if normalized.startswith("ppt/media/"):
                referenced.add(normalized)
    return referenced


def prune_unused_media(root_dir: Path, referenced_media: set[str]) -> int:
    media_dir = root_dir / "ppt" / "media"
    if not media_dir.exists():
        return 0

    removed = 0
    for media_path in media_dir.iterdir():
        rel_path = f"ppt/media/{media_path.name}"
        if rel_path in referenced_media:
            continue
        media_path.unlink()
        removed += 1
    return removed


def main() -> None:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)
    placeholder_bytes = build_placeholder_png()

    with TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        with ZipFile(input_path) as source:
            source.extractall(tmpdir_path)

        placeholder_rel_target = "../media/placeholder-static-image.png"
        rels_root = tmpdir_path / "ppt" / "slides" / "_rels"
        if rels_root.exists():
            for rels_path in rels_root.glob("slide*.xml.rels"):
                rewrite_slide_relationships(rels_path, placeholder_rel_target)

        media_dir = tmpdir_path / "ppt" / "media"
        media_dir.mkdir(parents=True, exist_ok=True)
        (media_dir / "placeholder-static-image.png").write_bytes(placeholder_bytes)

        referenced_media = collect_referenced_media_paths(tmpdir_path)
        prune_unused_media(tmpdir_path, referenced_media)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        with ZipFile(output_path, "w", ZIP_DEFLATED) as target:
            for file_path in sorted(tmpdir_path.rglob("*")):
                if file_path.is_file():
                    target.write(file_path, file_path.relative_to(tmpdir_path))


if __name__ == "__main__":
    main()
