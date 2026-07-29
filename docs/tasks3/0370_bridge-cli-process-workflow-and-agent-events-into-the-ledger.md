---
template: feature-impl
schema_version: 1
name: "Bridge CLI-process workflow and agent events into the ledger via the task-0249 direct-DAO pattern"
description: ""
status: todo
type: task
profile: standard
feature_id: J3
parent_wbs: null
priority: P0
tags: ["observability", "cli-bridge", "data-plane"]
dependencies: ["0367", "0369"]
created_at: "2026-07-29T00:14:03.018Z"
updated_at: "2026-07-29T00:25:23.948Z"
---

## 0370. Bridge CLI-process workflow and agent events into the ledger via the task-0249 direct-DAO pattern

### Background

The ledger holds zero `workflow.*` and zero `agent.*` rows — ever — while the same database holds 390 rows in `runs` and 501 in `action_runs`. The work happened; the events did not survive. Cause is Gap 4 in docs/inventory/system-events-producer-audit.md: workflow and agent execution runs in the CLI process, whose EventBus is process-local and never reaches the server tap. Task 0249 already solved this exact problem for `task.*` and `feature.*` by having the CLI write through `SystemEventEmitter` to `SystemEventDao` directly (audit table rows 1-6, emit sites task.ts:612 and feature.ts:366). This task extends that proven path to the workflow and agent families, which is what finally makes task 0365's entire observability investment visible on the Board. Operator decision on 2026-07-28 selected this over server-side ingestion of the .spur/runs/workflow/*.jsonl traces; those traces remain the CLI-side replay artifact.

### Requirements
- [ ] R1. Route cataloged `workflow.*` and `agent.*` events emitted in the CLI process through the `SystemEventEmitter` → `SystemEventDao` path, mirroring the task-0249 wiring.
- [ ] R2. Preserve 0365 redaction and payload bounds ahead of every write; no raw prompt, command, environment value, or output chunk reaches the ledger.
- [ ] R3. Persist the envelope's correlation fields so a CLI-driven run is joinable to its `runs` row by run id.
- [ ] R4. Emit exactly one lifecycle series per agent execution — a workflow-dispatched `agent.run` must not double-count against the direct `spur agent run` path (the 0365 R9 invariant).
- [ ] R5. A ledger write failure must be logged and swallowed; a workflow run must never fail because observability persistence failed.
- [ ] R6. Respect the tier decisions from the catalog task — diagnostic-tier lifecycle members stay out of the ledger unless the toggle is on.
- [ ] R7. Update the producer audit table's status column for the newly-reachable entries and narrow the Gap 4 note to the residual child-of-child case.
### Acceptance Criteria
```gherkin
Scenario: R12 — A CLI-driven workflow run becomes visible on the data plane
Scenario: R13 — Agent lifecycle from a CLI run is correlated, not double-counted
Scenario: R14 — A ledger write failure never breaks the CLI run
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
