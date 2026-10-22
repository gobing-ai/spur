---
schema_version: 1
name: Guest lease renewal and exact agent process identity
status: todo
template: feature-impl
created_at: 2026-10-22T07:00:38.139Z
updated_at: "2026-10-22T07:00:38.221Z"
feature_id: G75
priority: P1
tags:
  - fleet
  - performance

---

## 1279. Guest lease renewal and exact agent process identity

### Background

Implements: R1 — A live session keeps exact identity and its lease throughout active work.
Work package B1. Design: docs/design/fleet-attached-occupants.md §3; ADR-146. Evidence: apps/cli/src/commands/agent/join.ts, wait.ts; packages/app/src/services/fleet-guest-service.ts; packages/domain/src/dao/project-claim-dao.ts.
No dependency on G74; useful guest hardening on its own.
Rubric: E6 D1 L2 C1 R1 = 11 → own task.

### Requirements

- [ ] R1. A bounded renewal owner keeps a 30-second guest lease alive through 90-second work with no inbox wait, using the existing lease DAO epoch fence.
- [ ] R2. Record the actual agent process identity (PID plus birth/executable fingerprint where the host exposes it); the short-lived CLI PID never implies agent liveness.
- [ ] R3. Renewal stops on identity loss, fence failure or explicit leave; PID reuse or process death cannot transfer the identity.
- [ ] R4. Same proven session rejoins idempotently; a colliding identity is refused; existing join/wait/leave defaults unchanged.

### Acceptance Criteria

- [ ] AC1 — A live session keeps exact identity and its lease throughout active work

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: parent-watched renewal helper started by the participation skill / host integration, reusing project-claim-dao fencing.
Rejected: a new always-on daemon; killing or adopting an unrelated PID.
Invariants: leases and message claims stay separate; guests remain message-only.

### Plan

1. Enumerate failure cases (TTL overrun, PID reuse, parent death, fence loss, collision).
2. Renewal helper + identity fingerprint.
3. E2E: 90-second job beyond TTL, crash and leave release.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
