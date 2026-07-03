---
template: standard
schema_version: 1
name: "0176 Wave B: decomposition wiring and parent readiness"
description: ""
status: todo
type: task
profile: standard
feature_id: null
parent_wbs: "0176"
priority: P2
tags: []
dependencies: []
created_at: "2026-07-02T06:29:12.249Z"
updated_at: "2026-07-02T06:33:27.925Z"
---

## 0178. 0176 Wave B: decomposition wiring and parent readiness

### Background

Child task for 0176 Wave B. Fix decomposition wiring findings F1 and F2: roster automation exists but is unwired, decomposed parents remain executable todo tasks, and ready resolution can pick umbrella parents.

### Requirements
- R1. Make batch-created child tasks refresh the parent sub-task roster for each distinct `parent_wbs` after atomic creation.
- R2. Transition decomposed parents from `todo` to `wip` through lifecycle-aware code, surfacing guard denials clearly.
- R3. Exclude parent tasks with open children from the `ready` batch selector documented in `execution-batch.md`.
- R4. Update decomposition and planning skill prose to describe shipped roster automation and the shipped roll-up gate.
- R5. Add service/CLI coverage proving parent roster refresh is idempotent after batch creation.
### Acceptance Criteria

<!-- Given/When/Then scenarios or a checklist derived from Requirements. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
