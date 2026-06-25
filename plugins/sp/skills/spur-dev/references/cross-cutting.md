---
name: cross-cutting
description: "Extracted section: cross-cutting write rules shared by both halves — every-write-is-CLI-gated, the section-editing body-only workflow, the section-status matrix, and check-before-write. These mechanics apply to all planning and execution writes."
see_also:
  - spur-dev
---

# Cross-cutting Rules

These mechanics apply to **every** write in both the planning and execution halves. The skill
knows *how to think*; the CLI knows *what is valid* — every mutation passes through a CLI verb
that validates before writing.

## Every write is CLI-gated

Never edit a task or feature file directly. Every mutation goes through:

| Intent | CLI verb |
|--------|----------|
| Create a task | `spur task create` |
| Change status | `spur task update <wbs> <status>` |
| Edit a section | `spur task update <wbs> --section <name> --from-file <path>` |
| Record verify results | `spur task record <wbs> [--solution-from-diff] [--transition <status>]` |
| Create a feature | `spur feature create` |
| Batch create tasks | `spur task batch-create --file <json>` |

## Section-editing workflow

The dominant agent write pattern (hot path 2):

1. Generate the new section content to a temp file.
2. `spur task update <wbs> --section <name> --from-file <temp>` — the CLI writes it.
3. Remove the temp file.

This is the only sanctioned path for LLM-generated content to enter the corpus. The CLI
validates the section against the status-section matrix before writing.

**Body-only format** (avoids the corruption class fixed in task 0115):

- **Body-only:** the temp file is the section *body* only — no `## SectionName` heading line.
  The CLI adds the canonical heading (`### SectionName` for tasks). If the temp file starts with
  a heading matching the section name the CLI strips it, but write body-only from the start.
- **No same-level sub-headings:** never use `###` sub-headings inside a task section body (e.g.
  `### AC1 — …`). They sit at the canonical section level and would become phantom sections on
  re-parse; the CLI now strips them with a stderr warning, but write clean. Use bullet lists,
  tables, or `**bold**` labels for sub-structure instead.
- **Never suppress stderr:** run `spur task update` without `2>/dev/null`. Stderr carries the
  diagnostic (including the strip warnings above); suppressing it turns a fixable error into a
  silent exit-1 that wastes a round-trip.

## The section-status matrix

`spur task check <wbs> --json` returns the required and optional sections for the task's
current status. Agents ask "what does this task need now?" with zero tokens by reading the
`--json` output — no need to load and parse the matrix YAML.

## Check before write

Before editing any task file, run `spur task check <wbs>` to see what sections exist, what
is missing, and what format rules apply. The check is the single validation surface:
frontmatter schema, section-status matrix, section format rules, feature traceability.

After writing a section, run `spur task check <wbs>` again to confirm the write introduced no
structural issues (phantom sections, matrix violations) before moving on.
