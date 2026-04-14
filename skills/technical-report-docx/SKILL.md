---
name: technical-report-docx
description: >
  Generate a professional technical report DOCX from an input source document
  while strictly preserving a fixed technical-report template. Use when the
  user wants a formal Chinese technical report whose content comes from a PDF,
  DOCX, DOC, WPS-exported document, TXT, or Markdown file, but whose final
  typography, heading hierarchy, paragraph rhythm, cover style, table style,
  and report layout must strictly follow the canonical technical-report template
  "基于人机协同的配网检修运行方式智能校核与编制优化关键技术研究-技术总报告0126.docx".
  Triggers: "生成技术报告", "生成技术总报告", "按技术报告模板生成Word", "按技术报告模板出一版",
  "根据输入材料生成技术报告", "严格参照技术报告模板", "内容来自输入文档", "不要抄模板正文",
  "技术报告docx", "technical report docx", "generate technical report from source",
  "fixed-format technical report", "template-locked report generation".
license: MIT
metadata:
  version: "2.0"
  category: document-processing
  sources:
    - Fixed technical report rule file in references
    - Fixed technical report template in references
    - Open XML WordprocessingML (.docx) structure rules
    - PyPDF and python-docx extraction workflows
---

# Technical Report DOCX

Use this skill when the user wants a formal technical report whose:

- **content** comes from an input text document
- **formatting** comes from a fixed technical-report template

Default local inputs for this workspace:

- Canonical template document: `./skills/technical-report-docx/references/纵向科技项目技术报告编写模板-2023版（新模板）.docx`
- Canonical rule file: `./skills/technical-report-docx/references/技术报告规范要点.md`
- Source content document: `./input.pdf` or another text document
- Expected output: `./edited.docx`

## Primary Goal

Build a new DOCX technical report whose **content comes from the input document** while **the visual and typographic formatting strictly follows the canonical technical-report template and rule file**.

## Mandatory Content Rules

1. **All substantive output text must come from the input document.**
2. **Do not copy template wording unless the same wording is also supported by the input document.**
3. **Template text is a formatting carrier, not a content source.**
4. **If the template contains example text, replace or remove it completely.**
5. **Do not invent unsupported claims just to fill a section.**
6. **The final report must read like a real technical report, not like a loose material dump.**

## Mandatory Formatting Rules

1. **Preserve the canonical template's font families, font sizes, bold/italic usage, color usage, paragraph alignment, line spacing, indentation, heading hierarchy, and cover layout.**
2. **Prefer applying template styles over direct-formatting new text.**
3. **Preserve section structure, headers/footers, page setup, page-break logic, and report rhythm whenever possible.**
4. **Do not allow text overlap, clipping, or layout breakage.**
5. **If content is too long for the template section, split sections or add pages instead of compressing into unreadable formatting.**
6. **Treat the canonical template's style family as fixed production rules, not optional hints.**

## Runtime Dependency

This production path does **not** require `minimax-docx`.

The current runtime depends on:

- the fixed template in `references/`
- the rule file in `references/`
- `python-docx`
- `pypdf`
- `LibreOffice` / `soffice`
- `poppler` tools such as `pdftotext`, `pdftoppm`, and `pdfinfo`

## Read These First

- [workflow.md](references/workflow.md)
- [template-format-rules.md](references/template-format-rules.md)
- [技术报告规范要点.md](references/技术报告规范要点.md)
- [fixed-template-profile.md](references/fixed-template-profile.md)
- [fixed-template-audit.md](references/fixed-template-audit.md)
- [fixed-template-audit.json](references/fixed-template-audit.json)
- [openclaw-usage.md](references/openclaw-usage.md)

## Recommended Workflow

### Step 1: Normalize the input files

Preferred source formats:

- `.pdf`
- `.docx`
- `.txt`
- `.md`

Normalize first if needed:

- `.doc`
- `.wps`
- other office-exported formats

### Step 2: Extract source content

Use the helper script:

```bash
python3 skills/technical-report-docx/scripts/extract_source_text.py \
  --input ./input.pdf \
  --output ./work/input.md
```

