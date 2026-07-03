---
template: standard
schema_version: 1
name: "0176 Wave A: workflow correctness hardening"
description: ""
status: todo
type: task
profile: standard
feature_id: null
parent_wbs: "0176"
priority: P1
tags: []
dependencies: []
created_at: "2026-07-02T06:29:12.247Z"
updated_at: "2026-07-02T06:33:23.845Z"
---

## 0177. 0176 Wave A: workflow correctness hardening

### Background

Child task for 0176 Wave A. Fix workflow correctness findings F5, F6, and F7 before downstream dogfooding: side-effectful guards can duplicate task corpus writes, HITL answers are decorative, and literal shell substitutions appear in note/HITL strings.

### Requirements
- R1. Move `spur task batch-create` execution out of idea-pipeline transition guards into an idempotent action/sentinel path, with guards kept read-only.
- R2. Move retry-counter mutation out of transition guards into action-owned execution.
- R3. Route HITL answers in idea/planning pipeline approval states so yes/no/cancel lead to distinct reachable transitions.
- R4. Remove or materialize literal `$(cat ...)` strings in note/HITL messages.
- R5. Add regression coverage or a scripted proof that batch-create cannot be invoked more than once for one decomposition handoff.
- R6. Validate every touched workflow YAML and keep workflow tests green.
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
