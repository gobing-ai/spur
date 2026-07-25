---
template: feature-impl
schema_version: 1
name: "Normalize legacy 'Done' task statuses to canonical done"
description: ""
status: todo
type: task
profile: standard
feature_id: R1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-25T00:27:56.004Z"
updated_at: "2026-07-25T00:29:26.326Z"
---

## 0331. Normalize legacy 'Done' task statuses to canonical done

### Background
Corpus hygiene split out of the backfill scope: 12 tasks carry legacy status `Done` instead of the canonical `done` (observed 2026-07-24 via `spur task list --json | jq` group-by). Mixed case breaks status grouping and any derivation that compares against the canonical enum (`packages/domain/src/planning/schema.ts:26` area).
### Requirements
- Enumerate tasks with frontmatter status `Done` (12 as of 2026-07-24).
- Normalize each to `done` through the CLI (`spur task update <wbs> done`; use `SPUR_PROVENANCE_OVERRIDE=1` only where the provenance gate blocks — the bypass is recorded).
- Verify: `spur task list --json` group-by shows a single `done` bucket; `spur task check` clean.
- If the case anomaly has a code source (migration / importer writing `Done`), file or fix the root cause in the same task.
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
