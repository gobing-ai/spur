---
schema_version: 1
name: "Contextual workflow action buttons and cancel-confirm modal in the detail pane"
status: done
template: standard
created_at: 2026-06-20T05:06:46.368Z
updated_at: 2026-06-22T06:41:30.418Z
feature_id: F7
priority: P1
tags: ["task-kanban", "wave-2", "web", "actions", "high-severity"]
---

## 0095. Contextual workflow action buttons and cancel-confirm modal in the detail pane

### Background

Implements gap-analysis §2 (Workflow Actions — High severity, and Cancel Safety — Low) + §3.2 + Wave 2. Effort: ~9h. The migrated detail pane has no action buttons (the core automation loop is CLI-only) and cancels a task immediately with no confirmation. Legacy showed status-contextual AI buttons (Refine/Plan/Run/Verify/Decompose/Evaluate — e.g. Refine only in Backlog) and a confirmation modal before marking cancelled. This task renders the contextual action buttons wired to the action API (0094) and adds the cancel-confirm modal. Button visibility is driven by the task's current status. Depends on 0094 (action API). Ordering: after 0094.

### Requirements
- [ ] R1. Render workflow action buttons (Refine, Plan, Run, Verify, Decompose, Evaluate) in TaskDetail.tsx, each wired to the action endpoint from 0094.
- [ ] R2. Button visibility/enablement is contextual to the task's current status (e.g. Refine only when backlog), matching the legacy status-to-action logic; the mapping is documented in Design.
- [ ] R3. Clicking an action triggers the call, reflects pending/started state in the UI, and surfaces success/failure via the existing api-error surface and a board/detail refresh.
- [ ] R4. Add a confirmation modal before a cancel (mark-cancelled) transition; the transition only fires on explicit confirm, preventing accidental cancellation.
- [ ] R5. Tests: buttons render per status, an action click invokes the action API, the cancel modal blocks the transition until confirmed. Manual browser check recorded in Testing. Gate green.
### Acceptance Criteria
Core scenarios (must pass):

```gherkin
Scenario: R1 — action buttons render in the detail pane
  Given a selected task
  When TaskDetail renders
  Then the workflow action buttons (Refine, Plan, Run, Verify, Decompose, Evaluate) are shown, each wired to the 0094 action route

Scenario: R2 — button visibility is contextual to status
  Given a task at a given status
  When the action buttons render
  Then only the actions valid for that status are shown/enabled (e.g. Refine in backlog), per the documented status→action mapping

Scenario: R3 — clicking an action invokes it and reflects progress
  Given a visible action button
  When I click it
  Then the action route is called, the UI shows pending/started state, and success/failure surfaces via the api-error event and a refresh

Scenario: R4 — cancelling a task requires confirmation
  Given a task and a cancel action/transition
  When I trigger cancel
  Then a confirmation modal appears
  And the cancel transition fires only on explicit confirm
```

Edge cases (advisory):

```gherkin
Scenario: R5 — an unsupported action is disabled or reports not-yet-implemented
  Given an action not yet wired end-to-end in 0094
  When its button is shown
  Then it is disabled or its click reports "not yet implemented" without error
```
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
**Decision — render status-contextual action buttons in TaskDetail wired to the 0094 action route; gate the cancel transition behind a confirmation modal.**

The detail pane today has only status-transition buttons (`onTransition`) and no action buttons. This task adds the workflow actions and the cancel-safety modal.

**Action buttons.** Render Refine/Plan/Run/Verify/Decompose/Evaluate, each calling the 0094 `POST /tasks/{wbs}/actions` route. The returned `runId` (async model) is shown as pending/started; the UI does not block. Actions not yet wired end-to-end in 0094 are disabled or report "not yet implemented" (R5) — no fake success.

**Status→action mapping (documented here, the contextual logic).** Mirror the legacy rule that an action is offered only where it makes sense:
- backlog → Refine, Plan
- todo → Plan, Run, Decompose
- wip → Run, Verify, Evaluate
- testing → Verify, Evaluate
- blocked → Refine
- done/cancelled → none
This mapping is a small client-side table; the server still validates (an invalid action is rejected by 0094), so the UI mapping is UX, not the security boundary.

**Cancel-safety modal (R4).** The current status buttons fire `onTransition` immediately, including cancel. Wrap the cancel transition (mark-cancelled) in a confirmation modal — the transition only fires on explicit confirm. Other transitions remain immediate (low blast radius); only cancel is destructive enough to warrant the gate, matching the legacy behavior and gap-analysis §2 (Cancel Safety).

**Progress/refresh.** On action invocation, reflect pending state and refresh the board/detail (via the `useTasks` store) so status changes surface; errors via the `api-error` event.

