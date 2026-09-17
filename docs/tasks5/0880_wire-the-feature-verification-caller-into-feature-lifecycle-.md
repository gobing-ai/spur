---
schema_version: 1
name: Wire the feature verification caller into feature-lifecycle and drop the settled-tree precondition
status: todo
template: feature-impl
created_at: 2026-09-17T17:41:13.462Z
updated_at: "2026-09-17T17:50:01.646Z"
feature_id: D62

---

## 0880. Wire the feature verification caller into feature-lifecycle and drop the settled-tree precondition

### Background

Captured from the creation title: "Wire the feature verification caller into feature-lifecycle and drop the settled-tree precondition".

### Requirements

- Deliver the `feature-verification` caller so a feature whose `verifying→done` guard requires the pass can reach done without a hand-run command (`config/workflows/feature-lifecycle.yaml:71` reads the status file; nothing invokes `feature-verification`).
- Assert the guard's declaration order, not only its kind set.
- Settled-tree precondition (DECIDED: drop) — remove the clause from the contract rather than enforce it; nothing consumes it.

### Acceptance Criteria

- Caller wired and tested (a feature reaches `done` through the guard via the caller).
- Guard-order assertion test.
- Contract clause removed with same-commit doc sync (T3 satellite); `bun run spur-check` green.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

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

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T17:50:01.646Z backlog → todo (system)

