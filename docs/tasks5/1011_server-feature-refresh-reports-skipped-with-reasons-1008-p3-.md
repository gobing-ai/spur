---
schema_version: 1
name: Server feature refresh reports skipped with reasons (1008 P3-5)
status: backlog
template: feature-impl
created_at: 2026-09-29T18:18:17.810Z
updated_at: "2026-09-29T18:20:43.339Z"
feature_id: F91

ac_altitude: task-local
---

## 1011. Server feature refresh reports skipped with reasons (1008 P3-5)

### Background

Task 1008 review finding P3-5 (preserved review answer, `.spur/run/785c3ca9-fa8e-4ea8-b75e-81ccac2db600-review-answer.txt`): task 1008 R4 made the CLI feature refresh report skipped tasks with reasons (`packages/app/src/services/feature-service.ts` + `apps/cli/src/commands/feature.ts`), but the server surface still drops `skipped` silently (`apps/server/src/modules/feature/handlers.ts:70`). The server handler was explicitly out of R4's CLI scope.

Parity gap: oRPC clients refreshing features get no signal that some tasks were skipped (or why), unlike CLI users.

### Requirements

- **R1 (server parity)** — the server feature-refresh handler surfaces `skipped` tasks with their reasons, parity with the CLI R4 contract (same shape as the CLI output; transport DTO updated in `packages/contracts` if needed per ADR-021/04_DESIGN).

### Acceptance Criteria

- [ ] AC1 — Server feature-refresh response includes skipped tasks with reasons, matching the CLI R4 shape (req: R1)

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
