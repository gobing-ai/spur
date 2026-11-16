---
schema_version: 1
name: Extract Board shell primitives into a shared module kit and adopt them in a built-in shell
status: done
template: feature-impl
created_at: 2026-11-16T19:08:27.314Z
updated_at: "2026-11-16T19:52:29.899Z"
feature_id: A81
priority: P1
tags:
  - board
  - web
  - refactor

estimate_hours: 5
done_forced: "false"
done_reason: unforced close
---

## 1348. Extract Board shell primitives into a shared module kit and adopt them in a built-in shell

### Background

Implements: R2 — Built-in shells render through shared shell primitives without visual regression.

Built-in shells inline their ADR-081 header/tab markup and keep TimeRangePresets module-private, so nothing reusable exists to share. Design: [board-module-ui-kit](docs/design/board-module-ui-kit.md) §3.1 and §4 export set. Prerequisite for the facade task.

Rubric: E5 D1 L1 C0 R1 = 8 → own task (regression risk on built-in shells).


**Refine corrections (2026-11-16)**
- "Extract EmptyState / Diagnostic from existing usage" → no shared EmptyState exists; empty states are inline per tab (e.g. apps/web/src/modules/observability/JobsTab.tsx:304), and the diagnostic presentation is `ModuleDiagnostic` (apps/web/src/components/ModuleErrorBoundary.tsx:31) → EmptyState lifts the JobsTab markup; `Diagnostic` is a context-free presentational wrapper reused by `ModuleDiagnostic`.
- "Observability is smallest" confirmed: ObservabilityShell.tsx is 160 lines (TasksShell 223, HistoryShell 678).
- `Loading`, `Card`, `Badge`, `Button` confirmed in apps/web/src/components/ui/.

### Requirements

- [x] R1. Create apps/web/src/components/module-kit/index.ts exporting ModuleShell, ModuleHeader, ModuleTabs, TimeRangePresets (moved from observability/ObservabilityFilters.tsx), EmptyState (from JobsTab empty markup), Diagnostic (presentational core of ModuleDiagnostic), and re-exports of Loading, Card, Badge, Button; out of scope: adopting the kit in shells other than Observability.
- [x] R2. Components are presentational and controlled: no host context, router, rpc or registry imports; URL state stays in callers.
- [x] R3. At least one built-in shell (Observability recommended; smallest) renders through the kit with unchanged layout, a11y roles and URL state.
- [x] R4. Existing shell tests pass unchanged; add kit tests for tab keyboard/aria behavior and controlled change callbacks.

### Acceptance Criteria

- [x] AC1 — Built-in shells render through shared shell primitives without visual regression

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T19:09:15.789Z

- **Closed:** Observability adopts the kit first (smallest shell, 160 lines); other built-in shells adopt opportunistically, not in this task.
- **Closed:** kit components are controlled and context-free because contributions share React but not host context (downstream design §6.6).

### Design

Approach: lift the exact markup/classes from ObservabilityShell header + tab strip and observability TimeRangePresets into props-driven components; Observability adopts first, others may follow.
Rejected: new restyled components (would change built-in visuals and widen scope); context-based API (contributions do not share host context).
Invariants: props are the public contract, not class names; no visual change to adopting shells; Tailwind classes stay inside apps/web/src so the host CSS build includes them.
Key signatures: ModuleHeader({icon,title,subtitle?,status?,filters?,tabs?}); ModuleTabs({tabs,value,onChange,label}).

Frozen names: directory `apps/web/src/components/module-kit/`, barrel `index.ts`; exports exactly ModuleShell, ModuleHeader, ModuleTabs, TimeRangePresets, EmptyState, Diagnostic, Loading, Card, Badge, Button. `ObservabilityFilters.tsx` re-imports TimeRangePresets from the kit (no duplicate).
Anti-patterns: no `useSearchParams`, rpc, registry or theme context inside module-kit; no new styles.
Leaves for 1349: a barrel with value exports only (no default export) so the facade can re-export it by name.

### Plan

1. Create module-kit components from existing markup
2. Re-export Card/Badge/Button
3. Switch ObservabilityShell to the kit
4. Kit tests + existing shell tests
5. Browser-check Observability in both themes

### Solution

