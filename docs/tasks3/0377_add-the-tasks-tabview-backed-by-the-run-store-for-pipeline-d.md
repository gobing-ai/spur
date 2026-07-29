---
template: feature-impl
schema_version: 1
name: "Add the Tasks tabview backed by the run store for pipeline digest, phase progress, and action log"
description: ""
status: todo
type: task
profile: standard
feature_id: J4
parent_wbs: null
priority: P0
tags: ["board", "web", "observability", "run-store"]
dependencies: ["0373"]
created_at: "2026-07-29T00:15:02.357Z"
updated_at: "2026-07-29T00:25:40.954Z"
---

## 0377. Add the Tasks tabview backed by the run store for pipeline digest, phase progress, and action log

### Background

The operator asked for a task digest with progress and log, noting the Tasks module shows task detail but never pipeline progress. That data has never been on the Board: it lives in the run store (390 runs, 501 action runs with node/kind/status/duration, 412 task_run_links joining WBS to run id) which had no HTTP surface until J3's runs API. Building this on the event ledger instead — the obvious symmetry with the Jobs tab — would yield almost nothing, because `task.*` is 9 percent of a heavily-evicted ledger and carries only status flips, no phase or action detail. The 2026-07-28 decision therefore made the run store the primary backing, with corpus events as a secondary lane so CLI-only edits that never triggered a run are not lost.

### Requirements
- [ ] R1. List pipeline runs with their linked task WBS, workflow name, status, and start time, including runs with no task link.
- [ ] R2. Expand a run into its ordered phase progress, distinguishing the active phase from completed and failed ones.
- [ ] R3. Show the per-action log for a run with node, kind, status, and duration, and the reason for a failed action.
- [ ] R4. Provide a secondary lane of `task.*` and `feature.*` corpus events for work with no associated run, visually distinguishable from run-backed activity.
- [ ] R5. Degrade per-row: a run whose detail request fails or returns not-found shows an inline error while the rest of the list stays usable.
- [ ] R6. Follow the module's existing tab contract — append to `OBSERVABILITY_TABS` as data with a stable id, without modifying the shell.
- [ ] R7. Apply the same untrusted-input narrowing discipline used by the other tabs to the new runs API responses.
### Acceptance Criteria
```gherkin
Scenario: R13 — Pipeline runs are listed with their task and status
Scenario: R14 — A run expands into phase progress
Scenario: R15 — A run's action log is readable
Scenario: R16 — Corpus-only task activity is not lost
Scenario: R17 — A run whose detail is unavailable degrades gracefully
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

J4

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
