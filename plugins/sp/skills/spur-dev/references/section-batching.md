---
name: section-ownership
description: One writer per evidence section — which stage authors Solution, Testing, and Review, and how a session sequences section writes against the runtime contract.
see_also:
  - spur-dev
  - spur-cli
  - super-reviewer
---

# Evidence-section writer protocol

There is exactly **one writer per evidence section** (feature F92, task 0593 R1). The section
matrix is the runtime authority for *which sections are permitted at a status*; this protocol is
the *who writes* map. The canonical stage registry projects the exact artifact identities
(`packages/domain/src/stage-registry/schema.ts` → `RECORDED` stage `identity` fields); skills never
restate that ownership as competing policy.

| Section | Writer | When |
| --- | --- | --- |
| `## Solution` | **implement** (`sp:code-implementation`) | during the implement step; bare-only safety-net backfill by `record` from `git diff` |
| `## Review` | **review coordinator** (`sp:super-reviewer` under `/sp:dev-review`) | during the review step, after merging component fragments |
| `## Testing` | **`spur task record`** (deterministic, from the verdict artifact) | during the record step; never authored by hand |

Component review skills (`sp:functional-review`, `sp:code-verification` review mode,
`sp:code-improvement`) **return review fragments only** in coordinated mode — they do not write
`## Review`. Verification emits the canonical verdict artifact; it does not write sections.
`record`'s bare-`## Review` backfill is a **standalone compatibility fallback only** — it fires
when the section is bare (absent/placeholder) and never overwrites authored Review.

## Sequencing a write

1. Query the runtime contract before writing — never a static table:
   `spur task sections <wbs> list --json` (permitted sections at the current status) and
   `spur task check <wbs> --json` (what the gate requires at the current status).
2. Write only your stage's section, via
   `spur task update <wbs> --section <name> --from-file <tmp>` (CLI-gated, body-only).
3. Re-check once after the write batch: `spur task check <wbs> --json`.

Budget: no more than two section writes per section and two task checks per task unless a new
external failure changes the evidence. Do not use a write→check loop for each section.
