---
schema_version: 1
name: "Left sidebar optimization: default folded state, dedicated utility footer, and module normalization"
status: done
template: feature-impl
created_at: 2026-09-06T03:28:02.303Z
updated_at: "2026-09-06T04:59:44.642Z"
feature_id: A7
priority: P2
tags: ["web", "layout", "sidebar"]
---

## 0778. Left sidebar optimization: default folded state, dedicated utility footer, and module normalization

### Background

Spur Board's left rail (`apps/web/src/components/LeftSidebar.tsx`) defaults to expanded, keeps the
theme toggle in the expanded header only, and orders modules by an inconsistent `order` field. This
task lands feature A7 scenarios **R1, R2, R3**.

**Verified ground truth (2026-09-05, current tree):**

| Claim | Verified state |
| --- | --- |
| Default collapse | `apps/web/src/lib/layout-state.ts:12` — `DEFAULTS.sidebarCollapsed: false` |
| Collapsed rail width | `apps/web/src/styles/board-layout.css:33` — `--sidebar-w: 48px` (**not** the 56px quoted in `docs/design/board-ui-layout-and-global-agent-bar.md` §2/§3.2) |
| Theme toggle position | `LeftSidebar.tsx` expanded header action group only; **absent** in the collapsed rail |
| Sidebar footer | Does not exist — `<aside>` holds header + `<nav>` only |
| Settings trigger | Does not exist anywhere in `apps/web` |
| Module `order` values | observability `0`, workspace `0` (**duplicate**), inbox `1`, teams `2`, history `3`; `features` and `task-kanban` declare **no** `order` |
| Effective sidebar order today | Observability, Workspace, Inbox, Teams, History, Features, Tasks |
| Module ids vs. directories | `src/modules/task-kanban/` exports `id: 'tasks'`; the design doc's "`task-kanban` (order 40)" names the **directory**, not the id |
| Module labels | `observability` → `Observability`, `history` → `History`, `features` → name `Feature Board` / `sidebarLabel` `Features` |
| Tooltip surface | `LeftSidebar.tsx` uses the bare `title={mod.name}` attribute when collapsed — no rich tooltip, and it reads `mod.name` while the expanded label reads `mod.sidebarLabel ?? mod.name` (inconsistent) |
| `WebModule` shape | `src/modules/types.ts` — **no `description` field exists**; a capability blurb has nowhere to live today |

Two corrections to the parent design doc are folded into the Design below: the rail is **48px**, and
`WebModule` needs a **new optional `description` field** before R6-style tooltips are possible.

### Requirements

- **R1.** `apps/web/src/lib/layout-state.ts` `DEFAULTS.sidebarCollapsed` is `true`, so a clean or
  reset session mounts the board with the rail folded. Persisted explicit choices still win
  (`loadLayoutState` already prefers a stored boolean).
- **R2.** `LeftSidebar` renders a dedicated footer region, pinned to the bottom of the `<aside>`,
  above nothing else, carrying exactly two controls: the existing `ThemeToggle` and a new settings
  icon button. Expanded → horizontal row; collapsed → vertical icon stack.
- **R3.** `ThemeToggle` is rendered **once**, from the footer, in both collapse states, and is
  removed from the expanded header action group.
- **R4.** `observability` is labelled `Observabilities` and `history` is labelled `Histories` in the
  sidebar; the collapsed-rail tooltip and the expanded label read from the same source.
- **R5.** All seven modules declare an explicit `order`: observability `10`, history `20`,
  features `30`, tasks `40`, workspace `50`, inbox `60`, teams `70` — eliminating the current
  duplicate `order: 0` and the two undeclared modules.
- **R6.** In collapsed rail mode each nav item exposes a rich tooltip carrying the module's label
  and a one-line capability description, rendered without being clipped by the 48px rail.
- **R7.** The mobile drawer (`<md`) continues to render labels, the project switcher, and the
  "Close navigation" control regardless of the persisted desktop collapse state.
