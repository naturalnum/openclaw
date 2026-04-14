#!/usr/bin/env python3

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path


def pt_value(value):
    if value is None:
        return None
    try:
        return round(float(value.pt), 2)
    except Exception:
        return None


def normalize_alignment(value):
    if value is None:
        return "inherit"
    return str(value)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Audit a DOCX template and emit machine-readable formatting statistics."
    )
    parser.add_argument("--input", required=True, help="Path to template DOCX")
    parser.add_argument("--output", required=True, help="Path to output JSON")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        raise SystemExit(f"ERROR: template DOCX not found: {input_path}")

    try:
        from docx import Document
    except Exception as exc:
        raise SystemExit(
            "ERROR: python-docx is required.\n"
            "Install with:\n"
            "  pip install -r skills/technical-report-docx/scripts/requirements.txt"
        ) from exc

    doc = Document(str(input_path))

    global_stats = {
        "paragraph_count": 0,
        "nonempty_paragraph_count": 0,
        "styles": Counter(),
        "fonts": Counter(),
        "sizes_pt": Counter(),
        "alignments": Counter(),
        "bold_true_runs": 0,
        "italic_true_runs": 0,
        "run_count": 0,
    }

    style_profiles = defaultdict(
        lambda: {
            "paragraphs": 0,
            "fonts": Counter(),
            "sizes_pt": Counter(),
            "alignments": Counter(),
            "bold_true_runs": 0,
            "italic_true_runs": 0,
            "run_count": 0,
            "examples": [],
        }
    )

    for para in doc.paragraphs:
        global_stats["paragraph_count"] += 1
        text = para.text.strip()
        if not text:
            continue

        global_stats["nonempty_paragraph_count"] += 1
        style_name = para.style.name if para.style is not None else "(no style)"
        alignment = normalize_alignment(para.alignment)

        global_stats["styles"][style_name] += 1
        global_stats["alignments"][alignment] += 1

        profile = style_profiles[style_name]
        profile["paragraphs"] += 1
        profile["alignments"][alignment] += 1
        if len(profile["examples"]) < 5:
            profile["examples"].append(text[:160])

        for run in para.runs:
            global_stats["run_count"] += 1
            profile["run_count"] += 1

            if run.font.name:
                global_stats["fonts"][run.font.name] += 1
                profile["fonts"][run.font.name] += 1

            size_pt = pt_value(run.font.size)
            if size_pt is not None:
                key = f"{size_pt}pt"
                global_stats["sizes_pt"][key] += 1
                profile["sizes_pt"][key] += 1

            if bool(run.bold):
                global_stats["bold_true_runs"] += 1
                profile["bold_true_runs"] += 1
            if bool(run.italic):
                global_stats["italic_true_runs"] += 1
                profile["italic_true_runs"] += 1

    result = {
        "template": input_path.name,
        "global_stats": {
            "paragraph_count": global_stats["paragraph_count"],
            "nonempty_paragraph_count": global_stats["nonempty_paragraph_count"],
            "run_count": global_stats["run_count"],
            "bold_true_runs": global_stats["bold_true_runs"],
            "italic_true_runs": global_stats["italic_true_runs"],
            "styles": dict(global_stats["styles"].most_common()),
            "fonts": dict(global_stats["fonts"].most_common()),
            "sizes_pt": dict(global_stats["sizes_pt"].most_common()),
            "alignments": dict(global_stats["alignments"].most_common()),
        },
        "style_profiles": {},
    }

    for style_name, profile in style_profiles.items():
        result["style_profiles"][style_name] = {
            "paragraphs": profile["paragraphs"],
            "run_count": profile["run_count"],
            "bold_true_runs": profile["bold_true_runs"],
            "italic_true_runs": profile["italic_true_runs"],
            "fonts": dict(profile["fonts"].most_common()),
            "sizes_pt": dict(profile["sizes_pt"].most_common()),
            "alignments": dict(profile["alignments"].most_common()),
            "examples": profile["examples"],
        }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote template audit JSON to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
