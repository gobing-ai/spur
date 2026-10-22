---
schema_version: 1
name: Correlated keyed task-turn seam with fencing and fallback
status: todo
template: feature-impl
created_at: 2026-10-22T07:00:34.912Z
updated_at: "2026-10-22T07:02:10.845Z"
feature_id: G74
priority: P1
tags:
  - fleet
  - performance

dependencies: ["1273"]
---

## 1275. Correlated keyed task-turn seam with fencing and fallback

### Background

Implements: R6 — Warm process reuse preserves independent review and executor policy; R7 — Uncertain accepted work is reconciled without duplicate side effects; R8 — Unsupported capabilities retain an explicit compatible fallback.
Work packages E2 (Spur side) + E6. Design: docs/design/fleet-task-turn-execution.md §3-5; ADR-145.
Prerequisite: a released ts-ai-runner correlated-turn facade. Inspect the installed package first; if insufficient, record the exact upstream contract and leave this task blocked — external ts-libs edits need separate operator authorization.
Rubric: E14 D1 L3 C2 R2 = 22 → decompose (force: R=high); this is the shared seam, adapters are separate tasks.

### Requirements

- [ ] R1. Route keyed requests for a persistent member through a correlated turn on a policy-compatible warm worker, dispatched via AgentRunActionRunner/runFleetWorkItem so artifact and action-contract checks stay the sole success authority.
- [ ] R2. Persist acceptance, native terminal outcome (success/failure/interrupted/not-started/outcome-unknown) and validated completion separately, pinned to execution, request, attempt, member, owner epoch and occupant generation.
- [ ] R3. Reuse a worker only when model/provider/reasoning, tools, permissions, workspace and role match; independent review always starts a fresh conversation.
- [ ] R4. Outcome-unknown writing work stays uncertain until durable evidence resolves it; late/foreign/stale-generation events are diagnostic only and never certify success or release a new write lease.
- [ ] R5. Before acceptance, unsupported persistence or an unavailable facade falls back to verified resume then one-shot with a named reason; no duplicate transport code enters Spur.

### Acceptance Criteria

- [ ] AC1 — Warm process reuse preserves independent review and executor policy
- [ ] AC2 — Uncertain accepted work is reconciled without duplicate side effects
- [ ] AC3 — Unsupported capabilities retain an explicit compatible fallback

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: a thin Spur-side turn adapter over the released runner facade, plugged into the existing keyed branch of runDrain; MemberSession tracks reuse eligibility and reset.
Rejected: direct stdin reuse (acceptance is not completion); a separate persistent workflow executor (duplicates validation/recovery); vendoring a runner copy.
Invariants: one active task turn per worker; one writer per worktree; durable inbox is the only coordination transport.

### Plan

1. Qualify the installed ts-ai-runner surface against design §4; record result.
2. Write failure cases (accepted-then-crash, duplicate terminal, stale generation, policy change, quota refusal, permission wait).
3. Implement turn adapter + receipt fields + fallback ladder.
4. Deterministic protocol-fixture E2E for every failure case.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
