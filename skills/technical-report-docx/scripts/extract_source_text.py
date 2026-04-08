#!/usr/bin/env python3

import argparse
from pathlib import Path


def extract_pdf(input_path: Path) -> str:
    try:
        from pypdf import PdfReader
    except Exception as exc:
        raise SystemExit(
            "ERROR: pypdf is required for PDF extraction.\n"
            "Install with:\n"
            "  pip install -r skills/technical-report-docx/scripts/requirements.txt"
        ) from exc

    reader = PdfReader(str(input_path))
    pages = []
    for i, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        pages.append(f"# Page {i}\n\n{text}\n")
    return "\n".join(pages)


def extract_docx(input_path: Path) -> str:
    try:
        from docx import Document
    except Exception as exc:
        raise SystemExit(
            "ERROR: python-docx is required for DOCX extraction.\n"
            "Install with:\n"
            "  pip install -r skills/technical-report-docx/scripts/requirements.txt"
        ) from exc

    doc = Document(str(input_path))
    lines = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            lines.append(text)
    return "\n\n".join(lines)


def extract_text(input_path: Path) -> str:
    suffix = input_path.suffix.lower()
    if suffix == ".pdf":
        return extract_pdf(input_path)
    if suffix == ".docx":
        return extract_docx(input_path)
    if suffix in {".txt", ".md"}:
        return input_path.read_text(encoding="utf-8")
    if suffix in {".doc", ".wps"}:
        raise SystemExit(
            "ERROR: .doc/.wps should be converted to .docx or .pdf before extraction."
        )
    raise SystemExit(f"ERROR: unsupported input format: {suffix}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract text from a source document for template-driven DOCX generation."
    )
    parser.add_argument("--input", required=True, help="Path to the source document")
    parser.add_argument("--output", required=True, help="Path to output markdown/text file")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        raise SystemExit(f"ERROR: input document not found: {input_path}")

    text = extract_text(input_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(text, encoding="utf-8")
    print(f"Wrote extracted text to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
