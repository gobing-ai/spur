---
template: feature-impl
schema_version: 1
name: "Board: add status filter menu to Features panel header"
description: ""
status: todo
type: task
profile: standard
feature_id: R
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-24T23:40:32.947Z"
updated_at: "2026-07-25T00:39:01.475Z"
---

## 0326. Board: add status filter menu to Features panel header

### Background
**Ticket type:** `wayfinder:task` — implementation-ready; drive through the normal task pipeline.

**Work:** In `apps/web/src/modules/features/FeaturesShell.tsx`, add a filter-icon button in the Features panel header just before the `+` button; clicking it opens a popup menu listing all possible feature statuses (plus an All/clear entry).

**Spec:**

- Menu items: the canonical statuses (`backlog · active · verifying · blocked · done · cancelled`) + All.
- Selecting an item hides the menu and filters the tree client-side over `FeatureSummary.status`; selecting All clears the filter.
- Active-filter affordance: filter icon shows a highlighted/badge state while a filter is active.
- Empty result ⇒ friendly empty-state line in the tree pane; SSE updates still apply under an active filter.

**Done when:** in the browser, each status selection filters the tree as specified and finding incomplete features takes seconds; lint/tests green.
### Requirements
- Add a filter-icon button in the Features panel header of `apps/web/src/modules/features/FeaturesShell.tsx`, placed just before the existing `+` button (inline SVG, consistent with the status-icon module from the tree-icon task — no new dependency).
- Clicking it opens a popup menu listing all canonical feature statuses (`backlog · active · verifying · blocked · done · cancelled`) plus an All entry.
- Selecting an item hides the menu and filters the tree client-side over `FeatureSummary.status`; selecting All clears the filter.
- Active-filter affordance: the filter icon shows a highlighted/badge state while a filter is active.
- Empty result ⇒ friendly empty-state line in the tree pane; SSE `feature.*` updates still apply under an active filter.
- Done when: in the browser, each status selection filters the tree as specified and finding incomplete features takes seconds; `bun run lint` and tests green.
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

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

R

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
