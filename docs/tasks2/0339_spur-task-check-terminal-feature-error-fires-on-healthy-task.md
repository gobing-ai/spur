---
template: feature-impl
schema_version: 1
name: "spur task check: terminal-feature error fires on healthy tasks; content-free tasks pass"
description: ""
status: todo
type: task
profile: standard
feature_id: F2
parent_wbs: null
priority: P1
tags: ["cli", "gates", "task-check", "dogfood-followup"]
dependencies: []
created_at: "2026-07-26T23:50:31.157Z"
updated_at: "2026-07-26T23:50:31.163Z"
---

## 0339. spur task check: terminal-feature error fires on healthy tasks; content-free tasks pass

### Background

Two L3/L4 verdict defects in `packages/app/src/services/task-check.ts`, both surfaced by the 2026-07-26 `/sp:dev-verifyall --feature R2` dogfood (`docs/dogfood/2026-07-26-dev-verifyall-dogfood.md`, findings P1 and the follow-up analysis).

**(a) Terminal-feature error fires regardless of the task's own status.** `task-check.ts:477` pushes an `error`-severity `L4_FEATURE_TERMINAL` finding — "Feature X is done — remove or re-parent this task" — whenever the linked feature's status is `done` or `cancelled`, without consulting the task's own status. The normal, healthy terminal state of any completed feature (feature done + all its tasks done) therefore FAILs every one of its tasks, and the remedy the message proposes (unlink the tasks) would destroy exactly the traceability the corpus exists to hold. This is repo-wide and pre-existing, not specific to one feature: verified on task 0320 under done feature Q, and on all seven tasks under R2 the moment R2 reached `done`.

**(b) A content-free task passes the gate.** Task 0337 had `### Background`, `### Requirements`, and `### Acceptance Criteria` bodies consisting solely of template placeholder comments — the AC placeholder literally reads "Do not leave placeholder AC here" — and `spur task check 0337` still returned `0337 (todo): PASS` with zero findings. A task with no requirements is unverifiable by construction, so the gate meant to catch this is blind to it.

### Requirements
R1. Restrict the `L4_FEATURE_TERMINAL` finding at `packages/app/src/services/task-check.ts:477` so it fires only when the task's **own** status is non-terminal. A `done` or `cancelled` task under a `done` or `cancelled` feature is the correct end state and must not produce an error.

R2. Keep the existing signal for the case the rule was written for: a live task (`backlog`/`todo`/`wip`/`testing`/`blocked`) parented to a terminal feature must still be flagged, since that genuinely needs re-parenting.

R3. Add an L3 finding that fails a task whose `### Requirements` or `### Acceptance Criteria` body is empty or consists only of template placeholder comments (HTML comments and whitespace). Reproduce against 0337, which must move from PASS to FAIL.

R4. Do not weaken any existing check to achieve R1 — the fix is a narrower predicate, not a removed rule.

R5. Regression tests in `packages/app/tests/services/task-check.test.ts` covering: terminal task under terminal feature (no error), live task under terminal feature (error retained), placeholder-only Requirements (fail), placeholder-only AC (fail), populated task (pass).

R6. Re-run `spur task check` across the R2 set (0332-0338) and confirm the six non-cancelled tasks return PASS.
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

F2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
