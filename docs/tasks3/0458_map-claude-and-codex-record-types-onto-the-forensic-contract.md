---
template: feature-impl
schema_version: 1
name: "Map claude and codex record types onto the forensic contract"
description: ""
status: cancelled
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0455"]
created_at: "2026-08-06T23:09:54.320Z"
updated_at: "2026-08-06T23:29:59.070Z"
---

## 0458. Map claude and codex record types onto the forensic contract

### Background
**Wayfinder ticket** — type: `wayfinder:research`. Map: feature E1. **Blocked by 0455** (needs the
target record shape to map onto).

**The question:** For claude and codex — the two highest-volume sources — which record types carry
forensic signal, and what is the field-by-field mapping onto the contract 0455 settles?

**Why it is open.** Measured yield is 826/90,411 for claude and 2,141/224,055 for codex — ~1%. The
loss is not a bug in one field; the generic flat `sourceDefinition` requires top-level
`content: string` and claude nests everything under `message.{model,usage,content[]}`.

Claude Code record types observed in one session file (400 lines): `mode` 18, `attachment` 158,
`user` 64, `system` 3, `last-prompt` 17, `assistant` 131, `file-history-snapshot` 3,
`file-history-delta` 4, `ai-title` 2. Only some carry conversation; `attachment` alone is 40% of
lines. An assistant record's `message` carries `model`, `id`, `role`, `content[]`, `stop_reason`,
`usage`, `diagnostics`; `usage` includes cache-creation and cache-read token counts and a nested
`iterations[]` array.

**Sub-questions:**

- Per source, per record type: keep, drop, or fold into an adjacent record? Justify each drop —
  `attachment` and `file-history-*` may be exactly what explains a slow session.
- Where do tool calls live, and how is a `tool_use` block paired with its `tool_result`? Claude
  carries `toolUseID` / `sourceToolUseID` / `toolUseResult` — establish the join.
- Per-step duration: `durationMs` appears on some records. On which, and is it reliable enough to
  build a report on, or must duration be derived from timestamps?
- Which usage numbers are authoritative when `usage.iterations[]` disagrees with the top-level
  counts?
- Codex: run the same breakdown. Its 221,911 validation errors need a type census before any
  mapping is proposed.
- What fraction of lines *should* survive a correct mapping? State the expected yield so 0455's
  contract can be judged against a number, not a feeling.

**Resolved when** the task body carries a per-source, per-record-type disposition table and a field
map onto the 0455 contract, plus the expected post-fix yield for each source.

**Method:** `sp:source-driven-development` — census real files on disk. Sample across projects and
dates; formats drift between agent versions (claude records carry a `version` field — check whether
the shape changed under it).
### Requirements
- R1 — Produce a per-record-type disposition table for claude and codex: keep, drop, or fold, with a justification for each drop.
- R2 — Establish the join between a tool_use block and its tool_result, using claude`s toolUseID / sourceToolUseID / toolUseResult fields.
- R3 — Determine whether per-step duration can be read from a field (claude carries durationMs on some records) or must be derived from timestamps.
- R4 — Produce a field map from each source onto the forensic contract settled in 0455.
- R5 — State the expected post-fix import yield per source, so the mapping can be judged against a number rather than an impression.
### Acceptance Criteria
```gherkin
Feature: 0458 wayfinder investigation

  Scenario: R1 — claude and codex map onto the forensic contract
    Given the forensic record contract from 0455 and real transcripts sampled across projects and dates
    When ticket 0458 is resolved
    Then the task body carries a per-record-type disposition table for both sources
    And the tool_use to tool_result join is stated concretely
    And an expected post-fix yield is stated per source
    And format drift across agent versions is checked, not assumed absent
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

E1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-06T23:29:59.070Z todo → cancelled (system)
