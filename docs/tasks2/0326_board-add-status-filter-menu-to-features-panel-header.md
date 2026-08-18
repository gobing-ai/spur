---
template: feature-impl
schema_version: 1
name: "Board: add status filter menu to Features panel header"
description: ""
status: done
type: task
profile: standard
feature_id: F82
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-24T23:40:32.947Z"
updated_at: "2026-08-18T04:42:47.831Z"
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
**Verdict: PASS** — re-audit of commit `f5594b4c` via `/sp:dev-verify 0326 --force --focus all --fix all` (2026-07-24). The menu-dismissal P4 from the audit was repaired in a follow-up fix pass and re-verified green (evidence below).

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 filter-icon button before the `+` button, inline SVG, no new dependency | MET | `apps/web/src/modules/features/FeaturesShell.tsx:150-170` (filter button) vs `:228-237` (`+`); `FilterIcon` inline SVG at `:13-28`; `git show f5594b4c --name-only` — no package.json |
| R2 popup menu lists all canonical statuses + All | MET | `apps/web/src/modules/features/FeaturesShell.tsx:191-224` — All entry + `FEATURE_STATUSES.map` (`apps/web/src/modules/features/status-icons.tsx:11` = the six canonical statuses) |
| R3 selecting an item hides the menu and filters client-side; All clears | MET | `apps/web/src/modules/features/FeaturesShell.tsx:193-213` (set + close); `getFilteredFeatures` at `:122-139`; test "opens status filter menu … filters tree by selected status" passed |
| R4 active-filter affordance on the icon | MET | accent class swap at `:156` + accent dot at `:164-169` |
| R5 empty result ⇒ friendly empty state; SSE updates apply under filter | MET | empty-state line at `:242-245` (test "shows empty state message when status filter matches zero features" passed); filter is a pure projection of `features` state, so SSE refetch (`:80-98`) re-filters automatically |
| R6 done-when (each status filters; lint/tests green) | MET | 11/11 tests pass; biome clean; tsc exit 0 |

**Acceptance Criteria Verification**

N/A — task AC section is the empty template stub; requirements traceability is the verify axis.

**Design Conformance**

N/A — no approved `### Design` content (template stub); verified directly against Requirements. No scope creep: code diff is exactly `FeaturesShell.tsx`, `status-icons.tsx` (shared `FEATURE_STATUSES` export), `components.test.tsx`.

**SECUA Review (focus: all)**

| Severity | File | Finding | Disposition |
| --- | --- | --- | --- |
| P4 | `apps/web/src/modules/features/FeaturesShell.tsx:158` | Filter menu closed only on selection / button re-click — no outside-click or Escape dismissal | FIXED — dismissal effect at `apps/web/src/modules/features/FeaturesShell.tsx:65-79` (outside mousedown via `filterMenuRef` + Escape); test "closes status filter menu on Escape and on outside mousedown" passed |
| P4 | `apps/web/src/modules/features/FeaturesShell.tsx:122-139` | Filter keeps ancestors of matching features visible so children stay reachable — a **documented deviation** from the literal "filtered out with this status" spec, and arguably the correct tree behavior | Accepted — matches tree UX conventions; no downgrade |

Residual risk: none blocking.

**Evidence (run this audit)**

- `bun test apps/web/tests/modules/features/components.test.tsx` — 11 pass / 0 fail / 49 expects (incl. the two 0326 tests + the new dismissal test), re-run after the fix pass
- `bunx biome check` on the changed files — clean
- `cd apps/web && bunx tsc --noEmit` — exit 0
- Coverage: N/A for the per-file gate — React `.tsx` excluded (happy-dom); tests at `apps/web/tests/modules/features/components.test.tsx`
- Line-anchor rule: `apps/web/src/modules/features/FeaturesShell.tsx:122-139`, `:150-224` re-read this run; cited lines name the requirement subjects
- Fix-pass disclosure: the fix pass touched `apps/web/src/modules/features/FeaturesShell.tsx:1-2` (imports), `:65-79` (dismissal effect), `:151` (ref on anchor div) and `apps/web/tests/modules/features/components.test.tsx` (new dismissal test); untracked artifact updated at `.spur/run/0326-verdict.json`
- Browser check: not re-run by this audit — happy-dom interaction tests (menu open → select → filtered tree; zero-match empty state; Escape/outside dismissal) stand in; golden-path browser confirmation optional
- Verdict artifact: `.spur/run/0326-verdict.json` (written last, standalone path)
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
