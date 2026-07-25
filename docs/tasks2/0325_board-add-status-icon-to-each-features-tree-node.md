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
updated_at: "2026-07-25T00:59:50.756Z"
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
**Verdict: PASS** — re-audit of commit `43842d22` via `/sp:dev-verify 0325 --force --focus all --fix all` (2026-07-24). Both P4 findings from the audit were repaired in a follow-up fix pass and re-verified green (evidence below).

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 icon+color per status over canonical enum | MET | `FeatureTree.tsx:104-117` StatusBadge renders `FeatureStatusIcon` + label; `status-icons.tsx:14-126` maps all 6 canonical statuses; test "renders mapped status icons and accessible labels for all 6 canonical statuses" passed |
| R2 inline SVG co-located module, no new dependency | MET | `status-icons.tsx` — all icons inline SVG; `git diff --name-only 43842d22~1..HEAD` = exactly 3 files, no package.json |
| R3 mapping table + design tokens | MET | `FEATURE_STATUS_MAP` (`status-icons.tsx:14`) — all 6 entries now use spur/daisy tokens; `verifying` uses `text-spur-warning` (`global.css:16`) after the fix pass |
| R4 accessibility — not color-only | MET | `FeatureTree.tsx:110-111` `aria-label` + `title` = `Status: <status>`; visible status text retained (`:114`) |
| R5 SSE re-render on status change | MET | StatusBadge is a pure function of `feature.status` from FeaturesShell state — no memoization blocks re-render; shell tests exercise the EventSource mock |
| R6 done-when (node per status; lint/tests green) | MET | 8/8 tests pass incl. six-status render; biome clean; tsc exit 0 |

**Acceptance Criteria Verification**

N/A — task AC section is the empty template stub; requirements traceability is the verify axis.

**Design Conformance**

N/A — no approved `### Design` content (template stub); verified directly against Requirements. No scope creep: code diff is exactly `FeatureTree.tsx`, `status-icons.tsx`, `components.test.tsx`.

**SECUA Review (focus: all)**

| Severity | File | Finding | Disposition |
| --- | --- | --- | --- |
| P4 | `apps/web/src/modules/features/status-icons.tsx:50` | `verifying` used raw `text-amber-500` despite `--color-spur-warning` token (`global.css:16`, same hex) | FIXED — now `text-spur-warning` (re-verified: 8/8 tests, biome, tsc) |
| P4 | `apps/web/src/modules/features/status-icons.tsx:6` | `StatusMeta.colorClass` declared per entry but never consumed — Icon closures hardcoded the same class | FIXED — Icon closures no longer hardcode color; `FeatureStatusIcon` composes `meta.colorClass` (`status-icons.tsx:129-135`), mapping table is the single source of truth |

Residual risk: none.

**Evidence (run this audit)**

- `bun test apps/web/tests/modules/features/components.test.tsx` — 8 pass / 0 fail / 34 expects (incl. six-canonical-status icon + aria-label test), re-run after the fix pass
- `bunx biome check` on the changed files — clean
- `cd apps/web && bunx tsc --noEmit` — exit 0
- Coverage: N/A for the per-file gate — React `.tsx` excluded (happy-dom); component test at `apps/web/tests/modules/features/components.test.tsx`
- Line-anchor rule: `FeatureTree.tsx:104-117` and `status-icons.tsx:14-126` re-read this run; cited lines name the requirement subjects
- Fix-pass disclosure: the fix pass touched `apps/web/src/modules/features/status-icons.tsx:50-53` (token swap) and `status-icons.tsx:19-145` (color-class composition); untracked artifact updated at `.spur/run/0325-verdict.json`
- Browser check: not re-run by this audit — deterministic happy-dom render of all six statuses stands in; golden-path browser confirmation optional
- Verdict artifact: `.spur/run/0325-verdict.json` (written last, standalone path)
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
