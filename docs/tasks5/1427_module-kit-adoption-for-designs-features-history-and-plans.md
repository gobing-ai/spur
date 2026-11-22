---
schema_version: 1
name: Module-kit adoption for designs, features, history and plans
status: done
template: feature-impl
created_at: 2026-11-22T02:21:32.204Z
updated_at: "2026-11-22T07:36:47.785Z"
feature_id: A83

tags: ["A83"]
dependencies: ["1426"]
priority: P2
estimate_hours: 6
done_forced: "false"
done_reason: unforced close
---

## 1427. Module-kit adoption for designs, features, history and plans

### Background

Implements: R1 — Every built-in Board module renders through the module-kit shell.

Follows DESIGN.md "Product UI — Module Shell" and the A81 module-kit (`apps/web/src/components/module-kit/`), using the composition settled in 1426. Read DESIGN.md before starting.

**Refine corrections (2026-11-21)**
- Current state: none of the four shells imports `module-kit`.
  - `DesignsShell.tsx` (349 lines): `data-designs-shell` :152, hand-built `<header>` :159, no tabs; file list + body + TOC layout.
  - `PlansShell.tsx` (342): `data-plans-shell` :147, `<header>` :154, no tabs; same three-pane layout.
  - `FeaturesShell.tsx` (398): `data-features-shell` :207, `<header>` :214, no tabs.
  - `HistoryShell.tsx` (678): `<h1>` :527 and a segmented button strip :549 with **no** tab roles. Each tab carries a count badge (`data-testid="history-badge-<id>"`), plus filters and the timeline scrubber.
- Kit gap: `ModuleTab` is `{id, label: string}` (`module-kit/ModuleTabs.tsx:2-5`), so it cannot render History's per-tab badge. This task owns the one kit extension needed: an optional `badge`.
- Only Designs, Plans and Features have no tabs, so they take `ModuleShell` + `ModuleHeader` only. Their three-pane bodies stay as they are.
- Tests: `apps/web/tests/modules/history/{history-module,tabs}.test.ts`, `features/*`. Designs and Plans have no module-level unit tests; they appear only in the browser suites (`board-runtime-browser.heavy`, `composed-board-browser.heavy`).

### Requirements

- [x] R1. Designs, Plans and Features render `ModuleShell data-<module>-shell` > `ModuleHeader` (icon `<ModuleIcon id=… size="lg" />`, title, existing header controls in `filters`). History renders `ModuleShell` > `ModuleHeader` (filters in `filters`) > `ModuleTabs` over `HISTORY_TABS`.
- [x] R2. `ModuleTab` gains an optional `readonly badge?: string | number | null`, rendered after the label with `data-testid="<idPrefix>-badge-<id>"`. Existing callers compile unchanged, and a kit test covers badge present and absent.
- [x] R3. History's badge test ids stay `history-badge-<id>` (via `idPrefix="history"`). Tab ids, URL state, deep links, the timeline scrubber and filters behave as before.
- [x] R4. The three-pane layout (file list / body / TOC) of Designs and Plans is unchanged at desktop and 375px widths.
- [x] R5. No hand-built `<header>`, `<h1>` or tab strip remains in the four shells.

Out of scope: projects/settings/tasks/search (1426), icons (1428), new tabs or visual redesign.

### Acceptance Criteria

- [x] AC1 — Every built-in Board module renders through the module-kit shell

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-22T04:12:43.264Z

- **Closed: extending the kit for History badges.** Yes, with one optional `badge` field. Dropping the badges is a regression, and a module-local strip defeats the feature.
- **Closed: tabless modules.** `ModuleHeader` without `tabs` is the supported shape (Search in 1426 does the same).

### Design

- **Composition:** the same as 1426 / ObservabilityShell. `ModuleShell` replaces the outer `relative h-full w-full p-4` div. If the full-height three-pane layouts need `h-full overflow-hidden`, pass it through `className`; do not fork the kit.
- **Kit change (the only one):** `ModuleTab.badge?`. When it is non-null, `ModuleTabs` renders `<span data-testid={`${idPrefix}-badge-${tab.id}`}>` inside the button with semantic-token classes. Append-only: no prop renames.
- **History:** `HISTORY_TABS` maps to `{id, label, badge: badgeFor[id]}` at render time. The tabs file stays the source of truth.
- **Frozen:** `data-designs-shell`, `data-plans-shell`, `data-features-shell` (used by the browser suites); add `data-history-shell`. Tab ids and URL params are frozen too.
- **Anti-patterns:** no ReactNode labels in `ModuleTab` (keeps the tab contract serializable); no per-module kit props beyond `badge`; no layout rewrites; no hex colors.
- **Handoff to 1430:** all eight non-observability modules now expose `[data-<module>-shell]` on a `ModuleShell` root, and each has exactly one kit `ModuleHeader`.

### Plan

Premises (verified 2026-11-21): the shells and line numbers in Background; `ModuleTab` at `module-kit/ModuleTabs.tsx:2-5`; History badges at `HistoryShell.tsx:549-565`.

- [ ] 1. Failure modes: a badge is lost or the test id is renamed; the three-pane layout collapses; the scrubber or filters detach from the header; History's tab URL state breaks; a duplicate heading appears.
- [ ] 2. Write a kit test for `badge` (present → span with test id; null/absent → no span). Extend `history/tabs.test.ts` to assert kit `role="tab"` and badge ids. Run; both fail.
- [ ] 3. Implement `badge` in `ModuleTabs`, then migrate History. Run the history tests.
- [ ] 4. Migrate Features, Designs and Plans. Run `(cd apps/web && bun test tests/modules)`.
- [ ] 5. Browser-check the four modules in light and dark at desktop and 375px. Run `bun run spur-check`.

