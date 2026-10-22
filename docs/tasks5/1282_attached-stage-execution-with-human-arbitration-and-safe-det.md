---
schema_version: 1
name: Attached stage execution with human arbitration and safe detach
status: todo
template: feature-impl
created_at: 2026-10-22T07:00:38.146Z
updated_at: "2026-10-22T07:17:17.742Z"
feature_id: G75
priority: P2
tags:
  - fleet
  - performance

dependencies: ["1281", "1275"]
---

## 1282. Attached stage execution with human arbitration and safe detach

### Background

Implements: R4 — Human work retains session ownership until an explicit safe yield; R5 — Attached stages produce the same validated receipts as supervised stages.
Work packages B4 + B5. Depends on the G74 correlated keyed task-turn seam and the declared-member binding task.
Rubric: E10 D1 L3 C2 R2 = 18 → own task (force: R=high).

### Requirements

- [ ] R1. Readiness ready/busy/blocked/draining is explicit; a human turn starts busy and only a safe yield plus completed handshake advertises ready.
- [ ] R2. No fleet turn is injected into a busy human turn; operator-answer waits keep tasks queued.
- [ ] R3. A ready occupant runs keyed stages through the G74 turn contract; only current correlated completion with valid artifacts succeeds; a delivered message never completes a stage.
- [ ] R4. Detach drains, stops new assignment, preserves outcome-unknown work for reconciliation and never kills the human-owned process; late results after lease transfer are diagnostic only.

### Acceptance Criteria

- [ ] AC1 — Human work retains session ownership until an explicit safe yield
- [ ] AC2 — Attached stages produce the same validated receipts as supervised stages

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: occupant readiness on the binding record consumed by the existing selector/dispatcher; stage execution reuses the G74 seam with the member pin.
Rejected: native steering for ordinary arrivals; a second scheduler.
Invariants: reviewer independence, worktree write controls and executor attestation unchanged.

### Plan

1. Failure cases (busy, blocked input, disconnect after acceptance, late completion, detach during work).
2. Readiness + arbitration.
3. Attached stage dispatch via G74 seam.
4. E2E for each failure case.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
