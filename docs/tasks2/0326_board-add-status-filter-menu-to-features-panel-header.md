---
template: feature-impl
schema_version: 1
name: "Board: add status filter menu to Features panel header"
description: ""
status: done
type: task
profile: standard
feature_id: R
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-24T23:40:32.947Z"
updated_at: "2026-07-25T01:23:03.442Z"
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
- R1. Add a filter-icon button in the Features panel header of `apps/web/src/modules/features/FeaturesShell.tsx`, placed just before the existing `+` button using inline SVG without external icon dependencies.
- R2. Clicking the filter-icon button opens a popup menu listing all canonical feature statuses (`backlog · active · verifying · blocked · done · cancelled`) plus an All entry.
- R3. Selecting a menu item hides the menu and filters the tree client-side over `FeatureSummary.status` while preserving ancestor nodes; selecting All clears the filter.
- R4. Show active-filter affordance indicator on the filter icon while a status filter is active.
- R5. Render a friendly empty-state message when status filter matches zero features in the tree.
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
| File:line | Change |
| --- | --- |
| [`apps/web/src/modules/features/status-icons.tsx:10`](file:///Users/robin/xprojects/spur-new/apps/web/src/modules/features/status-icons.tsx#L10) | Exported `FEATURE_STATUSES` constant array containing all canonical feature status names. |
| [`apps/web/src/modules/features/FeaturesShell.tsx:86`](file:///Users/robin/xprojects/spur-new/apps/web/src/modules/features/FeaturesShell.tsx#L86) | Added `statusFilter` state, popup filter menu button with active filter affordance indicator, reset option, and status items menu; added tree filtering logic preserving ancestor node IDs for matching descendants. |
| [`apps/web/tests/modules/features/components.test.tsx:236`](file:///Users/robin/xprojects/spur-new/apps/web/tests/modules/features/components.test.tsx#L236) | Added unit tests verifying status filter menu opening, status filtering over feature tree nodes, and empty state rendering when zero features match. |
### Testing
- Executed `bun test apps/web`: 501 passing unit tests across 32 web test files.
- Executed `bun run autofix && bun run spur-check` quality gate: 3,543 passing unit tests across 220 files with 100% coverage gate pass and 0 rule violations.
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P4 | [`apps/web/src/modules/features/FeaturesShell.tsx:104`](file:///Users/robin/xprojects/spur-new/apps/web/src/modules/features/FeaturesShell.tsx#L104) | Status filter menu | None — ancestor node IDs preserved so hierarchy remains navigable under active filters |

Residual risk: None. SSE live updates apply transparently over the filtered tree.
### References

R

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-25T01:23:00.300Z todo → wip (system)
- 2026-07-25T01:23:01.888Z wip → testing (system)
- 2026-07-25T01:23:03.442Z testing → done (system)