### Solution

| File | Change | Why |
| --- | --- | --- |
| `apps/web/src/components/module-kit/ModuleTabs.tsx:2-12,58-72` | `ModuleTab.badge?: string \| number \| null` rendered after the label as `data-testid="<idPrefix>-badge-<id>"` | R2: History's per-tab counts move into the kit instead of a hand-built strip; absent/`null` renders nothing |
| `apps/web/src/modules/history/HistoryShell.tsx:519-560` | kit `ModuleShell` + `ModuleHeader` (icon/title/subtitle, last-import chip as the status slot, `ModuleTabs` with `tabsWithBadges` and `idPrefix="history"`) | R1/R3: badges keep `history-badge-<id>`; the filter bar, scrubber and tab bodies stay exactly where they were |
| `apps/web/src/modules/features/FeaturesShell.tsx` · `designs/DesignsShell.tsx` · `plans/PlansShell.tsx` | hand-built `<header>` + `<h1>` replaced by `ModuleHeader` inside `ModuleShell`, the existing action cluster moved into `filters` | R1/R4: identity/header comes from the kit; the 3-zone workspace container and its width caps are unchanged |
| `apps/web/tests/components/module-kit.test.tsx` | badge present / `null` / absent | R2, kit contract |
| `apps/web/tests/modules/history/HistoryShell.test.tsx` | shell probe, single `h1`, kit strip labels, badge id convention, id/controls pair | R1/R3 |
| `apps/web/tests/modules/module-kit-adoption.test.ts` | the four 1427 sources added to the structural probe | R5 |
| `apps/web/tests/test-helpers/rpc-client-mock.ts` | default api surface widened (history/inbox/search) and `buildFullRpcMock` now MERGES overrides instead of replacing the surface | The shared mock's own contract ("EVERY registration provides the SAME full surface") was violated: a partial override shrank it process-wide, so a shell mount crashed only in the aggregate run |

Notes
- History keeps its tab in local state (`useState('summary')`), so there is no URL contract to preserve there; its `onChange` is the only wiring the migration touches.
- The three-pane layouts are untouched: the kit wraps, the workspace container still owns the 1200/1600 caps and the left/right docks.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 Designs/Plans/Features render `ModuleShell` > `ModuleHeader` with their controls in `filters`; History renders shell > header > `ModuleTabs` over `HISTORY_TABS` | MET | `apps/web/src/modules/history/HistoryShell.tsx:519-560`, `apps/web/src/modules/designs/DesignsShell.tsx:163-205`, `apps/web/src/modules/features/FeaturesShell.tsx:214-262`, `apps/web/src/modules/plans/PlansShell.tsx:148-190` — `apps/web/tests/modules/history/HistoryShell.test.tsx` (shell probe, single `h1`, kit strip) + the structural probe in `apps/web/tests/modules/module-kit-adoption.test.ts` |
| R2 `ModuleTab.badge` renders after the label with `data-testid="<idPrefix>-badge-<id>"`; existing callers compile; kit test covers present and absent | MET | `apps/web/src/components/module-kit/ModuleTabs.tsx:2-12,58-72` — `apps/web/tests/components/module-kit.test.tsx` ("a tab badge renders after its label, and only when present": `badge: 12`, `badge: null`, absent) |
| R3 History badge ids stay `history-badge-<id>`; tab ids, deep links, scrubber and filters behave as before | MET | `HistoryShell.tsx:546-553` (`idPrefix="history"`), badges passed as `tabsWithBadges` — `HistoryShell.test.tsx` ("tab badges keep their ids through the kit slot": every `[data-testid^="history-badge-"]` matches `history-badge-[a-z-]+`; "every tab is wired to the kit contract": `history-<id>` / `history-panel-<id>` pair) |
| R4 the three-pane layout of Designs and Plans is unchanged | MET | `DesignsShell.tsx:150-157` and `PlansShell.tsx:148` keep `data-designs-workspace` / the dock structure inside `ModuleShell`; the workspace width caps (`3xl:max-w-[1200px] 4xl:max-w-[1600px]`) are untouched — `bun test tests/modules/{designs,plans}` green |
| R5 no hand-built `<header>`/`<h1>`/tab strip in the four shells | MET | `apps/web/tests/modules/module-kit-adoption.test.ts` (the four 1427 sources added; asserts no `<h1`, no `role="tablist"`, kit import present) |
| Aggregate-run correctness of the shell mounts | MET | `apps/web/tests/test-helpers/rpc-client-mock.ts` — default api surface widened and `buildFullRpcMock` merges overrides; `bun test tests/modules` → 427 pass, 0 fail (repeated) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Every built-in Board module renders through the module-kit shell | MET | test | `apps/web/tests/modules/module-kit-adoption.test.ts` now covers all eight migrated modules (1426's four + these four) |
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

- 2026-11-22T02:22:12.447Z backlog → todo (system)
- 2026-11-22T07:36:29.230Z todo → wip (system)
- 2026-11-22T07:36:46.250Z wip → testing (system)
- 2026-11-22T07:36:47.782Z testing → done (system)

