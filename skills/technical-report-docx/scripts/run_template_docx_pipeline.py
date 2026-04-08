#!/usr/bin/env python3

import argparse
import json
import subprocess
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent


def run_step(args: list[str]):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        sys.stderr.write(result.stderr or result.stdout)
        raise SystemExit(result.returncode)
    return result.stdout


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run the template-driven DOCX preparation pipeline end to end."
    )
    parser.add_argument("--template", required=True, help="Path to template DOCX")
    parser.add_argument("--source", required=True, help="Path to source content document")
    parser.add_argument("--workdir", required=True, help="Directory for generated artifacts")
    parser.add_argument(
        "--output-plan",
        default=None,
        help="Optional explicit path for generation-plan.json",
    )
    parser.add_argument(
        "--generate-docx",
        action="store_true",
        help="Also generate an edited DOCX using the template-styled Python generator.",
    )
    parser.add_argument(
        "--output-docx",
        default=None,
        help="Optional explicit path for the generated DOCX.",
    )
    args = parser.parse_args()

    template = Path(args.template)
    source = Path(args.source)
    workdir = Path(args.workdir)
    output_plan = Path(args.output_plan) if args.output_plan else workdir / "generation-plan.json"
    output_docx = Path(args.output_docx) if args.output_docx else workdir / "edited.docx"

    if not template.exists():
        raise SystemExit(f"ERROR: template not found: {template}")
    if not source.exists():
        raise SystemExit(f"ERROR: source not found: {source}")

    workdir.mkdir(parents=True, exist_ok=True)

    prepare_script = SCRIPT_DIR / "prepare_docx_generation.py"
    plan_script = SCRIPT_DIR / "build_generation_plan.py"
    generate_script = SCRIPT_DIR / "generate_docx_from_template.py"

    run_step(
        [
            sys.executable,
            str(prepare_script),
            "--template",
            str(template),
            "--source",
            str(source),
            "--workdir",
            str(workdir),
        ]
    )

    run_step(
        [
            sys.executable,
            str(plan_script),
            "--workdir",
            str(workdir),
            "--output",
            str(output_plan),
        ]
    )

    manifest_path = workdir / "manifest.json"
    style_mapping_path = workdir / "style-mapping.json"
    plan_data = json.loads(output_plan.read_text(encoding="utf-8"))

    if args.generate_docx:
        run_step(
            [
                sys.executable,
                str(generate_script),
                "--template",
                str(template),
                "--source",
                str(source),
                "--output",
                str(output_docx),
                "--style-mapping",
                str(style_mapping_path),
            ]
        )

    result = {
        "template": str(template),
        "source": str(source),
        "workdir": str(workdir),
        "manifest": str(manifest_path),
        "generation_plan": str(output_plan),
        "edited_docx": str(output_docx) if args.generate_docx else None,
        "recommended_next_step": (
            "Review the generated edited.docx for style fidelity and then refine the "
            "section mapping if needed."
            if args.generate_docx
            else "Use the generated execution_prompt in generation-plan.json together with "
            "the minimax-docx skill to create edited.docx."
        ),
        "execution_prompt": plan_data.get("execution_prompt"),
    }

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
