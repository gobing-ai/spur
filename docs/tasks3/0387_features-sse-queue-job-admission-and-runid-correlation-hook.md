---
template: feature-impl
schema_version: 1
name: "Features SSE queue.job admission and runId correlation hook"
description: ""
status: todo
type: task
profile: standard
feature_id: F83
parent_wbs: null
priority: P1
tags: []
dependencies: []
created_at: "2026-07-29T23:22:42.912Z"
updated_at: "2026-07-29T23:23:32.819Z"
---

## 0387. Features SSE queue.job admission and runId correlation hook

### Background
Implements: R2 — SSE admits queue.job events for feature actions
Implements: R7 — Stale or unmatched queue events do not corrupt another feature's UI

Parent F83. Depends on server returning runId (0386). Client foundation only — floating chrome is 0388.

Rubric: E3 D1 L1 C1 R0 = 6 → decompose child (SSE + correlation).
### Requirements
- [ ] R1. Widen Features module EventSource handling so queue.job.enqueued|completed|failed|retrying are not dropped solely for lacking a feature. prefix.
- [ ] R2. Provide a small hook or store that records active runId(s) per feature/action after dispatch and maps incoming payload.jobId to lifecycle state.
- [ ] R3. Unmatched jobId events never mutate another feature's tracked progress state.
- [ ] R4. feature.updated / feature.transitioned still bump detail refresh as today.
- [ ] R5. Unit tests for filter predicate and correlation matching (fake EventSource or pure helpers).
### Acceptance Criteria
```gherkin
Scenario: R2 — SSE admits queue.job events for feature actions
  Given Features board SSE is open
  When a queue.job.completed frame arrives with jobId matching a tracked runId
  Then the progress state for that runId becomes succeeded

Scenario: R7 — Stale or unmatched queue events do not corrupt another feature's UI
  Given feature B is selected with no tracked runId matching job-x
  When queue.job.failed for job-x arrives
  Then feature B progress state is unchanged
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Approach: Prefer pure helpers (isFeaturesSseEvent, matchJobId) + a React hook `useFeatureActionProgress` owned by the features module; optionally hoist one EventSource if FeaturesShell and the progress hook both need frames.
Rejected: Second EventSource per panel without sharing; server-side re-emit as feature.action.* (optional later, not required).
Invariants: runId not required for correctness after re-entry (F81/0352); only for live chip/layer scoping.
### Plan
1. Extract/widen SSE name filter.
2. Implement progress state machine helper.
3. Hook + tests.
4. Wire FeaturesShell refresh path to still use feature.* for tree/detail.
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
