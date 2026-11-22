---
schema_version: 1
name: Module-kit adoption for designs, features, history and plans
status: todo
template: feature-impl
created_at: 2026-11-22T02:21:32.204Z
updated_at: "2026-11-22T04:12:43.649Z"
feature_id: A83

tags: ["A83"]
dependencies: ["1426"]
priority: P2
estimate_hours: 6
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

- [ ] R1. Designs, Plans and Features render `ModuleShell data-<module>-shell` > `ModuleHeader` (icon `<ModuleIcon id=… size="lg" />`, title, existing header controls in `filters`). History renders `ModuleShell` > `ModuleHeader` (filters in `filters`) > `ModuleTabs` over `HISTORY_TABS`.
- [ ] R2. `ModuleTab` gains an optional `readonly badge?: string | number | null`, rendered after the label with `data-testid="<idPrefix>-badge-<id>"`. Existing callers compile unchanged, and a kit test covers badge present and absent.
- [ ] R3. History's badge test ids stay `history-badge-<id>` (via `idPrefix="history"`). Tab ids, URL state, deep links, the timeline scrubber and filters behave as before.
- [ ] R4. The three-pane layout (file list / body / TOC) of Designs and Plans is unchanged at desktop and 375px widths.
- [ ] R5. No hand-built `<header>`, `<h1>` or tab strip remains in the four shells.

Out of scope: projects/settings/tasks/search (1426), icons (1428), new tabs or visual redesign.

### Acceptance Criteria

- [ ] AC1 — Every built-in Board module renders through the module-kit shell

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-22T02:22:12.447Z backlog → todo (system)

