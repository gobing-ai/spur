---
schema_version: 1
name: Extract the System Events pinned tooltip into a shared PinnableTooltip
status: todo
template: feature-impl
created_at: 2026-11-25T23:54:35.754Z
updated_at: "2026-11-26T00:02:55.740Z"
feature_id: A821
priority: P2

estimate_hours: 3
---

## 1453. Extract the System Events pinned tooltip into a shared PinnableTooltip

### Background

Implements: R6 — Pinnable semantic tooltip is a shared component

The hover, focus, pin, Escape and single-pinned logic lives inline in `apps/web/src/modules/observability/SystemEventsTab.tsx` (~L1256-1333). DESIGN.md:436-438 owns the contract.

Rubric: E4 D1 L1 C0 R1 = 7 → own task (refactor of a shipped view; separate rollback boundary).


**Refine corrections (2026-11-25)**
- "exported through module-kit" → the barrel's runtime export list is frozen in `apps/web/src/components/module-kit/exports.ts` and asserted by `apps/web/tests/components/module-kit/exports.test.ts` → R1 and Plan now include the `MODULE_KIT_EXPORTS` update.
- DESIGN.md contract citation: :436-438 → the event-name tooltip contract spans `DESIGN.md:436-441` (title/footer lines included).
- AC1 lacked `(req:)` linkage and a test layer → added; component test lives flat under `apps/web/tests/components/` per existing layout.
- Design lacked frozen props and a11y roles → frozen.
- Estimate unset → 3 h.

### Requirements

- [ ] R1. `PinnableTooltip` in `apps/web/src/components/ui/PinnableTooltip.tsx`, exported through the module-kit barrel (`apps/web/src/components/module-kit/index.ts` plus the frozen `MODULE_KIT_EXPORTS` list in `exports.ts`): hover and keyboard focus open the same content, click pins it (selectable for copy), Escape and outside activation close it, and opening one pinned tooltip releases the previous one.
- [ ] R2. The trigger is focusable and named; the content is reachable without hover.
- [ ] R3. The System Events event-name tooltip uses the shared component with unchanged behavior and visuals (surface-3, mono rows, 400 px min, viewport-bounded).
- [ ] R4. DESIGN.md names the shared component as the owner of the pinnable semantic tooltip.

Out of scope: changing `ui/Tooltip.tsx`; adopting the component in other tabs (1454 is the first new consumer).

### Acceptance Criteria

- [ ] AC1 — Pinnable semantic tooltip is a shared component (req: R1, R2, R3, R4)
  - Given a `PinnableTooltip`, When it is hovered or focused, Then the content opens; When clicked, Then it pins and its text is selectable; When Escape or an outside click occurs, Then it closes; When a second tooltip pins, Then the first releases. The System Events event-name tooltip keeps its existing behavior.
  - Test layers: component `apps/web/tests/components/pinnable-tooltip.test.tsx` (happy-dom; hover/focus/pin/Escape/outside/single-pin, accessible name); regression `apps/web/tests/modules/observability/system-events-tab.test.ts`; barrel parity `apps/web/tests/components/module-kit/exports.test.ts`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**WHAT/WHY.** The pin/hover/Escape/outside/single-pin logic lives inline in the System Events row (`apps/web/src/modules/observability/SystemEventsTab.tsx:1255-1333`: `hoveringName`, `pinned`, `pinPos`, `ignoreUnlockUntilRef`, hover-leave timer). 1454 needs the same interaction on lifelines and arrows; copying it would fork a11y behavior.

**Frozen names.**
- `PinnableTooltip` props: `{ trigger: ReactNode; triggerLabel: string; title?: ReactNode; children: ReactNode; footer?: ReactNode; minWidth?: number /* default 400 */; testId?: string }`.
- Single-pin coordination: a module-scoped release callback (one pinned tooltip per document), not context or a store.
- Exported as `PinnableTooltip` and `type PinnableTooltipProps` from the module-kit barrel; `MODULE_KIT_EXPORTS` gains `'PinnableTooltip'` in barrel order.

**Behavior.** Keep the existing hover-leave grace timer and the post-pin ignore window; position from the trigger rect, clamped to the viewport. Content renders in the DOM when open (hover, focus or pinned), with `role="dialog"` when pinned and `role="tooltip"` otherwise, and `aria-describedby` / `aria-expanded` on the trigger.

**Anti-patterns.** Do not extend `ui/Tooltip.tsx` (a non-interactive label tooltip with different a11y semantics); no third-party popover dependency; no portal-library dependency; no visual change to System Events.

**Handoff.** 1454 imports `PinnableTooltip` from module-kit for lifeline and arrow tooltips and supplies only content.

### Plan

1. Failing tests first: component test cases (hover, focus, pin, Escape, outside, single-pin, accessible name), plus a barrel parity expectation for `PinnableTooltip` (R1, R2).
2. Extract the logic from `SystemEventsTab.tsx` into `PinnableTooltip.tsx` (R1, R2).
3. Rewire the System Events event-name tooltip to it; the existing `system-events-tab.test.ts` stays green (R3).
4. Barrel export + `MODULE_KIT_EXPORTS`; DESIGN.md owner line in the event-name tooltip section (R1, R4).
5. Verify: `(cd apps/web && bun test tests/components tests/modules/observability)`, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