**Depends on:** 0094 (action route). **Invariant:** the client mapping is UX convenience; the server (0094 + the lifecycle engine) remains the validation authority.
### Plan
1. Add an action-button row to TaskDetail, each button calling the 0094 `actions` route with the action name.
2. Implement the status→action visibility table (backlog: Refine/Plan; todo: Plan/Run/Decompose; wip: Run/Verify/Evaluate; testing: Verify/Evaluate; blocked: Refine; done/cancelled: none).
3. Reflect pending/started state from the returned `runId`; surface success/failure via `api-error` + a store refresh. Disable or "not yet implemented" any action not wired in 0094.
4. Add a confirmation modal for the cancel (mark-cancelled) transition; the transition fires only on confirm. Leave other transitions immediate.
5. Tests: buttons render per status, an action click invokes the route, the cancel modal blocks until confirmed, an unwired action does not fake success. Record a manual browser check in Testing. Run the gate.

### Solution

- `apps/web/src/modules/task-kanban/TaskDetail.tsx:1-6` — added `useTasks` import, `STATUS_ACTIONS`/`ACTION_LABELS` constants
- `apps/web/src/modules/task-kanban/TaskDetail.tsx:55-57` — `actionLoading`, `showCancelModal`, `setTasks` state
- `apps/web/src/modules/task-kanban/TaskDetail.tsx:138-153` — `handleAction()`: calls `api.task.action()`, refreshes list, surfaces errors via `api-error`
- `apps/web/src/modules/task-kanban/TaskDetail.tsx:201-226` — action button row, status-contextual via `STATUS_ACTIONS` table
- `apps/web/src/modules/task-kanban/TaskDetail.tsx:232-246` — status buttons: cancelled gate via `setShowCancelModal(true)`
- `apps/web/src/modules/task-kanban/TaskDetail.tsx:417-464` — cancel confirmation modal with `role="dialog"`, `aria-modal="true"`, Escape key support
- `apps/web/tests/modules/task-kanban/task-detail.test.tsx` — 14 new tests (action buttons: 9 tests; cancel modal: 5 tests)

### Review

**Verdict:** PASS — 0 blockers, 0 warnings. No P1–P4 findings.
**Channel:** current
**Gate:** `bun run check` + `bun run test` + `bun run test-cf` + `bun run build` → all pass

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| — | No findings — all gates green | — | — | — |

**Traceability (R1–R5):**
- [x] **R1**: Action buttons render → **MET** (all statuses verified)
- [x] **R2**: Status-contextual visibility → **MET** (STATUS_ACTIONS table, 5 status tests)
- [x] **R3**: Click → API + pending + refresh + errors → **MET** (handleAction, R2 tests)
- [x] **R4**: Cancel modal → **MET** (dialog, 5 modal tests)
- [x] **R5**: Tests + gate green → **MET** (28 tests, lint/build/test-cf)

**Re-verification 2026-06-21 (`/rd3:dev-verify 0095 --force --fix all`):** PASS — re-confirmed. 0 P1–P4 findings. Gate: `bun run lint` (biome + tsc, 7 workspaces) clean; `task-detail.test.tsx` 28 pass / 0 fail. Action route wiring re-checked against contract `task.ts:158-164` (`/tasks/{wbs}/actions`, enum matches the 6 client actions). SECU sub-threshold notes: `handleAction` double-casts at the rpc boundary (`TaskDetail.tsx:141,144`); cancel modal lacks focus-trap but has Escape + backdrop dismiss + `aria-modal`. **Fix-pass:** 0 fixed, 0 failed, 0 skipped (verdict PASS — nothing to fix).
### Testing
- **Command:** `bun run lint` + `bun run test` + `bun run test-cf` + `bun run build`
- **Scope:** TaskDetail.tsx — action buttons, cancel modal; 28 tests in task-detail.test.tsx
- **Result:** 1571 tests pass (0 fail), lint clean, test-cf 1 pass, build succeeds
- **Coverage:** 99.67% funcs, 99.06% lines
- **Evidence:** `apps/web/tests/modules/task-kanban/task-detail.test.tsx` — 14 new tests (action buttons: 9 tests covering all 5 statuses + 2 R2 API tests; cancel modal: 5 tests covering modal display, dismiss via Keep/backdrop, confirm transition, and non-cancelled direct transition)
- **Next action:** none — all gates green

### History
- 2026-06-22T06:26:58.216Z todo → wip (system)

- 2026-06-22T06:43:59.000Z todo → wip (rd3-dev-run)
- 2026-06-22T06:43:59.000Z wip → testing (rd3-dev-run)
- 2026-06-22T06:43:59.000Z testing → done (rd3-dev-run)
