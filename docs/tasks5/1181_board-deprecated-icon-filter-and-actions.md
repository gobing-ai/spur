---
schema_version: 1
name: Board deprecated icon, filter and actions
status: todo
template: feature-impl
created_at: 2026-10-12T05:21:53.040Z
updated_at: "2026-10-12T05:22:38.836Z"
feature_id: F42
priority: P2
tags:
  - feature-lifecycle
  - web

dependencies: ["1179"]
---

## 1181. Board deprecated icon, filter and actions

### Background

Implements: R6 — The Board shows deprecated features and offers deprecate and undeprecate actions.

Design: docs/design/feature-deprecated-status.md; ADR-136. Surface S13; read root DESIGN.md for status tokens first.

### Requirements

- [ ] R1. `status-icons.tsx` maps deprecated to its own icon; the `FeaturesShell.tsx` filter lists it via `FEATURE_STATUSES`.
- [ ] R2. `feature-actions.ts` offers `deprecate` on backlog, active, verifying, blocked and done, and only `undeprecate` and `cancel` on deprecated.
- [ ] R3. Actions route through the guarded server transition (ADR-135).

### Acceptance Criteria

- [ ] AC1 — The Board shows deprecated features and offers deprecate and undeprecate actions

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Extend the existing action tables (`FEATURE_STATUS_ACTIONS`, `FSM_ACTIONS`, `FSM_TRANSITION_TARGET`) — no new component. Icon and colour come from DESIGN.md tokens.

### Plan

- Icon map
- Action tables
- Browser check of filter and detail actions on a deprecated and a done feature

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
