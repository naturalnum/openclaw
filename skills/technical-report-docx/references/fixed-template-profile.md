# Fixed Template Profile

Canonical template:

- `基于人机协同的配网检修运行方式智能校核与编制优化关键技术研究-技术总报告0126.docx`

This template is the fixed style source for this skill. Treat it as a production template for Chinese technical reports, not as an example to loosely imitate.

## Core Style System

- `Normal`
  Used heavily on the cover and front matter.
  Typical behavior: cover/title lines, centered blocks, front-matter labels.
  Template defaults observed: `@黑体`, `10.5pt`, base justified; cover paragraphs override this with explicit centered formatting and larger runs.

- `本文正文`
  Primary body style for narrative report text.
  Observed defaults:
  `仿宋_GB2312`, `12pt`, first-line indent `24pt`, line spacing `1.5`.
  Use this as the default for report prose and for table cell text when no more specific table style is available.

- `002二级标题`
  Primary section heading style.
  Observed defaults:
  `14pt`, left indent about `35.9pt`, spacing before/after about `7.8pt`.
  Typical text examples:
  `1.1 研究背景`, `1.2 研究现状`, `1.3 研究内容`.

- `003三级标题`
  Subsection heading style.
  Typical text examples:
  `2.1.1 多时间尺度检修计划编排影响因素`
  `2.1.2 多时间运行方式调整影响因素`

- `图名`
  Caption style for figures and tables.
  Observed defaults:
  `Times New Roman`, `11pt`, centered, spacing before/after about `2.5pt`, line spacing `1.5`.

## Cover Characteristics

- Cover content is centered.
- Large title lines use explicit run-level formatting instead of relying only on the base `Normal` style.
- The report name, organization, and date are visually separated into distinct centered lines.
- When generating a new technical report, preserve the same cover rhythm:
  project line -> report title line -> report type line -> organization line -> date line.

## Body Rhythm

- Main prose should default to `本文正文`.
- Do not mix source-document fonts into the final body.
- Do not upgrade numbered list items like `1、2、3` into heading styles unless they clearly function as headings in the report structure.
- Keep technical report hierarchy stable:
  section heading -> subsection heading -> body prose -> tables/figures -> captions.

## Table Rules

- Reuse the template's table style family where possible.
- Table cell text should inherit the report body rhythm instead of introducing foreign fonts.
- Header rows may be bolded or centered, but do not drift into a different visual system from the report.
- Large source tables may spill onto added pages, but typography must stay consistent.

## Provenance Rule

- All substantive report content must come from the user's input document.
- The template contributes style, structure, and page furniture only.
- Do not reuse the template's topic-specific正文内容.

## Practical Implication For Generation

When in doubt:

- narrative text -> `本文正文`
- major report headings -> `002二级标题`
- deeper subsections -> `003三级标题`
- captions -> `图名`
- cover lines -> copy formatting from the canonical template's first-page centered lines
