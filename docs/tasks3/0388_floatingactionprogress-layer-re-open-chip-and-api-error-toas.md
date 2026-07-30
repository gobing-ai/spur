---
template: feature-impl
schema_version: 1
name: "FloatingActionProgress layer, re-open chip, and api-error toast"
description: ""
status: done
type: task
profile: standard
feature_id: F83
parent_wbs: null
priority: P1
tags: []
dependencies: []
created_at: "2026-07-29T23:22:42.919Z"
updated_at: "2026-07-30T00:17:30.019Z"
---

## 0388. FloatingActionProgress layer, re-open chip, and api-error toast

### Background
Implements: R3 — Floating progress layer shows live lifecycle
Implements: R4 — Dismissing the layer does not cancel the job
Implements: R5 — Terminal failure surfaces when the layer is closed

Parent F83. Depends on correlation hook (0387) and runId-producing dispatch (0385–0386). Completes the operator-visible surface.

Rubric: E4 D1 L1 C1 R0 = 6 → decompose child (UI surface).
### Requirements
- [ ] R1. Render a closable floating progress layer driven by the correlation hook (states: queued, running, succeeded, failed, retrying).
- [ ] R2. Dismiss hides the layer without cancelling the server job; compact chip remains while non-terminal and re-opens the layer.
- [ ] R3. On dispatch success (FeatureActionResponse), open/arm the layer with the returned runId.
- [ ] R4. Mount a Board-shell production listener for api-error that shows a transient error toast; fire toast on terminal queue.job.failed when the layer is dismissed.
- [ ] R5. FeatureDetail retains runId after agent/sync actions that use the action runner; actionFeedback banner may remain for immediate RPC errors.
- [ ] R6. Component tests cover dismiss, re-open, and failed-with-layer-closed toast path.
### Acceptance Criteria
```gherkin
Scenario: R3 — Floating progress layer shows live lifecycle
  Given a feature action returned runId r1
  When queue.job events for r1 move queued to completed
  Then the floating layer shows the intermediate and terminal states

Scenario: R4 — Dismissing the layer does not cancel the job
  Given the layer is open for an in-flight run
  When the operator closes the layer
  Then the job is not cancelled and the chip remains until terminal

Scenario: R5 — Terminal failure surfaces when the layer is closed
  Given a feature-action job fails terminally
  And the floating progress layer is not open
  When the client receives the failure signal
  Then a global error toast shows the failure
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Approach: New FloatingActionProgress component under apps/web/src/modules/features; chip in FeatureDetail header action row; toast at BoardApp/shell once. Design satellite docs/design/feature-action-progress-transparency.md §5.
Rejected: Success toasts (noise); cancelling jobs from the layer in v1.
Invariants: confirm-before-enqueue unchanged; dismiss is client-only.
### Plan
1. FloatingActionProgress + chip UI.
2. Wire FeatureDetail dispatchAgentAction / async paths to progress hook.
3. Global api-error toast listener.
4. Tests with happy-dom / existing web test patterns.
### Solution

- [apps/web/src/modules/features/FloatingActionProgress.tsx:18](file:///Users/robin/xprojects/spur-new/apps/web/src/modules/features/FloatingActionProgress.tsx#L18): Implemented `FloatingActionProgress` layer and compact re-open chip component.
- [apps/web/src/components/ApiErrorToast.tsx:11](file:///Users/robin/xprojects/spur-new/apps/web/src/components/ApiErrorToast.tsx#L11): Implemented `ApiErrorToast` global component listening for `api-error` CustomEvent.
- [apps/web/src/components/BoardLayout.tsx:160](file:///Users/robin/xprojects/spur-new/apps/web/src/components/BoardLayout.tsx#L160): Mounted `ApiErrorToast` at the Board layout root.
- [apps/web/src/modules/features/FeatureDetail.tsx:384](file:///Users/robin/xprojects/spur-new/apps/web/src/modules/features/FeatureDetail.tsx#L384): Armed progress hook on `dispatchAgentAction` success and rendered `FloatingActionProgress`.
- [apps/web/tests/modules/features/FloatingActionProgress.test.tsx:15](file:///Users/robin/xprojects/spur-new/apps/web/tests/modules/features/FloatingActionProgress.test.tsx#L15): Added unit tests for open panel, dismiss, compact chip, and terminal failure toast dispatching.

### Testing

- `bun test apps/web/tests/modules/features/FloatingActionProgress.test.tsx` (6 pass, 0 fail).

### Review

| Priority | Finding | Action |
| --- | --- | --- |
| P1 | None — FloatingActionProgress renders live status driven by SSE correlation hook | Verified |
| P2 | None — Dismissing progress layer keeps compact chip without cancelling server job | Verified |
| P3 | None — ApiErrorToast catches terminal failure when progress layer is dismissed | Verified |
| P4 | None — Unit tests cover all render states and user interaction callbacks | Verified |

### References

F83

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-30T00:17:26.451Z todo → wip (system)
- 2026-07-30T00:17:28.391Z wip → testing (system)
- 2026-07-30T00:17:30.019Z testing → done (system)
