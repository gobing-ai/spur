---
template: meta
schema_version: 1
name: "Workflow run-log observability doc sync"
description: ""
status: todo
type: meta
profile: standard
feature_id: D2
parent_wbs: null
priority: P2
tags: ["docs", "sync", "observability", "workflow"]
dependencies: ["0426", "0427", "0428", "0429"]
created_at: "2026-08-04T17:25:04.948Z"
updated_at: "2026-08-04T18:35:54.628Z"
---

## 0430. Workflow run-log observability doc sync

### Background

Feature D2 — same-change doc sync (constitution T8/T9/T4). The ADR-045 entry, `docs/03_ARCHITECTURE.md §6.1`, the `docs/design/workflow-run-log.md` satellite, and its `docs/04_DESIGN.md` index row already exist as accepted-design artifacts. This task reconciles the design doc and 04 surface with the shipped surface, refreshes feature D2 status, and confirms spur-cli parity holds end-to-end after the CLI tasks land.

Covers: constitution §4.5 rule 5 (detail-first), §6.5, §6.7, and ADR-038 parity closure for the batch.

Rubric: E1 D1 L1 C0 R0 = 3 → decompose (child of parent score 14; meta doc-sync is a scheduled T8 item).

### Requirements
- [ ] R1. Verify `docs/design/workflow-run-log.md` matches the shipped surface (log contract, flags, retention threshold).
- [ ] R2. Sync `docs/04_DESIGN.md` workflow signatures, index row, and version to the shipped flags; keep ADR-045/03 §6.1 consistent.
- [ ] R3. Refresh feature D2 status and the `docs/05_FEATURES.md` index (T4) after the code tasks land.
- [ ] R4. Confirm ADR-038 spur-cli parity (CLI ↔ reference) holds end-to-end across the batch.
- [ ] R5. No task or feature corpus files are written directly — every corpus change goes through `spur task`/`spur feature`.
### Acceptance Criteria
Doc-sync completion conditions. Deliberately not expressed as BDD scenarios or a checklist: this
task verifies documentation parity, not runtime behavior, so it maps to no feature scenario in D2 —
encoding it as one would assert false coverage over a behavior this task does not exercise.

**Done when all of the following hold, each with cited evidence:**

- `docs/design/workflow-run-log.md` describes the surface as shipped — the log path and lifecycle,
  the `--no-log` flag, the `trace --follow --output` source, and the retention threshold — with no
  statement contradicting the merged code.
- `docs/04_DESIGN.md` carries the shipped `spur workflow run` / `trace` / `clean` signatures, its
  index row for the workflow noun, and a bumped version; ADR-045 and `docs/03_ARCHITECTURE.md §6.1`
  remain consistent with it (lower number wins on conflict per the constitution).
- Feature D2 status and the `docs/05_FEATURES.md` index (T4) reflect the landed batch, refreshed via
  `spur feature sync` rather than a hand edit.
- ADR-038 spur-cli parity holds end to end: the `sp:spur-cli` workflow reference matches the real CLI
  surface for every flag this batch added, and the parity test passes.
- No task or feature corpus file was written directly — every corpus change in this batch went
  through `spur task` / `spur feature`, verifiable from the command history.
- `bun run lint` and `bun run test` are green at the point this task closes, with the standing
  sandbox-only network failures identified as such rather than silently accepted.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Approach and tradeoffs for process/docs/config changes. Keep this short. -->

### Plan

<!-- Ordered checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