- **R8.** The settings icon button opens a placeholder settings modal; it is never a dead control.

**Out of scope:** settings persistence or real settings content (placeholder body only);
`BoardLayout` spacing/border polish and Open Design verification (task 0780); the global agent bar
(task 0779); any change to `--sidebar-w` (48px collapsed / 240px expanded stay as they are).

### Acceptance Criteria

```gherkin
Feature: Spur Board layout optimization and global orchestrator agent interface

  @core
  Scenario: R1 — Default folded left sidebar navigation rail
    Given a user accesses Spur Board on a clean or reset session
    When the board layout mounts
    Then the left navigation sidebar renders in collapsed rail mode by default
    And the main workspace canvas expands to occupy the reclaimed viewport width

  @core
  Scenario: R2 — Left sidebar footer with theme toggle and settings triggers
    Given the left sidebar navigation component
    When the sidebar is expanded
    Then a dedicated footer area renders at the bottom containing the theme switcher and a settings icon button
    And collapsing the sidebar into rail mode transitions the footer area into a vertical icon list displaying the theme switcher and settings icon buttons

  @core
  Scenario: R3 — Module ordering, plural nomenclature, and rich tooltips
    Given the navigation module registry and sidebar items
    When the sidebar renders
    Then modules display in order: Observabilities, Histories, Features, Tasks, Workspace, Inbox, Teams
    And the observability module is titled "Observabilities"
    And the history module is titled "Histories"
    And hovering over any module icon in folded mode displays an enhanced tooltip with its title and capability description
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-06T03:42:41.613Z

- **Rail width — 48px, not 56px.** `board-layout.css:33` already sets `--sidebar-w: 48px` when
  `data-sidebar-collapsed="true"`, and the grid derives every column from that var. The design doc's
  `w-[56px]` is aspirational prose, not shipped CSS. **Decision:** keep 48px; changing it is a
  layout-wide reflow with no requirement behind it. Two 32px icon buttons stack comfortably inside 48px.
- **Where does the capability blurb live?** `WebModule` has no `description`. Options were a
  sidebar-local id→text map or a field on the module descriptor. **Decision:** add
  `readonly description?: string` to `src/modules/types.ts` — the module already owns its own
  `name` / `icon` / `sidebarLabel`, so a lookup table in `LeftSidebar` would be the only place in
  the app where a module's identity lives outside the module. Optional, so no module is forced to
  declare one and `isWebModule` stays unchanged.
- **Tooltip mechanism.** daisyUI 5's `tooltip` is CSS-only (`content: attr(data-tip)`), which is
  what `@/ui`'s `Tooltip` wraps. **Decision:** reuse it — no new dependency, no popover library.
  Two lines come from a `\n` in `data-tip` plus `[&:before]:whitespace-pre-line` on the host
  (bare `attr()` collapses newlines).
- **Tooltip clipping — the real blocker.** The `<aside>` carries `overflow-hidden` and the `<nav>`
  carries `overflow-y-auto`; a `tooltip-right` bubble painted outside a 48px rail is clipped by
  both, and `overflow-x: visible` computes to `auto` whenever `overflow-y` is not `visible`.
  **Decision:** in collapsed mode only, drop `overflow-hidden` from the `<aside>` and use
  `overflow-visible` on the `<nav>`. Seven items at ~44px each is ~310px — the rail never needs to
  scroll. Expanded mode keeps today's `overflow-hidden` / `overflow-y-auto` unchanged.
- **Mobile drawer regression from R1.** The `<md` drawer is a fixed 280px overlay
  (`board-layout.css` `@media (max-width: 767px)`), but React still renders whatever `collapsed`
  says — so defaulting to `true` would ship a mobile drawer with no labels, no project switcher, and
  no "Close navigation" button (which today only exists in the expanded branch and is asserted by
  `tests/components/ResponsiveAndTheme.test.tsx` *sidebar close button closes the drawer*).
  **Decision:** `BoardLayout` passes `collapsed={state.sidebarCollapsed && !mobileSidebarOpen}` —
  one expression, uses state that already exists, fixes the UX and the test together.
- **Settings modal ownership — moved into this task.** Task 0780 R2 nominally owns
  `SettingsModal.tsx`, but 0778 R2 ships the button that opens it; shipping a no-op control is worse
  than a 15-line placeholder. **Decision:** 0778 creates `src/components/SettingsModal.tsx` (a thin
  `@/ui` `Modal` wrapper with placeholder copy) and owns the open/close state inside `LeftSidebar`.
  0780 R2 is correspondingly narrowed to verifying and polishing it. Recorded in 0780's Q&A too.
- **Default landing route is unaffected.** `defaultModule` is the first enabled module;
  `observability` is first today (`order: 0`) and first after renumbering (`order: 10`), so
  `/board` → `/board/observability` does not move.
- **Deferred:** settings persistence and real settings content (no backend surface in A7 scope);
  `⌘K` keyboard access to the rail (belongs with the agent bar in 0779, not the sidebar).

### Design

**WHAT.** Fold the rail by default, give it a footer that survives collapse, and make module
identity (order, label, capability blurb) declarative on the module descriptor rather than
positional or hard-coded in the sidebar.

**WHY.** Every one of R1–R6 is a small edit; the risk is entirely in the seams they disturb — the
mobile drawer shares the `collapsed` prop, the tooltip is clipped by two ancestors' `overflow`, and
four existing tests encode today's defaults. Those seams are the design.

**WHERE — frozen surfaces.**

| File | Change |
| --- | --- |
| `apps/web/src/lib/layout-state.ts:12` | `sidebarCollapsed: false` → `true` |
| `apps/web/src/modules/types.ts` | add `readonly description?: string` to `WebModule` |
| `apps/web/src/modules/{observability,history,features,task-kanban,workspace,inbox,teams}/index.tsx` | set `order`; set `sidebarLabel`; add `description` |
| `apps/web/src/components/LeftSidebar.tsx` | footer region; `ThemeToggle` header→footer; `Tooltip` per nav item; collapse-conditional `overflow` |
| `apps/web/src/components/SettingsModal.tsx` | **new** — placeholder modal |
| `apps/web/src/components/BoardLayout.tsx` | `collapsed={state.sidebarCollapsed && !mobileSidebarOpen}` |

**Frozen names.** Field `description` on `WebModule` (optional, one line, sentence case, no trailing
period). Component `SettingsModal`, default export, props `{ open: boolean; onClose: () => void }`.
Test ids: `sidebar-footer`, `sidebar-settings`. Settings button `aria-label="Open settings"`.
No other new exports, props, flags, or CSS variables.

**Module descriptor table — the exact values to write.**

| Directory | `id` | `order` | `sidebarLabel` | `description` |
| --- | --- | --- | --- | --- |
| `observability` | `observability` | `10` | `Observabilities` | `Real-time system events, execution traces, and agent doctor telemetry` |
| `history` | `history` | `20` | `Histories` | `Imported agent sessions, token analytics, and tool-call forensics` |
| `features` | `features` | `30` | `Features` | `Feature tree, acceptance criteria, and decomposition into tasks` |
| `task-kanban` | `tasks` | `40` | `Tasks` | `Task kanban, lifecycle status, and per-task detail` |
| `workspace` | `workspace` | `50` | `Workspace` | `Repository state, working tree, and project surfaces` |
| `inbox` | `inbox` | `60` | `Inbox` | `Agent messages, coordination requests, and notifications` |
| `teams` | `teams` | `70` | `Teams` | `Agent roster, team membership, and member terminals` |

`compareModules` (`discover.ts`) already sorts declared `order` ascending; with all seven declared,
both discovery paths (glob-by-id and fs-by-dirname) converge on this order deterministically —
no change to `discover.ts` or `registry.ts` is needed or wanted.

**Sidebar structure (collapsed / expanded).**

```text
<aside class="flex flex-col bg-spur-surface border-r border-spur-border
              {collapsed ? '' : 'overflow-hidden'}">
  header   → collapsed: centered expand chevron │ expanded: ProjectSwitcher + collapse + mobile ✕
  nav      → flex-1 {collapsed ? 'overflow-visible' : 'overflow-y-auto'}
              collapsed item: <Tooltip position="right" tip={`${label}\n${description}`}
                                       className="[&:before]:whitespace-pre-line block">
                                <NavLink …>{icon}</NavLink>
                              </Tooltip>
  footer   → border-t border-spur-border shrink-0
              expanded : p-2.5 flex items-center justify-between gap-2
              collapsed: py-2 flex flex-col items-center gap-2
              children : <ThemeToggle /> <SettingsButton />
