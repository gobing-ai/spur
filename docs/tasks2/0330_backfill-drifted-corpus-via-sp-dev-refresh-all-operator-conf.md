---
template: feature-impl
schema_version: 1
name: "Backfill drifted corpus via /sp:dev-refresh --all (operator-confirmed)"
description: ""
status: todo
type: task
profile: standard
feature_id: R1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0328", "0329"]
created_at: "2026-07-25T00:27:53.584Z"
updated_at: "2026-07-25T00:29:21.450Z"
---

## 0330. Backfill drifted corpus via /sp:dev-refresh --all (operator-confirmed)

### Background
One-time operator-confirmed backfill of the drifted corpus — the scenario that motivated the map (173 done tasks across 35 mostly-`backlog`/`active` features as of 2026-07-24; F2/F3/F5/H1–H3 et al. still `backlog`). Depends on the hook-wiring task and the `/sp:dev-refresh` command task.

This is a run task, not a code task: the deliverable is a clean, confirmed corpus.
### Requirements
- Run `/sp:dev-refresh --all` interactively; confirm/skip/override per item with the operator.
- Verify historically-drifted features (F2 Task management CLI, F3 Feature management CLI, F5 Execution pipeline, H1–H3 sp plugin skills, etc.) land at their derived statuses; L4-gate-blocked advances are reported, never forced.
- Orphan done tasks are linked via the confirm flow or explicitly skipped (persisted skip).
- After the sweep: `spur feature check` and `spur task check` clean; Board Features tree shows derived statuses.
- Record the sweep summary (applied / skipped / gate-blocked) in this task's Solution section.
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

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

R1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
