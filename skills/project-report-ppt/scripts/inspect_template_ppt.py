#!/usr/bin/env python3
"""Inspect a PPTX template and emit a compact structural summary."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any
from zipfile import ZipFile
import xml.etree.ElementTree as ET

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Inspect a PPTX template and summarize slide structure."
    )
    parser.add_argument("--input", required=True, help="Path to the PPTX template.")
    parser.add_argument(
        "--output",
        required=True,
        help="Output path for the summary file. Use .json or .md.",
    )
    parser.add_argument(
        "--max-text-runs",
        type=int,
        default=10,
        help="Maximum text runs to keep per slide snippet.",
    )
    return parser.parse_args()


def read_xml(zf: ZipFile, path: str) -> ET.Element:
    return ET.fromstring(zf.read(path))


def normalize_target(base_dir: str, target: str) -> str:
    target_path = Path(base_dir) / target
    return str(target_path.resolve().as_posix())


def clean_internal_path(path: str) -> str:
    parts = []
    for item in Path(path).parts:
        if item == ".":
            continue
        if item == "..":
            if parts:
                parts.pop()
            continue
        parts.append(item)
    return "/".join(parts)


def load_slide_targets(zf: ZipFile) -> list[str]:
    pres = read_xml(zf, "ppt/presentation.xml")
    rels = read_xml(zf, "ppt/_rels/presentation.xml.rels")
    relmap = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
    slide_targets: list[str] = []
    slide_id_list = pres.find("p:sldIdLst", NS)
    if slide_id_list is None:
        return slide_targets
    for slide_id in slide_id_list:
        rel_id = slide_id.attrib[REL_NS]
        target = clean_internal_path(f"ppt/{relmap[rel_id]}")
        slide_targets.append(target)
    return slide_targets


def slide_layout_name(zf: ZipFile, slide_path: str) -> str | None:
    slide_file = Path(slide_path)
    rel_path = slide_file.parent / "_rels" / f"{slide_file.name}.rels"
    rel_root = read_xml(zf, clean_internal_path(str(rel_path)))
    for rel in rel_root:
        rel_type = rel.attrib.get("Type", "")
        if rel_type.endswith("/slideLayout"):
            return Path(rel.attrib["Target"]).name
    return None


def extract_text_runs(root: ET.Element) -> list[str]:
    values = []
    for node in root.findall(".//a:t", NS):
        if node.text:
            text = " ".join(node.text.split())
            if text:
                values.append(text)
    return values


def build_summary(input_path: Path, max_text_runs: int) -> dict[str, Any]:
    with ZipFile(input_path) as zf:
        slide_targets = load_slide_targets(zf)
        layout_counts: Counter[str] = Counter()
        slides = []

        for index, slide_path in enumerate(slide_targets, start=1):
            root = read_xml(zf, slide_path)
            texts = extract_text_runs(root)
            layout = slide_layout_name(zf, slide_path)
            if layout:
                layout_counts[layout] += 1
            slides.append(
                {
                    "index": index,
                    "path": slide_path,
                    "layout": layout,
                    "text_run_count": len(texts),
                    "snippet": texts[:max_text_runs],
                    "first_text": texts[0] if texts else "",
                }
            )

        media_count = len([n for n in zf.namelist() if n.startswith("ppt/media/")])
        layout_total = len(
            [n for n in zf.namelist() if n.startswith("ppt/slideLayouts/") and n.endswith(".xml")]
        )
        master_total = len(
            [n for n in zf.namelist() if n.startswith("ppt/slideMasters/") and n.endswith(".xml")]
        )

    return {
        "template": str(input_path),
        "slide_count": len(slides),
        "layout_total": layout_total,
        "master_total": master_total,
        "media_count": media_count,
        "layout_usage": dict(layout_counts.most_common()),
        "slides": slides,
    }


def to_markdown(summary: dict[str, Any]) -> str:
    lines = [
        "# PPT Template Summary",
        "",
        f"- Template: `{summary['template']}`",
        f"- Slides: {summary['slide_count']}",
        f"- Slide layouts: {summary['layout_total']}",
        f"- Slide masters: {summary['master_total']}",
        f"- Media assets: {summary['media_count']}",
        "",
        "## Layout Usage",
        "",
    ]
    for layout, count in summary["layout_usage"].items():
        lines.append(f"- `{layout}`: {count}")

    lines.extend(["", "## Slide Snippets", ""])
    for slide in summary["slides"]:
        snippet = " | ".join(slide["snippet"])
        lines.append(
            f"- Slide {slide['index']:02d} [{slide['layout'] or 'unknown'}]: {snippet}"
        )
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    summary = build_summary(input_path, max_text_runs=args.max_text_runs)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.suffix.lower() == ".json":
        output_path.write_text(
            json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    else:
        output_path.write_text(to_markdown(summary), encoding="utf-8")


if __name__ == "__main__":
    main()
