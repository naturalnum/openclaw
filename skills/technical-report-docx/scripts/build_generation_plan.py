#!/usr/bin/env python3

import argparse
import json
from pathlib import Path


def load_json(path: Path):
    if not path.exists():
        raise SystemExit(f"ERROR: missing required JSON file: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def infer_sections_from_input(input_md: Path):
    if not input_md.exists():
        raise SystemExit(f"ERROR: missing extracted source text: {input_md}")

    lines = input_md.read_text(encoding="utf-8").splitlines()
    headings = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            headings.append(stripped.lstrip("#").strip())
            continue
        if len(headings) < 8:
            headings.append(stripped[:80])
    if not headings:
        headings = ["Document content"]
    return headings[:12]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build a generation plan for fixed-format technical-report DOCX output."
    )
    parser.add_argument("--workdir", required=True, help="Preparation workdir")
    parser.add_argument(
        "--output",
        required=True,
        help="Path to output generation-plan JSON",
    )
    args = parser.parse_args()

    workdir = Path(args.workdir)
    output_path = Path(args.output)

    manifest = load_json(workdir / "manifest.json")
    style_mapping = load_json(workdir / "style-mapping.json")
    template_audit = load_json(workdir / "template-format.json")
    input_md = Path(manifest["artifacts"]["input_md"])

    headings = infer_sections_from_input(input_md)
    suggested_mapping = style_mapping.get("suggested_mapping", {})

    plan = {
        "template": manifest["template"],
        "source": manifest["source"],
        "output_docx": str(workdir / "edited.docx"),
        "style_mapping": suggested_mapping,
        "section_plan": [],
        "rules": [
            "All substantive content must come from the input document.",
            "Do not copy template wording unless it is also supported by the input document.",
            "Apply template styles rather than source-document inline formatting.",
            "If content is too long for one section, add sections or pages instead of shrinking text aggressively.",
            "The final output must preserve template formatting and avoid layout breakage.",
        ],
        "minimax_docx_handoff": {
            "recommended_pipeline": "Scenario C: FORMAT-APPLY or BASE-REPLACE",
            "required_reads": [
                "skills/minimax-docx/SKILL.md",
                "skills/technical-report-docx/SKILL.md",
                "skills/technical-report-docx/references/template-format-rules.md",
                "skills/technical-report-docx/references/fixed-template-profile.md",
            ],
        },
        "template_summary": {
            "dominant_styles": list(template_audit.get("global_stats", {}).get("styles", {}).keys())[:8],
            "dominant_fonts": list(template_audit.get("global_stats", {}).get("fonts", {}).keys())[:6],
            "dominant_sizes": list(template_audit.get("global_stats", {}).get("sizes_pt", {}).keys())[:6],
        },
    }

    title_style = suggested_mapping.get("title") or suggested_mapping.get("heading_1")
    heading_style = suggested_mapping.get("heading_1") or suggested_mapping.get("heading_2")
    body_style = suggested_mapping.get("body")

    for idx, heading in enumerate(headings, start=1):
        role = "title" if idx == 1 else "section"
        preferred_style = title_style if idx == 1 else heading_style
        plan["section_plan"].append(
            {
                "index": idx,
                "source_heading": heading,
                "role": role,
                "preferred_heading_style": preferred_style,
                "preferred_body_style": body_style,
            }
        )

    preview_prompt = f"""Use the technical-report-docx skill together with minimax-docx.
Template: {manifest['template']}
Source: {manifest['source']}
Output: {workdir / 'edited.docx'}
All substantive content must come from the source document.
Do not copy template wording unless it is supported by the source document.
Preserve the fixed technical-report template's cover style, font system, paragraph system, heading hierarchy, caption style, and page formatting.
Prefer template styles from style-mapping.json.
If content is too long, add sections or pages instead of causing layout breakage."""

    plan["execution_prompt"] = preview_prompt

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote generation plan to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
