---
schema_version: 1
name: Fenced declared-member binding via agent join --member
status: todo
template: feature-impl
created_at: 2026-10-22T07:00:38.145Z
updated_at: "2026-10-22T07:18:15.369Z"
feature_id: G75
priority: P2
tags:
  - fleet
  - performance

dependencies: ["1279"]
---

## 1281. Fenced declared-member binding via agent join --member

### Background

Implements: R3 — A capable live session binds one declared member without changing guest defaults.
Work package B3. Additive public flag on the existing spur agent join. Public-surface consent: given by the operator (Robin) on 2026-10-22 for the additive `--member` flag only — no new noun or verb (AGENTS.md public-surface rule). Runs after the lease renewal task.
Rubric: E8 D1 L3 C1 R2 = 15 → own task (force: R=high).

### Requirements

- [ ] R1. spur agent join --member <id> resolves one enabled declared member in the normalized project and validates role, executor policy and a current capability proof.
- [ ] R2. Exactly one fenced occupant binds per member (occupancy generation + lease epoch); competing, mismatched or stale binders are refused and leave no orphan binding.
- [ ] R3. Bound pull resolves to the declared member inbox with epoch checks on claim, acceptance, completion and renewal; guest-only pull is unchanged.
- [ ] R4. Guests stay concrete-address message participants excluded from role selection and requiresCapabilities.

### Acceptance Criteria

- [ ] AC1 — A capable live session binds one declared member without changing guest defaults

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: extend FleetGuestService with the atomic binding transition; reuse existing DAO fencing; versioned private discovery record.
Rejected: mixing guests into resolveAgentSelector; PID-based takeover; schema migration unless the existing DAO cannot fence (justify in Solution).
Invariants: one binding and one active task per member; no dual writers.

### Plan

1. Record public-surface consent for --member.
2. Failure cases (race, wrong project/session, stale generation).
3. Binding transition + CLI flag + help + skill/adapter contract.
4. E2E competing binders.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
