---
schema_version: 1
name: Make the guard-parity harness enumerate both reference sets and catch spurious dependency edges
status: todo
template: feature-impl
created_at: 2026-09-17T17:41:13.770Z
updated_at: "2026-09-17T17:50:01.975Z"
feature_id: D62

---

## 0881. Make the guard-parity harness enumerate both reference sets and catch spurious dependency edges

### Background

Captured from the creation title: "Make the guard-parity harness enumerate both reference sets and catch spurious dependency edges".

### Requirements

- `plugins/sp/scripts/inline-pipeline-parity-check.ts` enumerates state from the pre-refactor reference set as well as the post-refactor one, so removing a reference cannot escape parity.
- An over-declared (spurious) `dependencies[]` edge is caught rather than silently unbound — post-0875 dependency edges no longer move the planning digest (`packages/app/src/services/task-readiness.ts:405`).

### Acceptance Criteria

- Harness test: deleted reference is caught; spurious `dependencies[]` edge is caught.
- `bun run spur-check` green.

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

- 2026-09-17T17:50:01.975Z backlog → todo (system)