This is only for extracting source text. It is **not** a formatting source.

Or run the full preparation pipeline in one command:

```bash
python3 skills/technical-report-docx/scripts/generate_exact_toc_report.py \
  --template ./skills/technical-report-docx/references/纵向科技项目技术报告编写模板-2023版（新模板）.docx \
  --source ./input.pdf \
  --english-title "LLM translated English project title" \
  --llm-overrides ./work/llm-overrides.json \
  --output ./technical-report.docx
```

Important:

- The calling LLM should translate the Chinese project title into a professional English cover title during the conversation.
- Pass that translated title into the generator with `--english-title`.
- The calling LLM should also extract task-book structure, improve heading restoration, and expand appropriate technical-report sections.
- Pass those structured results into the generator with `--llm-overrides`.
- The script should not call an external LLM by itself. The LLM should do the reasoning in the interaction layer, and the script should do deterministic document generation.

Recommended `llm-overrides.json` shape:

```json
{
  "fields": {
    "英文标题": "English cover title"
  },
  "front_matter": {
    "summary": "Chinese summary",
    "keywords": "关键词1；关键词2",
    "abstract": "English abstract",
    "en_keywords": "keyword 1; keyword 2"
  },
  "tasks": [
    {
      "number": 1,
      "title": "课题标题",
      "overview": "LLM refined overview",
      "content_items": ["研究项1", "研究项2"],
      "specific_points_map": {
        "研究项1": ["扩写点1", "扩写点2"]
      }
    }
  ],
  "body_overrides": {
    "2.1 概述": ["段落1", "段落2"]
  }
}
```

### Step 3: Inspect the fixed template

Use the helper script:

```bash
python3 skills/technical-report-docx/scripts/inspect_template_docx.py \
  --input ./skills/technical-report-docx/references/纵向科技项目技术报告编写模板-2023版（新模板）.docx \
  --output ./work/template-format.md
```

For stricter formatting transfer, also generate a machine-readable audit:

```bash
python3 skills/technical-report-docx/scripts/audit_template_docx.py \
  --input ./skills/technical-report-docx/references/纵向科技项目技术报告编写模板-2023版（新模板）.docx \
  --output ./work/template-format.json
```

Then generate style-role suggestions:

```bash
python3 skills/technical-report-docx/scripts/suggest_style_mapping.py \
  --input ./work/template-format.json \
  --output ./work/style-mapping.json
```

Capture at least:

- heading styles and their font patterns
- body text style and paragraph spacing
- table text formatting
- header/footer style
- page margins and section structure when visible
- dominant font sizes, bold/italic patterns, and common alignments
- fixed cover characteristics
- caption style for tables and figures

### Step 4: Build a content-to-report mapping

Map each source section into a technical-report section plan.

Minimum planning output:

```text
Template cover    <- source title / project name / organization / date
Report section 1  <- source background or overview
Report section 2  <- source research content / methods
Report section 3  <- source schedule / budget / staffing
Appendix blocks   <- source supplementary materials
```

### Step 5: Generate the report with the fixed-format generator

Rules:

- keep template structure when it is reusable
- replace example text with source-derived text
- strip direct-format contamination from copied source content
- preserve style IDs and paragraph structure where possible
- keep the report's cover,正文节奏,题注风格, and table rhythm consistent with the fixed template

### Step 6: Validate

Before delivery:

- confirm the visible text comes from the input source
- confirm the formatting matches the fixed technical-report template
- confirm no placeholder text remains
- confirm there is no overflow or broken section layout

## Output Contract

Required artifact:

- `./edited.docx`

Recommended working files:

- `./work/input.md`
- `./work/template-format.md`
- `./work/template-format.json`
- `./work/style-mapping.json`
- `./work/generation-plan.json`
- `./work/section-map.md`
- `./work/edited.docx`

## Quality Bar

The output is only complete when:

- the document reads like the input source, not the template
- the visible formatting reads like the canonical technical-report template, not the source
- text styles are consistent with the fixed template
- the report hierarchy is stable and professional
- no overlapping or broken layout remains
