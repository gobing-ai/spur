---
schema_version: 1
name: Dispatch to a named fleet member with no daemon running
status: todo
template: feature-impl
created_at: 2026-11-15T04:02:03.790Z
updated_at: "2026-11-15T04:02:03.860Z"
feature_id: G8
priority: P1
tags:
  - agent
  - fleet
  - dispatch
  - usability
estimate_hours: 10

---

## 1333. Dispatch to a named fleet member with no daemon running

### Background

Implements: R1 — A task dispatched to a named local agent completes with no daemon running; R2 — The same dispatch uses the warm member when one is live; R8 — A workflow step dispatches to a member by name; R9 — Doctor says which delivery each member will take.

Fleet is too heavy for daily use: a dispatch needs `spur serve`, a started member and the spec/occupant vocabulary, and this repository's own config ships `agent.fleet.enabled: false`. ADR-148 (Proposed) makes the member name the only thing a user addresses and lets Spur choose the delivery. Contract: `docs/design/a2a-member-transport.md` sections 3.1, 3.2 and 4.3. Starting this task requires operator acceptance of ADR-148 decisions 1 (member-id address, default cold fallback).

### Requirements

- [ ] R1 — `spur agent run --agent <name>` resolves a declared fleet member id before role, executor and binary names; an id that collides with one of those is a config validation error naming both.
- [ ] R2 — A live member receives the work as one keyed inbox request through the existing `FleetDispatcher`; no second dispatch path is added.
- [ ] R3 — A local member that is not live (no serve, or member not started) runs the work on the subprocess surface with the member's executor, by default, on a definite `not-started` only.
- [ ] R4 — The receipt records the delivery taken and the fallback reason; an `outcome-unknown` dispatch is never re-run on another delivery.
- [ ] R5 — A workflow `agent.run` step naming a member uses the same resolution and ladder.
- [ ] R6 — `spur agent doctor` lists each member with the delivery it would take now and an actionable reason when it can take none.
- [ ] R7 — Runs that set `executorFallback` explicitly keep today's behavior; warm-turn receipts and gate results are unchanged.

### Acceptance Criteria

- [ ] AC1 — A task dispatched to a named local agent completes with no daemon running
- [ ] AC2 — The same dispatch uses the warm member when one is live
- [ ] AC3 — A workflow step dispatches to a member by name
- [ ] AC4 — Doctor says which delivery each member will take

Task-local check: the E2E run leaves a repeatable receipt artifact showing the same command taking the cold and the warm delivery.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: extend the existing `--agent` resolution with one earlier rung (member id), and flip the existing unavailable-fleet branch (`fleetUnavailableOutcome` in `packages/app/src/workflow/actions/agent-run.ts`) so a local member defaults to the `traditional` fallback. Reuse `FleetDispatcher` and the `fallbackReason` receipt field; add no surface, verb or table.

Why: the smallest change that removes the daemon and the start step from daily use; `spur serve` becomes an accelerator.

Rejected: auto-starting `spur serve` from a one-shot command (hides a daemon); a new `spur dispatch` verb (ADR-051, and `agent run` already exists); a fleet-specific fallback implementation (one already exists).

Invariants: fallback only on definite `not-started`; never after `outcome-unknown`; the cold path is always visible in the receipt; a live member behaves exactly as today.

### Plan

- [ ] Write the failure list first as E2E cases: no serve, serve up and member down, member live, id collision, outcome-unknown not re-run, explicit `executorFallback` preserved.
- [ ] Member-id rung in agent resolution plus the collision validation in `packages/config`.
- [ ] Default cold fallback for local members; receipt records delivery and reason.
- [ ] Doctor per-member delivery line.
- [ ] Update `docs/design/a2a-member-transport.md` status, the `spur-cli` agent reference and the fleet config satellite; rebuild the CLI bundle.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
