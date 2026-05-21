#!/usr/bin/env python3

import argparse
import json
from pathlib import Path


def normalize(name: str) -> str:
    return name.strip().lower()


def pick_first(style_profiles: dict, keywords: list[str], fallback=None):
    for style_name, profile in sorted(
        style_profiles.items(),
        key=lambda item: item[1].get("paragraphs", 0),
        reverse=True,
    ):
        hay = normalize(style_name)
        if any(keyword in hay for keyword in keywords):
            return style_name
    return fallback


def pick_body(style_profiles: dict):
    ranked = sorted(
        style_profiles.items(),
        key=lambda item: item[1].get("paragraphs", 0),
        reverse=True,
    )
    for style_name, _profile in ranked:
        hay = normalize(style_name)
        if any(bad in hay for bad in ["heading", "title", "toc", "header", "footer", "caption"]):
            continue
        return style_name
    return ranked[0][0] if ranked else None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Suggest semantic style mappings from a DOCX template audit JSON."
    )
    parser.add_argument("--input", required=True, help="Path to template-format JSON")
    parser.add_argument("--output", required=True, help="Path to output mapping JSON")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        raise SystemExit(f"ERROR: audit JSON not found: {input_path}")

    data = json.loads(input_path.read_text(encoding="utf-8"))
    style_profiles = data.get("style_profiles", {})
    if not style_profiles:
        raise SystemExit("ERROR: no style profiles found in audit JSON")

    mapping = {
        "title": pick_first(style_profiles, ["title", "标题"]),
        "heading_1": pick_first(style_profiles, ["heading 1", "heading1", "标题1", "h1"]),
        "heading_2": pick_first(style_profiles, ["heading 2", "heading2", "标题2", "h2"]),
        "heading_3": pick_first(style_profiles, ["heading 3", "heading3", "标题3", "h3"]),
        "body": pick_body(style_profiles),
        "list": pick_first(style_profiles, ["list", "bullet", "列表", "编号"]),
        "table_text": pick_first(style_profiles, ["table", "表格", "grid"]),
        "caption": pick_first(style_profiles, ["caption", "图注", "表注"]),
        "header_footer": pick_first(style_profiles, ["header", "footer", "页眉", "页脚"]),
    }

    result = {
        "template": data.get("template"),
        "suggested_mapping": mapping,
        "notes": [
            "These mappings are heuristics derived from template style names and usage frequency.",
            "Review the suggestions before applying them to generated content.",
            "When a role is null, fall back to the closest template style manually.",
        ],
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote style mapping suggestions to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
