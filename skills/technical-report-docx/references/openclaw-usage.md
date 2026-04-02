# OpenClaw Usage

Use this skill in OpenClaw when the user wants a professional technical report DOCX whose content comes from another input document but whose final formatting must strictly follow the fixed technical-report template.

## Suggested Prompt

```text
Use the technical-report-docx skill.
Take the canonical technical-report template as the fixed formatting source.
Take the provided PDF / DOCX / DOC / WPS / text file as the content source.
Translate the Chinese project title into a professional English cover title during the LLM interaction.
Use the LLM to extract the task-book structure, restore broken headings, and draft suitable summary/body expansions before calling the generator.
Generate a new technical-report.docx.
All substantive content must come from the input document.
Do not copy template wording unless it is also supported by the input document.
Strictly preserve the template's cover style, font system, paragraph system, heading hierarchy, caption style, and page formatting.
If content is too long, add pages or sections instead of causing layout overlap.
```

## Guardrails

- Do not treat template text as a content source
- Do not flatten all text into one generic style
- Prefer the fixed report template styles over direct formatting
- Preserve heading hierarchy, body text rhythm, and technical-report tone
- Preserve headers, footers, and section/page setup when possible
- Avoid unreadably small text

## Useful Commands

```bash
python3 skills/technical-report-docx/scripts/generate_exact_toc_report.py \
  --template ./skills/technical-report-docx/references/纵向科技项目技术报告编写模板-2023版（新模板）.docx \
  --source ./input.pdf \
  --english-title "LLM translated English project title" \
  --llm-overrides ./work/llm-overrides.json \
  --output ./technical-report.docx
```

```bash
python3 skills/technical-report-docx/scripts/extract_source_text.py \
  --input ./input.pdf \
  --output ./work/input.md
```

```bash
python3 skills/technical-report-docx/scripts/inspect_template_docx.py \
  --input ./skills/technical-report-docx/references/纵向科技项目技术报告编写模板-2023版（新模板）.docx \
  --output ./work/template-format.md
```

```bash
python3 skills/technical-report-docx/scripts/audit_template_docx.py \
  --input ./skills/technical-report-docx/references/纵向科技项目技术报告编写模板-2023版（新模板）.docx \
  --output ./work/template-format.json
```

```bash
python3 skills/technical-report-docx/scripts/suggest_style_mapping.py \
  --input ./work/template-format.json \
  --output ./work/style-mapping.json
```

## Migration Notes

- The current production path does not require `minimax-docx`.
- The key runtime script is `scripts/generate_exact_toc_report.py`.
- OpenClaw only needs the fixed template DOCX and the rule file in `references/`.
- In OpenClaw, the model should provide the English cover title and pass it through `--english-title`.
- In OpenClaw, the model should also provide structured extraction and expansion results through `--llm-overrides`.
- For visual page and TOC-page-number validation, install `LibreOffice` (`soffice`) and `poppler`.
