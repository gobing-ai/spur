---
template: feature-impl
schema_version: 1
name: "Expose the workflow run store as a read API for run digest, phase progress, and action log"
description: ""
status: todo
type: task
profile: standard
feature_id: J3
parent_wbs: null
priority: P0
tags: ["observability", "api", "run-store", "data-plane"]
dependencies: []
created_at: "2026-07-29T00:14:03.040Z"
updated_at: "2026-07-29T00:25:31.251Z"
---

## 0373. Expose the workflow run store as a read API for run digest, phase progress, and action log

### Background

The real record of what a task's pipeline did lives in the run store — `runs` (390 rows), `phase_runs`, `transition_runs`, `action_runs` (501 rows, each with node, kind, status, duration_ms, ok, result_json), and `task_run_links` (412 rows joining WBS to run id). This data is durable, correlated, and already written by CLI-driven runs, unlike the event ledger. It has no HTTP surface at all, and the Board consumes none of it: the server exposes only /api/jobs/stats, /api/observability/*, /api/team/*, /api/events/*, and the task/feature modules. The operator asked for a task digest with progress and log; this run store is the only source that actually has it, and the 2026-07-28 decision selected it as the primary backing for the J4 Tasks tabview.

### Requirements
- [ ] R1. Add a runs list endpoint returning run id, workflow name, status, mode, agent, started-at, and completed-at, with paging and status filtering.
- [ ] R2. Add a run detail endpoint returning the run's ordered phases with status, its transitions with from/to/trigger, and its actions with node, kind, status, duration, ok, and a trace-safe result summary.
- [ ] R3. Add a WBS lookup returning every linked run with its link kind, and an empty list — not an error — for a WBS with no links.
- [ ] R4. Return a clean not-found with a reason for an unknown run id; never a partial or fabricated run object.
- [ ] R5. Keep the transport thin: query logic belongs in the domain DAOs and the application layer per ADR-021, and apps/server must not import ts-db.
- [ ] R6. Apply the same redaction discipline as the event path to any `result_json` content crossing the wire.
- [ ] R7. Document the new surface in docs/04_DESIGN.md in the same commit as the code, per the T3 same-commit rule.
### Acceptance Criteria
```gherkin
Scenario: R22 — Runs are listable with their status and workflow
Scenario: R23 — A run's phases, transitions, and actions are readable as one detail view
Scenario: R24 — A task's runs are reachable by WBS
Scenario: R25 — Run detail for an unknown run id is a clean not-found
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

J3

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
