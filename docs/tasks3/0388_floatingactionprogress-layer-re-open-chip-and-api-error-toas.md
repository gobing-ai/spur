---
template: feature-impl
schema_version: 1
name: "FloatingActionProgress layer, re-open chip, and api-error toast"
description: ""
status: todo
type: task
profile: standard
feature_id: F83
parent_wbs: null
priority: P1
tags: []
dependencies: []
created_at: "2026-07-29T23:22:42.919Z"
updated_at: "2026-07-29T23:23:34.201Z"
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

F83

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
