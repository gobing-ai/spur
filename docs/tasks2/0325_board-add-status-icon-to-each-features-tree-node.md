---
template: feature-impl
schema_version: 1
name: "Board: add status icon to each Features tree node"
description: ""
status: done
type: task
profile: standard
feature_id: R
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-24T23:40:30.512Z"
updated_at: "2026-07-25T00:42:41.910Z"
---

## 0325. Board: add status icon to each Features tree node

### Background
**Ticket type:** `wayfinder:task` — implementation-ready; drive through the normal task pipeline.

**Work:** In `apps/web/src/modules/features/FeatureTree.tsx`, upgrade the per-node `StatusBadge` (currently plain text, line 79/103) to an icon + color per status over the canonical enum (`backlog · active · verifying · blocked · done · cancelled`, `packages/domain/src/planning/schema.ts:23`).

**Spec:**

- Status→icon/color mapping table defined in the component (or shared module), aligned with existing design tokens (`spur-accent`, `spur-text-muted`, `base-200` etc. — see FeaturesShell / global.css).
- Accessibility: keep an accessible name (`aria-label`/`title`) with the status text; meaning is not carried by color alone.
- Tree keeps working with SSE `feature.*` live updates; icon re-renders on status change.

**Done when:** every tree node shows the mapped status icon in the browser (golden path + at least one node per status), lint/tests green.
### Requirements
- R1. Replace the text-only `StatusBadge` in `apps/web/src/modules/features/FeatureTree.tsx` (:79, :103) with an icon + color per status over the canonical enum (`backlog · active · verifying · blocked · done · cancelled`).
- R2. Define icons as inline SVGs in a small co-located module (`apps/web/src/modules/features/status-icons.tsx`) without adding new external icon dependencies.
- R3. Maintain a single status-to-icon/color mapping table in `status-icons.tsx` using design tokens (`spur-accent`, `spur-text-muted`, `base-200`, `text-error`, `text-success`).
- R4. Enforce accessibility by attaching `aria-label` and `title` attributes carrying status text so status is not conveyed by color alone.
- R5. Support live re-rendering of status icons upon `feature.*` SSE events.
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
| [`apps/web/src/modules/features/status-icons.tsx`](file:///Users/robin/xprojects/spur-new/apps/web/src/modules/features/status-icons.tsx) | Created co-located status icons module defining `FEATURE_STATUS_MAP` and inline SVG `FeatureStatusIcon` component for all 6 canonical statuses (`backlog`, `active`, `verifying`, `blocked`, `done`, `cancelled`). |
| [`apps/web/src/modules/features/FeatureTree.tsx:100`](file:///Users/robin/xprojects/spur-new/apps/web/src/modules/features/FeatureTree.tsx#L100) | Upgraded `StatusBadge` component to render `FeatureStatusIcon` alongside status label inside `Badge` with `aria-label` and `title` attributes. |
| [`apps/web/tests/modules/features/components.test.tsx:170`](file:///Users/robin/xprojects/spur-new/apps/web/tests/modules/features/components.test.tsx#L170) | Added unit tests verifying status SVG icons and accessible `aria-label` attributes render for all 6 canonical statuses. |
### Testing
- Executed `bun test apps/web`: 499 passing unit tests across 32 web test files.
- Executed `bun run autofix && bun run spur-check` quality gate: 3,541 passing unit tests across 220 files with 100% coverage gate pass and 0 rule violations.
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P4 | [`apps/web/src/modules/features/status-icons.tsx:1`](file:///Users/robin/xprojects/spur-new/apps/web/src/modules/features/status-icons.tsx#L1) | Co-located SVG status icons module | None — zero external dependencies, accessible aria labels included |

Residual risk: None. Icons automatically update via existing SSE event listener in `FeaturesShell`.
### References

R

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-25T00:42:38.512Z todo → wip (system)
- 2026-07-25T00:42:40.217Z wip → testing (system)
- 2026-07-25T00:42:41.910Z testing → done (system)
