---
schema_version: 1
name: Deprecated task derivation, routing and Board surfaces
status: todo
template: feature-impl
created_at: 2026-10-13T16:56:12.969Z
updated_at: "2026-10-13T16:57:24.029Z"
feature_id: F43
priority: P2
estimate_hours: 5

dependencies: ["1189"]
---

## 1191. Deprecated task derivation, routing and Board surfaces

### Background

Implements: R6 — Derivation reads a deprecated task as terminal-linked work; R7 — The Board shows deprecated tasks with deprecate and undeprecate actions. The routing half of R4 is implemented here; its checklist row lives on the guard task so one scenario is never claimed twice.

Design: docs/design/task-deprecated-status.md §3.1 S5, S11, S12; ADR-137.

Ordering: depends on the vocabulary slice (it names the status); independent of the guard slice except for the shared terminal-set decision recorded there.

### Requirements

- [ ] R1. Extend the derivation terminal test so a deprecated task counts as terminal-linked: `packages/app/src/services/feature-service.ts:486` reads `st === 'done' || st === 'cancelled'`, and its consumers at :487, :490, :535 and :602 must treat `deprecated` as terminal while `activeTasks` (:489, reads `wip`/`testing`) and `doneTasks` (:488, reads `done`) stay unchanged — prove with a feature whose only remaining linked task is deprecated, which must not be blocked from leaving `verifying` and must not be reopened.
- [ ] R2. Never select a deprecated task as the next step: the next-router selection and the batch/run resolution paths skip it (`plugins/sp/skills/next-router/SKILL.md`, `plugins/sp/skills/spur-dev/references/execution-batch.md`), and `spur task list --status deprecated` keeps working through the enum with no edit.
- [ ] R3. Board Tasks module: show the deprecated status with its icon and colour, include it in the status filter, and offer deprecate/undeprecate actions only from the legal source states (`apps/web/src/modules/task-kanban/KanbanBoard.tsx`, `TasksShell.tsx`), following the F42 feature-module shape (`apps/web/src/modules/features/feature-actions.ts`) rather than inventing a second pattern.

### Acceptance Criteria

- [ ] AC6 — Derivation reads a deprecated task as terminal-linked work
- [ ] AC7 — The Board shows deprecated tasks with deprecate and undeprecate actions

Task-local checks: `spur task list --status deprecated` selects the status; the Board offers no transition the graph refuses.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen approach: one shared terminal-set decision, applied at the derivation closure, the routing selection and the Board affordances.

Why: F42's feature-side freeze guards were mostly refusals, but the task-side freeze has a second, opposite duty — a frozen task must stop *blocking* its feature. Without extending the terminal test at `feature-service.ts:486`, a deprecated task stays non-terminal forever, the feature can never leave `verifying`, and the only escape would be deleting the task, which the operator's ask puts out of scope. This is the single most consequential line in the slice.

Why the closure rather than a new helper: the existing closure is already the single place the rule is expressed, and it is inlined in one function; extracting a helper for one consumer would be speculative abstraction. Assert the three neighbours it must NOT change (`doneTasks`, `activeTasks`, the 'at least one done' rule) so the change cannot widen by accident.

Rejected: teaching the Board a separate filter for the status. The filter already derives from `TASK_STATUSES`, so membership follows the enum automatically; only the icon/colour and the action set need explicit work.

Invariants: a deprecated task is never 'active work' and never 'done'; derivation proposes no status for it; routing never starts it; the Board never offers a transition the graph would refuse.

Key surfaces and signatures: the terminal closure at `packages/app/src/services/feature-service.ts:486`; the routing selection in the next-router skill and the batch resolver reference; the Tasks module components under `apps/web/src/modules/task-kanban/`.

Browser check: the Board change is user-visible, so the verification needs at least one rendered check of the Tasks view with a deprecated task present, not only a unit assertion.

### Plan

1. Extend the terminal closure and assert the unchanged neighbours.
2. Prove the derivation behaviour with a feature whose only linked task is deprecated, including the not-reopened half.
3. Update the routing selection and its reference doc.
4. Add the Board icon/colour, filter membership and the deprecate/undeprecate actions.
5. Browser-check the Tasks view with a deprecated task present.
6. Run the focused service and Board tests.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