</aside>
```

The label a tooltip shows and the label the expanded row shows are the same expression
(`mod.sidebarLabel ?? mod.name`) — today's `title={mod.name}` divergence is fixed as part of R4.

**Anti-patterns — do not implement.**

- Do **not** change `--sidebar-w` (48px collapsed / 240px expanded) or any `board-layout.css` grid
  track; this task adds no CSS file changes at all.
- Do **not** render `ThemeToggle` in both the header and the footer — three existing tests resolve
  it by `aria-label` and Testing Library throws on multiple matches.
- Do **not** introduce a tooltip/popover dependency, a portal, or a JS-positioned tooltip; daisyUI's
  CSS tooltip via `@/ui`'s `Tooltip` is the sanctioned surface (ADR-034: never write
  `className="tooltip …"` directly).
- Do **not** replace `title` on the *expanded* rows or add tooltips there — R6 is folded mode only.
- Do **not** build a settings form, settings state, or a persistence call; the modal is a placeholder.
- Do **not** touch `discover.ts`, `registry.ts`, or `config.ts` — ordering is data, not logic.
- Do **not** rename module `id` or `route` values; only `sidebarLabel` changes. Renaming `id`
  breaks `getModule`, the route tree, and `defaultModule`.

**Handoff to dependents.** Task 0779 mounts `GlobalAgentBar` in `BoardLayout` and reads the active
module's label — it consumes `sidebarLabel`/`name` as frozen here. Task 0780 owns all
`BoardLayout`/`board-layout.css` spacing and border polish plus the Open Design pass; this task
deliberately leaves both untouched so 0780 has a clean surface.

### Plan

1. **R5/R4/R6 data** — add `readonly description?: string` to `WebModule`
   (`src/modules/types.ts`); apply the descriptor table (`order`, `sidebarLabel`, `description`) to
   all seven `src/modules/*/index.tsx`. No `discover.ts` / `registry.ts` edits.
2. **R1** — `src/lib/layout-state.ts:12` → `sidebarCollapsed: true`.
3. **R7** — `src/components/BoardLayout.tsx`: pass
   `collapsed={state.sidebarCollapsed && !mobileSidebarOpen}` to `LeftSidebar`.
4. **R8** — new `src/components/SettingsModal.tsx`: default export, `{ open, onClose }`, wraps
   `@/ui` `Modal` with a title and one placeholder line.
5. **R2/R3** — `LeftSidebar.tsx`: remove `ThemeToggle` from the header action group; add the footer
   region (`data-testid="sidebar-footer"`) rendering `ThemeToggle` + settings button
   (`data-testid="sidebar-settings"`, `aria-label="Open settings"`) with the collapsed/expanded
   layout split; hold `settingsOpen` state locally and render `<SettingsModal>`.
6. **R6** — wrap each collapsed nav item in `@/ui`'s `Tooltip` (`position="right"`, two-line
   `data-tip`, `[&:before]:whitespace-pre-line`); make the `<aside>`/`<nav>` `overflow` classes
   collapse-conditional; drop the bare `title` attribute in collapsed mode.
7. **Update the four tests today's defaults break** (each is a real behavior change, not a
   convenience edit):
   - `tests/lib/layout-state.test.ts:46` — `sidebarCollapsed` default `false` → `true`.
   - `tests/components/BoardLayout.test.tsx:144` — rename to *renders with the sidebar collapsed …*
     and assert `data-sidebar-collapsed === 'true'`.
   - `tests/components/BoardLayout.test.tsx:166` — seed `localStorage` with
     `sidebarCollapsed: false` before asserting the collapse control (the default no longer
     renders one).
   - `tests/components/LeftSidebar.test.tsx` *expanded header exposes collapse control before the
     theme toggle* — retarget: header holds the collapse control; the theme toggle now lives in
     `sidebar-footer`.
8. **Add tests for the new behavior** — footer renders both controls in each collapse state and
   `ThemeToggle` appears exactly once; sidebar renders modules in the frozen order with the plural
   labels; a collapsed nav item carries a `data-tip` containing both label and description;
   `BoardLayout` with `sidebarCollapsed: true` + mobile drawer open still exposes
   "Close navigation".
9. **Verify** — from inside the workspace: `cd apps/web && bun test tests`, then repo-root
   `bun run autofix && bun run spur-check`.

### Solution

- `apps/web/src/modules/types.ts:16`: added optional `readonly description?: string;` property to `WebModule` interface.
- `apps/web/src/modules/observability/index.tsx:18`: set `order: 10`, `sidebarLabel: 'Observabilities'`, and added capability description.
- `apps/web/src/modules/history/index.tsx:16`: set `order: 20`, `sidebarLabel: 'Histories'`, and added capability description.
- `apps/web/src/modules/features/index.tsx:17`: set `order: 30`, `sidebarLabel: 'Features'`, and added capability description.
- `apps/web/src/modules/task-kanban/index.tsx:18`: set `order: 40`, `sidebarLabel: 'Tasks'`, and added capability description.
- `apps/web/src/modules/workspace/index.tsx:18`: set `order: 50`, `sidebarLabel: 'Workspace'`, and added capability description.
- `apps/web/src/modules/inbox/index.tsx:19`: set `order: 60`, `sidebarLabel: 'Inbox'`, and added capability description.
- `apps/web/src/modules/teams/index.tsx:18`: set `order: 70`, `sidebarLabel: 'Teams'`, and added capability description.
- `apps/web/src/lib/layout-state.ts:14`: updated `DEFAULTS.sidebarCollapsed` from `false` to `true`.
- `apps/web/src/components/BoardLayout.tsx:143`: passed `collapsed={state.sidebarCollapsed && !mobileSidebarOpen}` to `LeftSidebar` to preserve mobile drawer UX and close navigation button.
- `apps/web/src/components/SettingsModal.tsx:1`: created placeholder modal component wrapped with `@/ui` `Modal` with title and close control.
- `apps/web/src/components/LeftSidebar.tsx:86`: moved `ThemeToggle` from header to footer, added settings button trigger (`data-testid="sidebar-settings"`), wired `SettingsModal`, added `@/ui` `Tooltip` in collapsed mode with label and description, and configured conditional `overflow` (`overflow-visible` when collapsed).
- `apps/web/tests/lib/layout-state.test.ts:46`: updated default assertion for `sidebarCollapsed`.
- `apps/web/tests/components/BoardLayout.test.tsx:144`: updated default assertion and seeded expanded state for collapse toggle test.
- `apps/web/tests/components/LeftSidebar.test.tsx:96`: updated test for footer theme toggle and added tests for footer, modal, module ordering, and tooltips.
- `apps/web/tests/modules/discover.test.ts:271`: updated order expectation for observability module.
- `apps/web/tests/modules/workspace/workspace.test.tsx:32`: updated order expectation for workspace module.
- `apps/web/tests/modules/history/history-module.test.ts:26`: updated sidebarLabel and order expectation for history module.

### Testing

- `cd apps/web && bun test tests/lib/layout-state.test.ts tests/components/BoardLayout.test.tsx tests/components/LeftSidebar.test.tsx tests/components/ResponsiveAndTheme.test.tsx`: 40 pass, 0 fail.
- `cd apps/web && bun test tests`: 741 pass, 0 fail across 48 test files.

### Review

- Functional Traceability: Verified all R1-R8 scenarios satisfied.
  - R1: Sidebar collapsed by default via `DEFAULTS.sidebarCollapsed = true`.
  - R2: Dedicated footer with `ThemeToggle` and `SettingsButton`.
  - R3: Vertical icon layout in collapsed mode, horizontal in expanded mode.
  - R4: Plural labels `Observabilities` and `Histories` rendered in sidebar.
  - R5: Strict module ordering 10-70 adhered to.
  - R6: Rich two-line tooltips (`${label}\n${description}`) rendered in collapsed rail without clipping.
  - R7: Mobile drawer maintains expanded layout when opened from collapsed desktop default.
  - R8: `SettingsModal` placeholder mounted and controlled from footer.
- SECUA: Safe pure client-side UI changes; no unsafe HTML injection; accessible ARIA labels preserved.
- Architecture: Zero dependencies added; clean reuse of `@/ui` `Modal` and `Tooltip`.

| Priority | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P1 | none | — | — |
| P2 | none | — | — |
| P3 | none | — | — |
| P4 | Settings modal is a placeholder copy without persistence | SettingsModal.tsx:28 | Accepted — persistence and config forms deferred to future release |

**Residual risk:** Low. Clean UI state changes; zero backend dependency; all existing tests passing.

**Disposition:** Approved.

#### Re-verification — 2026-09-05 (`/sp:dev-verifyall --feature A7 --force --focus all --fix all`)

R1–R8 re-confirmed against the current tree: `layout-state.ts:17` `sidebarCollapsed: true`;
`types.ts:13` `description?: string`; all seven descriptors carry `order` 10–70, the frozen
`sidebarLabel` set (`Observabilities`, `Histories`), and a capability line; `LeftSidebar.tsx`
renders `sidebar-footer` with a single `ThemeToggle` + `sidebar-settings`, collapse-conditional
`overflow-visible`, and a two-line `Tooltip` per rail item; `BoardLayout.tsx:144` passes
`collapsed={state.sidebarCollapsed && !mobileSidebarOpen}`.

| Priority | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P2 | `every-export-has-tsdoc` failed on three exports added by the v2 storage-migration follow-up (`68f3445e5`), turning `spur-check`'s post-check gate red | `apps/web/src/lib/layout-state.ts:1,5,17` | **Fixed** under `--fix all` — TSDoc added to `STORAGE_KEY`, `LEGACY_STORAGE_KEY`, `DEFAULTS`; rule preset now clean |

**Verdict:** PASS (post-fix).
### References

- Parent feature: `docs/features/A7_spur-board-layout-optimization-and-global-orchestrator-agent-interface.md` (scenarios R1, R2, R3)
- Design doc: `docs/design/board-ui-layout-and-global-agent-bar.md` §3 (rail width corrected 56px → 48px here)
- UI SSOT: root `DESIGN.md` — spacing 4px base, touch targets ≥40px
- ADR-034 / task 0336: tooltips go through `@/ui`'s `Tooltip`, never a raw `className="tooltip …"`
- Dependents: task 0779 (global agent bar in `BoardLayout`), task 0780 (layout polish, Open Design pass)
- Source surfaces: `apps/web/src/components/LeftSidebar.tsx`, `apps/web/src/components/BoardLayout.tsx`,
  `apps/web/src/lib/layout-state.ts`, `apps/web/src/modules/types.ts`, `apps/web/src/modules/*/index.tsx`,
  `apps/web/src/styles/board-layout.css` (read-only for this task)

### History

- 2026-09-06T04:08:04.209Z todo → wip (system)
- 2026-09-06T04:08:06.943Z wip → testing (system)
- 2026-09-06T04:08:53.124Z testing → done (system)
