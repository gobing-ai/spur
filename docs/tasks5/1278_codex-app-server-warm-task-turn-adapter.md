---
schema_version: 1
name: Codex App Server warm task-turn adapter
status: todo
template: feature-impl
created_at: 2026-10-22T07:00:34.915Z
updated_at: "2026-10-22T07:02:12.222Z"
feature_id: G74
priority: P2
tags:
  - fleet
  - performance

dependencies: ["1275"]
---

## 1278. Codex App Server warm task-turn adapter

### Background

Implements: R5 — Codex completes keyed tasks through native thread and turn identity.
Work package E5. Runs after the correlated task-turn seam. Transport: Codex App Server stdio (initialize, thread/start|resume, turn/start, turn/completed).
Rubric: E7 D1 L2 C1 R1 = 12 → own task.

### Requirements

- [ ] R1. Qualify the installed Codex binary/version App Server sequence; record provenance.
- [ ] R2. Two related keyed tasks run as native turns in one process; thread and turn ids link to each validated task receipt.
- [ ] R3. Native failed and interrupted turn statuses can never become successful task results; cancellation awaits terminal evidence.
- [ ] R4. Unqualified versions keep exec-resume/one-shot fallback.

### Acceptance Criteria

- [ ] AC1 — Codex completes keyed tasks through native thread and turn identity

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: App Server client in the turn seam mapping turn/completed status to normalized outcomes.
Rejected: inferring identity from PID or stored thread.
Invariants: native ids recorded only when observed.

### Plan

1. Version qualification spike.
2. Adapter + status mapping.
3. Process fixture E2E (failed, interrupted, reconnect).
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
