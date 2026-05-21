# Workflow

This skill produces a new technical report DOCX from:

- a **fixed technical-report template** that defines formatting
- a **source document** that defines content

## Core Rule

Treat the fixed technical-report template as the **style source of truth** and the input document as the **content source of truth**.

Never reverse these roles.

## Input Handling

Supported content-source formats:

- `.pdf`
- `.docx`
- `.txt`
- `.md`

Normalized first if needed:

- `.doc`
- `.wps`
- other office-exported formats

## Execution Order

1. Normalize source files into readable formats
2. Extract source content into markdown or plain text
3. Inspect the fixed template's formatting patterns
4. Generate a machine-readable template formatting audit when strict fidelity matters
5. Generate semantic style-role mapping suggestions from the audit
6. Build a technical-report section plan
7. Apply the template with `minimax-docx`
8. Validate content provenance and formatting fidelity

## Content Provenance Rule

Every substantive sentence in the final DOCX should be traceable to the source document.

Allowed reuse from template:

- generic report furniture such as headers, footers, or static cover ornaments
- structural labels only when they are appropriate report scaffolding

Disallowed reuse from template:

- topic-specific example body text
- example claims, names, dates, numbers, or narrative content

## Formatting Fidelity Rule

The final DOCX should match the fixed technical-report template on:

- heading hierarchy
- paragraph alignment
- body font family and size rhythm
- table typography
- header/footer style
- section/page structure where practical
- cover composition and report rhythm

## Overflow Rule

Never force too much text into a fixed layout.

If content grows beyond what a template block can hold:

- add another page or section in the same style family
- split the content logically
- shorten wording only when meaning is preserved

Do not solve this by making text unreadably small.
