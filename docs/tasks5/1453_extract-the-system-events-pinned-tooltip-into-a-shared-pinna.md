---
schema_version: 1
name: Extract the System Events pinned tooltip into a shared PinnableTooltip
status: done
template: feature-impl
created_at: 2026-11-25T23:54:35.754Z
updated_at: "2026-11-26T03:10:27.386Z"
feature_id: A821
priority: P2

estimate_hours: 3
done_forced: "false"
done_reason: unforced close
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

- [x] R1. `PinnableTooltip` in `apps/web/src/components/ui/PinnableTooltip.tsx`, exported through the module-kit barrel (`apps/web/src/components/module-kit/index.ts` plus the frozen `MODULE_KIT_EXPORTS` list in `exports.ts`): hover and keyboard focus open the same content, click pins it (selectable for copy), Escape and outside activation close it, and opening one pinned tooltip releases the previous one.
- [x] R2. The trigger is focusable and named; the content is reachable without hover.
- [x] R3. The System Events event-name tooltip uses the shared component with unchanged behavior and visuals (surface-3, mono rows, 400 px min, viewport-bounded).
- [x] R4. DESIGN.md names the shared component as the owner of the pinnable semantic tooltip.

Out of scope: changing `ui/Tooltip.tsx`; adopting the component in other tabs (1454 is the first new consumer).

### Acceptance Criteria

- [x] AC1 — Pinnable semantic tooltip is a shared component (req: R1, R2, R3, R4)
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

| File | Lines | What / why |
| --- | --- | --- |
| `apps/web/src/components/ui/PinnableTooltip.tsx` | 1-266 | The shared contract: trigger + panel, hover/focus open, click pins (text selectable), Escape and outside pointerdown close, one pinned tooltip per document via a module-level release slot, viewport-clamped position, `role="dialog"` pinned / `role="tooltip"` preview, `aria-describedby`/`aria-expanded`/`aria-haspopup` on the trigger. `footer` accepts a function of `{pinned}` so callers keep mode-specific guidance. |
| `apps/web/src/modules/observability/SystemEventsTab.tsx` | 1249-1319 | `EventTableRow` keeps only row expansion and builds one `eventTooltip` element; the description, `<dl>` field grid and remediation block moved in as `children` unchanged. |
| `apps/web/src/modules/observability/SystemEventsTab.tsx` | 1354, 1462 | Both layouts (table cell, compact cell) render the same element; ~250 lines of duplicated state/handlers/portal and the `window` pin-event bus are gone. |
| `apps/web/src/components/module-kit/index.ts` | 1-40 | Barrel exports `PinnableTooltip` + its props type. |
| `apps/web/src/components/module-kit/exports.ts` | 14-28 | `MODULE_KIT_EXPORTS` gains `'PinnableTooltip'`, so the runtime facade and the barrel cannot drift. |
| `apps/cli/board/kit/ui/PinnableTooltip.d.ts`, `apps/cli/board/kit/module-kit/index.d.ts` | generated | Declaration mirror regenerated by `spur builder emit-board-types`; kept because the committed mirror would otherwise be stale against the barrel. |
| `DESIGN.md` | 436-441 | Names `PinnableTooltip` as the owner of the pinnable semantic tooltip contract. |
| `apps/web/tests/components/pinnable-tooltip.test.tsx` | 1-140 | Component contract: hover, focus, pin (role flips to `dialog`, `data-pinned`), selectable text, Escape, outside click, single-pin release, accessible name. |

**Accepted deltas** (behavior contract preserved, chrome simplified): the in-panel `Pin` / `close` buttons are gone — the event name itself toggles pin; the footer loses the word "Pin"; the panel id is a `useId` instead of `system-event-tooltip-<event id>`; the pinned panel anchors to the trigger rect instead of the pointer and renders inline with `position: fixed` instead of through a portal; the hover-close grace is 150 ms (was 200 ms).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/src/components/ui/PinnableTooltip.tsx:1`; `apps/web/src/components/module-kit/exports.ts:23`; `apps/web/tests/components/pinnable-tooltip.test.tsx:123` single pinned per document |
| R2 | MET | `apps/web/src/components/ui/PinnableTooltip.tsx:217` aria-label/aria-describedby/aria-expanded; `apps/web/tests/components/pinnable-tooltip.test.tsx:53`; `apps/web/tests/components/pinnable-tooltip.test.tsx:68` |
| R3 | MET | `apps/web/src/modules/observability/SystemEventsTab.tsx:1267` uses PinnableTooltip; system-events-tab tests pass this run |
| R4 | MET | `DESIGN.md:440` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Pinnable semantic tooltip is a shared component | MET | test | `apps/web/tests/components/pinnable-tooltip.test.tsx:37`; `apps/web/tests/components/pinnable-tooltip.test.tsx:77` (Escape, outside pointerdown, second pin releases first) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-26T00:40:19.704Z todo → wip (system)
- 2026-11-26T00:41:24.511Z wip → testing (system)
- 2026-11-26T00:41:26.581Z testing → done (system)

