---
name: project-report-ppt
description: >
  Generate a Chinese project report PPT from input materials while following a
  fixed finished PPT template. Use when the user wants a project汇报/项目汇报PPT,
  结题汇报PPT, 中期汇报PPT, 验收汇报PPT, 科技项目汇报PPT, or wants a deck
  "参照现有PPT模板出一版". The final content must come from the user's source
  materials, while the slide rhythm, section structure, visual style, and page
  composition should follow the bundled template `template-project-report.pptx`.
  Triggers: "生成项目汇报PPT", "参照这个PPT做模板", "按模板生成汇报PPT", "结题答辩PPT",
  "验收汇报PPT", "中期汇报PPT", "项目汇报幻灯片", "generate project report ppt",
  "fixed-template powerpoint", "template-locked report deck".
---

# Project Report PPT

Use this skill when the user wants a new project report PPT whose:

- **content** comes from source materials such as Word, PDF, Markdown, TXT, meeting notes, or an existing report
- **formatting and page rhythm** come from the fixed PPT template in `assets/`

Default local files for this skill:

- Template PPT: `./skills/project-report-ppt/assets/template-project-report.pptx`
- Template structure note: `./skills/project-report-ppt/references/template-structure.md`
- Page schema: `./skills/project-report-ppt/references/page-schema.json`
- Content schema: `./skills/project-report-ppt/references/content-schema.json`
- Template inspector: `./skills/project-report-ppt/scripts/inspect_template_ppt.py`
- Plan builder: `./skills/project-report-ppt/scripts/build_generation_plan.py`
- Content extractor: `./skills/project-report-ppt/scripts/extract_project_content.py`
- Page-manifest builder: `./skills/project-report-ppt/scripts/build_page_manifest_v2.py`
- Page-manifest verifier: `./skills/project-report-ppt/scripts/verify_page_manifest_v2.py`
- Expected output: `./edited.pptx`

## Primary Goal

Build a new project report PPT whose **substantive content comes from the input materials** while **the visual structure follows the bundled template**.

## Mandatory Content Rules

1. **All substantive output text must be supported by the input materials.**
2. **Do not copy template body text as project content.**
3. **Treat the template as a layout carrier, not a content source.**
4. **Delete or rewrite every project-specific example from the template.**
5. **Do not invent metrics, milestones, papers, patents, budgets, or expert comments.**
6. **Prefer short PPT-ready statements over long report prose.**

## Mandatory Formatting Rules

1. **Preserve the template's section rhythm, title hierarchy, page density, and overall visual language.**
2. **Keep page layouts readable; split content into additional slides when needed.**
3. **Do not allow dense text blocks to replace diagrams, tables, or structured bullets when the template expects structure.**
4. **When exact duplication is impossible, preserve the intent of the page composition first.**

## Read These First

- [template-structure.md](references/template-structure.md)
- [page-types.md](references/page-types.md)

If you need a machine-readable template summary, generate one first:

```bash
python3 skills/project-report-ppt/scripts/inspect_template_ppt.py \
  --input ./skills/project-report-ppt/assets/template-project-report.pptx \
  --output ./work/template-summary.json
```

Or emit a human-readable note:

```bash
python3 skills/project-report-ppt/scripts/inspect_template_ppt.py \
  --input ./skills/project-report-ppt/assets/template-project-report.pptx \
  --output ./work/template-summary.md
```

## Recommended Workflow

### Step 1: Normalize the source materials

Preferred inputs:

- `.docx`
- `.pdf`
- `.md`
- `.txt`

If the input is a DOC/PDF/WPS export, first extract or normalize it into plain text or Markdown so the content can be mapped cleanly.

### Step 2: Inspect the template before writing

Use the template inspector to understand:

- how many slides the template contains
- which major sections exist
- which layouts dominate
- which slides act as cover,目录,章节切换,成果、表格、总结、答疑页面

Do not start rewriting slides blindly before understanding the template's page rhythm.

### Step 3: Extract structured content first

Before filling slides, normalize the source materials into the v2 content schema:

```bash
python3 skills/project-report-ppt/scripts/extract_project_content.py \
  --input ./taskbook.pdf ./report.docx \
  --output ./work/project-content.json
```

This step creates a stable content layer with:

- project meta
- overall objective and deliverables
- task 1-4 titles, research contents, objectives, indicators
- management and timeline data

### Step 4: Build a page manifest from the template schema

Use the range-based page schema to map structured content into page roles:

```bash
python3 skills/project-report-ppt/scripts/build_page_manifest_v2.py \
  --schema ./skills/project-report-ppt/references/page-schema.json \
  --content ./work/project-content.json \
  --output ./work/page-manifest.json
```

This manifest is the new bridge between content and rendering. It separates:

- fixed template pages
- dynamic background/body pages
- task subtitle pages
- task research pages
- table pages
- summary / feedback pages

Validate the new v2 layer before touching PPT XML:

```bash
python3 skills/project-report-ppt/scripts/verify_page_manifest_v2.py \
  --schema ./skills/project-report-ppt/references/page-schema.json \
  --content ./work/project-content.json \
  --manifest ./work/page-manifest.json
```

### Step 5: Build a generation plan from source materials

Use the planning helper:

```bash
python3 skills/project-report-ppt/scripts/build_generation_plan.py \
  --input ./input.md \
  --title "项目名称" \
  --output ./work/ppt-plan.json
```

This plan is a scaffold. The calling LLM should then:

- extract the real project title,单位、时间、课题、成果、指标、问题与整改信息
- map the material into the template's major sections
- decide which template pages should be rewritten, merged, duplicated, or removed
- convert report prose into slide-ready bullets, mini-headings, figure captions, and table wording

### Step 6: Rebuild slide content against the template

For each planned section:

- keep the page's structural role from the template
- replace every old project-specific statement
- rewrite paragraphs into concise bullet points or compact explanatory blocks
- preserve evidence-bearing pages such as milestones, budgets, indicators, papers, patents, prototype systems, and expert feedback only when the source materials support them

### Step 7: Validate before delivery

Before handing off the PPT:

- confirm no old project name,单位、人名、日期 or成果 remains from the template
- confirm every metric or claim is supported by the source materials
- confirm section order still makes sense as a presentation, not just as a document dump
- confirm no slide is overloaded with long text

## Page Mapping Guidance

This template roughly follows this rhythm:

- cover
- agenda / section divider
- project background and basic information
- project management, timeline, budget, and team pages
- research progress and related-work pages
- main research content and innovation-result pages
- validation / KPI / papers / patents / software pages
- summary and outlook
- expert-opinion response
- ending thank-you page

When the source project is smaller than the template:

- merge similar pages
- drop unsupported artifact pages
- keep the main chapter rhythm

When the source project is larger than the template:

- duplicate the closest matching page types
- preserve visual consistency rather than forcing too much onto one slide

## Output Contract

Required artifact:

- `./edited.pptx`

Recommended working files:

- `./work/template-summary.json`
- `./work/template-summary.md`
- `./work/project-content.json`
- `./work/page-manifest.json`
- `./work/ppt-plan.json`

## Notes for the Calling LLM

- The input materials are the **content authority**.
- The bundled PPT is the **format authority**.
- If the user asks for "参照模板生成", produce a new deck rather than editing the template in-place unless they explicitly want a modified copy of the template.
