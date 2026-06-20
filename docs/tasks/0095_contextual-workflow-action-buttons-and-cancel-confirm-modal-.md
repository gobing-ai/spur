---
schema_version: 1
name: "Contextual workflow action buttons and cancel-confirm modal in the detail pane"
status: todo
template: standard
created_at: 2026-06-20T05:06:46.368Z
updated_at: 2026-06-20T15:57:14.202Z
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
### History
