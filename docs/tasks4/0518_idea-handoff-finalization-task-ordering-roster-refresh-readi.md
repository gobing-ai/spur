---
template: feature-impl
schema_version: 1
name: "Idea handoff finalization: task ordering, roster refresh, readiness-gated recommendation"
description: ""
status: todo
type: task
profile: standard
feature_id: I2
parent_wbs: null
priority: P2
tags: ["idea", "workflow", "plugins/sp"]
dependencies: ["0515"]
ac_numbering: task-local
created_at: "2026-08-11T22:25:19.890Z"
updated_at: "2026-08-11T22:26:22.924Z"
---

## 0518. Idea handoff finalization: task ordering, roster refresh, readiness-gated recommendation

### Background

Split from task 0515 (feature I2, decomposition 2026-08-11): the post-batch handoff machinery. 0515 keeps the Goal/Scope guidance and design-review feedback contract; 0519 adds the regression tests and no-surface guard. This task owns what happens after idea-pipeline batch creation: encode declared ordering via a run-scoped sidecar applied through `spur task deps`, refresh the feature roster, and generate a readiness-gated handoff report that replaces the static runall recommendation.

Implements feature I2 scenario R14 (Idea handoff is safe to execute). Ordering: after 0515 (builds on the guidance contract); before 0519 (the regression tests cover this machinery).

Rubric: E3 D1 L1 C0 R0 = 5 → split (parent scored 5+; size gate: 7 R-items > cap 5).

### Requirements
- [ ] R1. When decomposition declares ordering, emit a run-scoped order sidecar and apply it after batch creation through existing `spur task deps`; missing or ambiguous title-to-WBS resolution fails before handoff.
- [ ] R2. Refresh the feature roster after successful batch creation.
- [ ] R3. Check every created task and generate a run-scoped handoff report that recommends `/sp:dev-refineall --feature <id> --auto --depth ready` when any task is unready; recommend runall only when all task checks pass.
### Acceptance Criteria
```gherkin
Feature: Safe idea-pipeline planning handoff
  Scenario: R1 — Idea handoff is safe to execute
    Given decomposition emits a non-empty task-order sidecar
    When batch creation succeeds
    Then each dependency is applied with spur task deps or the pipeline fails before handoff

  Scenario: R2 — Idea handoff is safe to execute
    Given task batch creation succeeds
    When post-create finalization completes
    Then spur feature refresh has regenerated the feature task roster

  Scenario: R3 — Idea handoff is safe to execute
    Given at least one created task fails spur task check
    When the handoff report is generated
    Then it recommends ready-depth refineall and does not recommend runall
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
The order sidecar is a private run-scoped artifact (`.spur/run/<runId>-task-order.json`) mapping decomposed titles to WBS; applied via the existing `spur task deps` verb after batch-create. Roster refresh reuses `spur feature refresh`. The handoff report gates the recommendation: refineall-when-unready, runall-only-when-clean. Rejected: a new CLI finalizer verb (no-surface constraint); inlining ordering into batch-create (the task-batch schema has no ordering field).
### Plan
- [ ] Emit the private task-order sidecar; fail on missing/ambiguous title-to-WBS resolution.
- [ ] Apply dependencies after batch creation with `spur task deps`.
- [ ] Refresh the feature roster and check the frozen created-WBS set.
- [ ] Generate the conditional handoff report; replace the static runall recommendation.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

I2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
