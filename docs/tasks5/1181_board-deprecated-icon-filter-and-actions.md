---
schema_version: 1
name: Board deprecated icon, filter and actions
status: todo
template: feature-impl
created_at: 2026-10-12T05:21:53.040Z
updated_at: "2026-10-12T05:34:47.673Z"
feature_id: F42
priority: P2
tags:
  - feature-lifecycle
  - web

dependencies: ["1179"]
estimate_hours: 2
---

## 1181. Board deprecated icon, filter and actions

### Background

Implements: R6 — The Board shows deprecated features and offers deprecate and undeprecate actions.

Design: docs/design/feature-deprecated-status.md; ADR-136; ADR-133 (icon system). Surface S13. Depends on 1179 (enum + graph edges).

**Refine corrections (2026-10-11)**
- "Add a filter entry in `FeaturesShell.tsx`" → the filter maps `FEATURE_STATUSES` (`apps/web/src/modules/features/FeaturesShell.tsx:265`), so it lists deprecated once 1179 lands → no code change there, only a test.
- "Icon from DESIGN.md tokens" → status icons are `FEATURE_STATUS_MAP` entries with an `Icon` component and a `colorClass` (`apps/web/src/modules/features/status-icons.tsx:20`); ADR-133 requires Lucide over new ad-hoc SVG → use `lucide-react` `Archive` (installed, `apps/web/package.json:28`) with `text-spur-text-muted`.
- "done offers deprecate" → `done` currently offers no actions (`apps/web/src/modules/features/feature-actions.ts:7`) → adding `deprecate` there is the first done action; intended.
- Actions route through `transitionFeature` (`apps/web/src/modules/features/FeatureDetail.tsx:347`) → server in-process graph guard (ADR-135); no new client API.

### Requirements

- [ ] R1. `FEATURE_STATUS_MAP.deprecated` = `{status: 'deprecated', label: 'Deprecated', colorClass: 'text-spur-text-muted', Icon: <lucide Archive>}` honoring the existing `className`/`ariaLabel` Icon props.
- [ ] R2. The status filter lists Deprecated (via `FEATURE_STATUSES`) and filtering shows only deprecated features.
- [ ] R3. `FEATURE_STATUS_ACTIONS`: `deprecate` appended for backlog, active, verifying, blocked and done; `deprecated: ['undeprecate', 'cancel']`. Labels `Deprecate` / `Un-deprecate`; tiers `deprecate: 'hazard'`, `undeprecate: 'primary'`; `FSM_ACTIONS` marks both; `FSM_TRANSITION_TARGET` maps `deprecate → 'deprecated'`, `undeprecate → 'active'`.
- [ ] R4. Clicking either action calls `transitionFeature` and re-renders the new status; a 409 GUARD_DENIED surfaces through the existing error path.
- Out of scope: other UI restyling, migrating the existing inline SVG icons to Lucide.

### Acceptance Criteria

- [ ] AC1 — The Board shows deprecated features and offers deprecate and undeprecate actions (req: R1, R2, R3, R4)

Verify lens: `components.test.tsx` observes the icon and action membership; the browser check observes the real transition round-trip.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Approach.** Data-only change in the existing action tables plus one icon entry; `FeatureDetail` and `FeaturesShell` already render from those tables. Why: `feature-actions.ts` is the declared single source of truth for button visibility.

**Frozen names.** Action ids `deprecate`, `undeprecate`; labels `Deprecate`, `Un-deprecate`; icon `Archive` from `lucide-react`; color `text-spur-text-muted`.

**Files.** `apps/web/src/modules/features/feature-actions.ts`; `apps/web/src/modules/features/status-icons.tsx` (+ header comment listing canonical statuses); tests `apps/web/tests/modules/features/components.test.tsx` (`:198` iterates statuses — extend to deprecated) and the feature-actions test if present.

**Anti-patterns.** No new component or confirm dialog. No emoji in the web icon. Do not convert other status icons (no drive-by). Do not compute legality client-side beyond the action table — the server graph decides.

**Handoff.** Relies on 1179's enum and edges. 1182 screenshots/notes nothing extra.

### Plan

- [ ] Step 0: 1179 merged; Board server runs against the source tree.
- [ ] Icon map entry (R1); component test renders the deprecated icon with its aria label.
- [ ] Action tables (R3); unit test on `FEATURE_STATUS_ACTIONS` for done and deprecated.
- [ ] Browser check (R2, R4): filter by Deprecated; open a done feature → Deprecate; then Un-deprecate; save screenshots under `.spur/run/1181-board/`.
- [ ] `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