| File | Change |
| --- | --- |
| `apps/web/src/components/module-kit/ModuleShell.tsx:1-27` | Page container lifted from the Observability root: `p-4`, `gap-4`, the centered `max-w-[1600px]` rail (a caller passes `max-w-none` for the ADR-081 full-bleed body), extra attributes passed through so a module keeps its own marker. |
| `apps/web/src/components/module-kit/ModuleHeader.tsx:1-45` | The one header row as slots: `icon`, `title` (`h1`), `subtitle`, `status` chip, `filters`, `tabs` — markup and classes copied from the shipped shell, so adoption cannot shift the layout. |
| `apps/web/src/components/module-kit/ModuleTabs.tsx:1-63` | Controlled `role="tablist"` strip: `aria-selected` from `value`, `${idPrefix}-${id}` / `${idPrefix}-panel-${id}` pairing, `onChange(id)`; no state inside. |
| `apps/web/src/components/module-kit/TimeRangePresets.tsx:1-48` | Range chip group moved out of `observability/ObservabilityFilters.tsx`, generic over the preset vocabulary (`presets` prop) so a contribution supplies its own ranges instead of inheriting observability's. |
| `apps/web/src/components/module-kit/EmptyState.tsx:1-24` | The empty-state markup lifted from `JobsTab`, now the one shape a view renders for a known-empty result. |
| `apps/web/src/components/module-kit/Diagnostic.tsx:1-44` | Presentational core of `ModuleDiagnostic` with title/detail/code/hint slots and an `error` (alert) / `warning` (status) tone; `data-*` anchors pass through. |
| `apps/web/src/components/module-kit/index.ts:1-24` | Barrel: value exports only (no default), re-exporting `Loading`/`Card`/`Badge`/`Button` from the ui seam by their own files so the kit does not pull the markdown-editor barrel into the contribution chunk. |
| `apps/web/src/modules/observability/ObservabilityShell.tsx:4-134` | Observability adopts the kit: shell, header slots (the liveness chip stays shell-owned), range presets and tab strip; the tab click/reset-intent handler, URL read, panel ids and `data-observability-shell` marker are unchanged. |
| `apps/web/src/modules/observability/ObservabilityFilters.tsx:44-50` | `TimeRangePresets` now re-exported from the kit (no duplicate); the module keeps only its range vocabulary (`TIME_RANGES`, `TIME_RANGE_MS`, `timeRangeSince`). |
| `apps/web/src/modules/observability/JobsTab.tsx:10,305` | Jobs empty state renders through `EmptyState` with its existing `jobs-empty-state` test id — the markup now has one source. |
| `apps/web/src/components/ModuleErrorBoundary.tsx:3,31-44` | `ModuleDiagnostic` renders through `Diagnostic`, keeping role=alert and the `module-diagnostic` / `data-module-id` / `data-failure-category` anchors the heavy browser test asserts. |
| `apps/web/tests/components/module-kit.test.tsx:1-220` | New kit suite: tab ARIA (`tablist`/`tab`/`aria-selected`/`aria-controls`) and controlled change callbacks, range-preset `aria-pressed` and callbacks, shell/header slot composition, the pinned ADR-081 classes, empty/diagnostic states, and the context-free assertion (no router/rpc/registry/context import in any kit file; barrel has no default export). |

