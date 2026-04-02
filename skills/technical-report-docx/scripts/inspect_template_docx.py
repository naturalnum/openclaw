#!/usr/bin/env python3

import argparse
from collections import Counter
from pathlib import Path


def pt_value(value):
    if value is None:
        return None
    try:
        return round(float(value.pt), 2)
    except Exception:
        return None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Inspect a DOCX template and summarize visible text-format patterns."
    )
    parser.add_argument("--input", required=True, help="Path to template DOCX")
    parser.add_argument("--output", required=True, help="Path to output markdown summary")
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
    style_counter = Counter()
    font_counter = Counter()
    size_counter = Counter()
    bold_counter = Counter()
    italic_counter = Counter()
    alignment_counter = Counter()
    examples = []

    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            continue
        style_name = para.style.name if para.style is not None else "(no style)"
        style_counter[style_name] += 1
        alignment_counter[str(para.alignment or "inherit")] += 1
        for run in para.runs:
            if run.font.name:
                font_counter[run.font.name] += 1
            if pt_value(run.font.size) is not None:
                size_counter[f"{pt_value(run.font.size)}pt"] += 1
            bold_counter[str(bool(run.bold))] += 1
            italic_counter[str(bool(run.italic))] += 1
        if len(examples) < 25:
            examples.append((style_name, text[:120]))

    lines = [
        f"# Template Format Summary: {input_path.name}",
        "",
        "## Frequent paragraph styles",
        "",
    ]

    for name, count in style_counter.most_common(20):
        lines.append(f"- {name}: {count}")

    lines.extend(["", "## Frequent explicit fonts", ""])
    for name, count in font_counter.most_common(20):
        lines.append(f"- {name}: {count}")

    lines.extend(["", "## Frequent explicit font sizes", ""])
    for name, count in size_counter.most_common(20):
        lines.append(f"- {name}: {count}")

    lines.extend(["", "## Bold / italic usage", ""])
    for name, count in bold_counter.most_common():
        lines.append(f"- bold={name}: {count}")
    for name, count in italic_counter.most_common():
        lines.append(f"- italic={name}: {count}")

    lines.extend(["", "## Paragraph alignments", ""])
    for name, count in alignment_counter.most_common():
        lines.append(f"- {name}: {count}")

    lines.extend(["", "## Sample paragraphs", ""])
    for style_name, text in examples:
        lines.append(f"- [{style_name}] {text}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote template format summary to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
