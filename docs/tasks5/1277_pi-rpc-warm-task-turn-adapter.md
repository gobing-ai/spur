---
schema_version: 1
name: Pi RPC warm task-turn adapter
status: todo
template: feature-impl
created_at: 2026-10-22T07:00:34.914Z
updated_at: "2026-10-22T07:02:11.829Z"
feature_id: G74
priority: P2
tags:
  - fleet
  - performance

dependencies: ["1275"]
---

## 1277. Pi RPC warm task-turn adapter

### Background

Implements: R4 — Pi completes keyed tasks in a warm process.
Work package E4. Runs after the correlated task-turn seam. Candidate transport: Pi RPC JSON records over stdio.
Rubric: E6 D1 L2 C1 R1 = 11 → own task.

### Requirements

- [ ] R1. Record exact Pi executable provenance (PATH binary vs repository dependency versions).
- [ ] R2. Two related keyed tasks execute serially in one process with correlated terminal outcomes and validated artifacts.
- [ ] R3. Command acceptance responses are distinguished from completed agent activity; fragmented and interleaved records parse deterministically.
- [ ] R4. Unqualified versions keep session/one-shot fallback with a named reason.

### Acceptance Criteria

- [ ] AC1 — Pi completes keyed tasks in a warm process

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: RPC record reader with bounded buffering, correlating serialized turns to the single active turn.
Rejected: treating command response as completion.
Invariants: one active turn per worker; malformed framing rejected deterministically.

### Plan

1. Version qualification spike.
2. Adapter + fragmented-record fixture.
3. Process fixture E2E.
4. Opt-in real-agent trial row.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
