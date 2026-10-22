---
schema_version: 1
name: Conversation-independent orchestrator scheduling tick
status: todo
template: feature-impl
created_at: 2026-10-22T07:00:34.912Z
updated_at: "2026-10-22T07:00:35.102Z"
feature_id: G74
priority: P1
tags:
  - fleet
  - performance

---

## 1274. Conversation-independent orchestrator scheduling tick

### Background

Implements: R2 — Task dispatch progresses during an orchestrator conversation.
Work package E1. Observed: packages/app/src/services/agent-loop-service.ts awaits runDrain({replyInstruction}) before strategyRuntime.observe/tick, so a long chat delays dispatch.
No dependency on the runner facade; independently useful.
Rubric: E5 D1 L1 C1 R1 = 9 → own task.

### Requirements

- [ ] R1. The orchestrator conversation drain runs with its own in-flight state and never blocks the observe/tick loop.
- [ ] R2. Wakes arriving during a held conversation coalesce and rerun selection after the current tick; no concurrent ticks, no lost arrivals.
- [ ] R3. One fenced scheduling owner (owner epoch) remains; shutdown bounds both consumers.
- [ ] R4. Deterministic E2E: a 30-second held conversation with a newly runnable task dispatches it with p95 at most 1 second and no duplicate dispatch.

### Acceptance Criteria

- [ ] AC1 — Task dispatch progresses during an orchestrator conversation

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: start the orchestrator drain as a tracked promise (single in-flight), keep the wake loop running observe/tick each wake; serialize tick/observe only among themselves.
Rejected: scheduling once before the blocking chat (later arrivals still stall); replacing 100 ms ledger polling before measurement.
Invariants: one scheduling owner, strategy epochs, rest/idle hold semantics, ledger flush per pass.

### Plan

1. Enumerate failure cases (drain throws mid-tick, owner lost during chat, shutdown during chat, double wake).
2. Split drain from tick in agent-loop-service.
3. Deterministic held-chat E2E with latency assertion.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