Verification: `spur task gate 1348 light` PASS (20 changed files; rules:pre, rules:post, typecheck:apps/web, test:apps/web, test:plugins/sp); `bun test tests/components tests/modules/observability tests/modules/compose.test.ts` 104 pass / 0 fail. Plan step 5 (browser check in both themes) is deferred to the feature's integrated full gate (`spur feature verify A81` runs test:heavy), per the pipeline's DEFERRED gate tier; the visual contract is pinned structurally by the class assertions above.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — `apps/web/src/components/module-kit/index.ts` exports ModuleShell, ModuleHeader, ModuleTabs, TimeRangePresets (moved out of `observability/ObservabilityFilters.tsx`), EmptyState (from the JobsTab empty markup), Diagnostic (presentational core of ModuleDiagnostic), plus re-exports of Loading/Card/Badge/Button; no other shell adopts the kit | MET | `apps/web/src/components/module-kit/index.ts:10-24` (value exports only, no default); components at `ModuleShell.tsx:1-27`, `ModuleHeader.tsx:1-45`, `ModuleTabs.tsx:1-63`, `TimeRangePresets.tsx:1-48`, `EmptyState.tsx:1-24`, `Diagnostic.tsx:1-44`; the observability duplicate is gone (`apps/web/src/modules/observability/ObservabilityFilters.tsx:51` re-exports the kit component); TasksShell/HistoryShell untouched (`git diff --name-only` lists no other shell) |
| R2 — components are presentational and controlled: no host context, router, rpc or registry import; URL state stays in callers | MET | test — `apps/web/tests/components/module-kit.test.tsx:203-216` asserts no kit file matches `react-router`/`rpc-client`/`registry`/`../../modules` and none uses `createContext`/`useSearchParams`; the shell still owns `useSearchParams` and the tab-click/nav-intent handler (`apps/web/src/modules/observability/ObservabilityShell.tsx:11-56,108-115`) |
| R3 — at least one built-in shell renders through the kit with unchanged layout, a11y roles and URL state | MET | `apps/web/src/modules/observability/ObservabilityShell.tsx:79-134` (shell + header slots + presets + tabs); the `data-observability-shell` marker, the `?tab=` read, the `observability-tab-*` ids, `aria-controls` pairs, the `role="status"` liveness chip and the tabpanel wiring are byte-identical to the pre-change markup; ADR-081 classes are pinned by test `apps/web/tests/components/module-kit.test.tsx:130-152` |
| R4 — existing shell tests pass unchanged; kit tests cover tab keyboard/aria behavior and controlled change callbacks | MET | `command` — `spur task gate 1348 light` PASS (`.spur/run/1348-check-receipt.json`: format-lint, rules:pre, rules:post, typecheck:apps/web, test:apps/web, test:plugins/sp); `bun test tests/components tests/modules/observability tests/modules/compose.test.ts` 104 pass / 0 fail with no existing test edited (the diff touches no file under `apps/web/tests` except the new kit suite); `test` — `apps/web/tests/components/module-kit.test.tsx:30-96` (tab roles, `aria-selected`, `aria-controls`/id pairing, click→handler, uncontrolled selection stays put; preset `aria-pressed` and click→handler) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Built-in shells render through shared shell primitives without visual regression | MET | test | `apps/web/tests/components/module-kit.test.tsx:130-152` pins the ADR-081 header row and tab-strip classes and asserts the shells' slots compose; `bun test tests/components tests/modules/observability` 104 pass / 0 fail; the extraction copied markup rather than restyling (`ModuleHeader.tsx:33-45`, `ModuleTabs.tsx:40-62`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Functional + SECUA focus: PASS. All four requirements and AC1 carry direct evidence — the kit barrel and its seven files (`apps/web/src/components/module-kit/index.ts:10-24`), the Observability adoption (`ObservabilityShell.tsx:79-134`), the de-duplicated `TimeRangePresets` re-export (`ObservabilityFilters.tsx:51`), the two secondary adopters (`JobsTab.tsx:305`, `ModuleErrorBoundary.tsx:32-44`), and the new suite (`apps/web/tests/components/module-kit.test.tsx:1-226`, 12 pass). Existing shell tests were not edited and pass: `bun test tests/components tests/modules/observability tests/modules/compose.test.ts` → 104 pass / 0 fail; light gate PASS on all six checks.

Findings (advisory, none blocking):

- **P4** — the tab strip keeps the shipped interaction model (native buttons in DOM order, no roving tabindex/arrow keys). Unchanged here and required by R3, but the kit is now the shared home of that behavior: add APG arrow-key handling there once, for built-ins and contributions together.
- **P4** — `EmptyState` takes no `className`; add it when a second consumer needs different padding.
- **P4** — the Observability liveness chip stays shell-owned (module-specific); widening the frozen export set needs a second consumer.

Residual risk: Plan step 5 (browser check, both themes) is deferred to the feature's integrated full gate (`spur feature verify A81` runs `test:heavy`), per the pipeline's DEFERRED gate tier. The visual contract is pinned structurally instead: the exact ADR-081 header/tab classes and the unchanged shell marker, tab ids and `aria-controls` pairs. Disposition: PASS, no follow-up filed.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-16T19:51:47.571Z todo → wip (system)
- 2026-11-16T19:52:28.636Z wip → testing (system)
- 2026-11-16T19:52:29.895Z testing → done (system)

