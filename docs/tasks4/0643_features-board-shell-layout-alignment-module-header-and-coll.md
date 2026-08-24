---
schema_version: 1
name: "Features board shell layout alignment, module header, and collapsible left Feature Tree dock"
status: todo
template: feature-impl
created_at: 2026-08-23T23:16:46.702Z
updated_at: "2026-08-24T00:12:25.143Z"
feature_id: F84
priority: P2
tags: ["web", "features", "layout"]
---

## 0643. Features board shell layout alignment, module header, and collapsible left Feature Tree dock

### Background
Align the Features board shell (`apps/web/src/modules/features/FeaturesShell.tsx`) with the
History module's visual shell — a centred `max-w-[1600px]` container and a module header carrying
icon, title, description, and a right-aligned action container — and convert the fixed `w-72`
left tree column into a collapsible dock. Covers feature F84 scenarios R1, R2.

#### Verified premises (checked against the tree at 2026-08-23)

- **Host container.** `MainWorkspace` (`apps/web/src/components/MainWorkspace.tsx:9-14`) renders
  `<main className="flex flex-col overflow-hidden">` with the module inside
  `<div className="flex-1 overflow-auto">`. The parent therefore has a determinate height, so the
  shell's current `h-full` resolves.
- **History is NOT a drop-in template.** `HistoryShell.tsx:361` is
  `flex flex-col gap-4 p-4 max-w-[1600px] mx-auto w-full` — auto-height, page-scroll. The Features
  board depends on *inner* scroll: the tree pane scrolls independently (`overflow-y-auto`), the
  detail pane scrolls independently, and `FeatureDetail` passes `height="100%"` to `MDEditor`
  (`FeatureDetail.tsx:712-716`). Copying History's auto-height model would collapse the editor and
  make the whole board page-scroll. Only History's **header + width constraint** are adopted; the
  `h-full` + `min-h-0` inner-scroll model stays. This is the single most important constraint in
  this task.
- **Current shell root** is `<div className="flex h-full overflow-hidden" data-features-shell>`
  (`FeaturesShell.tsx:158`). `data-features-shell` is an existing hook and must survive.
- **Filter menu + add-root button** currently live in the tree pane's own header row
  (`FeaturesShell.tsx:160-249`). `apps/web/tests/modules/features/components.test.tsx:797-800`
  reaches the filter via `getByLabelText('Filter features by status')` and
  `[data-filter-menu] button`; both survive a move as long as the labels and `data-filter-menu`
  are preserved.
- **Module registry icon** is `🏷️` (`apps/web/src/modules/features/index.tsx:17`), while F84 R2 and
  `docs/design/features-board-layout-refactor.md` §3.1 specify `🎯` for the in-module header. See
  Q&A — the header uses `🎯`; the registry entry is not touched.
- **daisyUI class-leak gate.** `.spur/rules/ui/ui-import-boundary.yaml` rule `no-daisyui-class-leak`
  is `severity: error` and forbids the word-bounded tokens
  `btn|card|badge|modal|menu|navbar|drawer|tabs|alert|dropdown|collapse|join|tooltip|loading|checkbox|toggle`
  (plus standalone `select`) inside any `className` string under `apps/web/src/**/*.tsx` outside
  `components/ui/`. Tailwind's own `collapse` utility is therefore unusable here.
### Requirements
- [ ] R1. Centre the Features board workspace in a `max-w-[1600px] mx-auto w-full` container while preserving the existing inner-scroll model (`h-full` shell, `min-h-0` work area, independently scrolling tree and detail panes).

- [ ] R2. Add a unified module header row — module icon `🎯`, `Features` title, one-line subtitle, and a right-aligned action container hosting the tree-dock toggle, the status-filter menu, and the add-root-feature button (both moved out of the tree pane's own header row).

- [ ] R3. Make the left Feature Tree a collapsible dock: expanded `w-72`, collapsed to zero width with an animated width transition, driven by a header toggle that stays reachable in both states and carries `aria-expanded` / `aria-controls`.

#### Out of scope
| Not in this task | Owner / reason |
| --- | --- |
| `FeatureDetail.tsx` internals and the markdown canvas width | 0644 — this task only supplies the hosting pane |
| The floating agent bar | 0645 — this task only leaves the mount seam described in Design |
| A refresh / sync button in the module header | `docs/design/features-board-layout-refactor.md` §3.1 lists one; F84 R1/R2 do not — do not add it |
| Module registry icon, name, or route (`modules/features/index.tsx`) | Separate sidebar surface, outside F84 |
| `FeatureTree.tsx` rendering, `groupFeaturesByParent`, SSE handling, filter semantics, `getFilteredFeatures` | Behaviour is unchanged; this is a layout task |
### Acceptance Criteria
```gherkin
Feature: Features board shell layout and collapsible tree dock

  Scenario: R1 — Aligned shell layout with width constraint and module header
    Given a user navigates to the Features board module
    When the page renders
    Then the main view is centered within a max-w-[1600px] width-constrained container
    And the header displays the module icon, "Features" title, description, and top-right action button container

  Scenario: R2 — Floating and collapsible left Feature Tree panel
    Given the Features board shell is loaded
    When the user toggles the tree dock button
    Then the left Feature Tree panel collapses or expands smoothly
    And the main detail view dynamically occupies the available canvas width
```
### Q&A
- **Keep inner scroll; do not port History's page-scroll shell.** History's shell is auto-height
  because its tabs are documents. The Features board has two independently scrolling panes and an
  `MDEditor` sized at `height="100%"`. Decision: adopt History's header + `max-w-[1600px]` only;
  keep `h-full` + `min-h-0`. Rejected: literal reuse of `HistoryShell.tsx:361`'s class string.
- **Header icon `🎯` vs registry icon `🏷️`.** F84 R2 names `🎯`. Decision: the in-module header
  renders the literal `🎯`; `modules/features/index.tsx` keeps `🏷️` for the sidebar. The sidebar
  registry is a separate surface and changing it is not in F84's scope. Also rejected: importing
  `module.icon` from `./index` — that is a circular import (`index.tsx` imports `FeaturesShell`).
- **Tree dock default is expanded.** Collapsed-by-default would hide the primary navigation on
  first paint and would break existing shell tests that click a tree row immediately. Decision:
  `useState(true)`.
- **Toggle lives in the module header, not on a floating rail.** It must stay clickable when the
  panel has zero width; the header action container already exists for R2, so no separate docked
  rail is built. Rejected: a floating vertical tab (extra markup, same outcome).
- **Collapse hides content by unmounting, not by `aria-hidden`.** A zero-width panel whose buttons
  stay in the tab order is an accessibility defect, and `aria-hidden` over focusable children is
  the same defect with a worse name. Decision: animate the wrapper's width and conditionally render
  the inner panel (see Design).
- **`collapse` is an unusable class token here.** The `no-daisyui-class-leak` rule matches the bare
  word `collapse` inside any `className` outside `components/ui/`, so Tailwind's `collapse`
  visibility utility cannot be used. Width transition + conditional render instead.
### Design
**WHAT.** Restructure `FeaturesShell.tsx`'s returned tree into three nested regions — width-limited
root, module header, inner-scroll work area — and put the tree pane behind a width-animated dock.

**WHY.** F84 R1/R2 want the board to read like the History module (centred canvas, one module
header, one action container); R3 wants the detail canvas to reclaim the full width on demand.

**WHERE.** `apps/web/src/modules/features/FeaturesShell.tsx` — **this file only**. `FeatureTree.tsx`
needs no change; do not touch it.

#### Frozen structure

```tsx
<>
  <div className="flex flex-col h-full max-w-[1600px] mx-auto w-full p-4 gap-3" data-features-shell>

    {/* Module header — R1/R2 */}
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-spur-border pb-3 shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-2xl" aria-hidden="true">🎯</span>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-spur-text">Features</h1>
          <p className="text-xs text-spur-text-muted">
            Hierarchical feature roadmap, acceptance criteria, and lifecycle progression
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1" data-features-actions>
        {/* 1. tree-dock toggle  2. status filter menu (moved)  3. add-root button (moved) */}
      </div>
    </header>

    {/* Work area — inner scroll, R3 */}
    <div className="relative flex-1 min-h-0 flex gap-3 overflow-hidden">
      <div
        id="feature-tree-dock"
        className={`shrink-0 overflow-hidden transition-[width] duration-200 ${isTreeOpen ? 'w-72' : 'w-0'}`}
      >
        {isTreeOpen && (
          <div className="w-72 h-full overflow-y-auto rounded-lg border border-spur-border bg-base-200 shadow-lg">
            {/* empty / filtered-empty message, or <FeatureTree …/> — bodies unchanged */}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto rounded-lg border border-spur-border bg-base-100">
        {/* <FeatureDetail …/> or the "Select a feature to view details" placeholder — props unchanged */}
      </div>
    </div>
  </div>

  <NewFeaturePanel … />
</>
```

#### Frozen names

| Name | Kind | Value / signature |
| --- | --- | --- |
| `isTreeOpen` / `setIsTreeOpen` | React state | `useState(true)` — expanded default |
| `feature-tree-dock` | DOM id | on the animating wrapper; target of `aria-controls` |
| `data-features-shell` | attribute | **preserved** on the root div (existing hook) |
| `data-features-actions` | attribute | new, on the header action container (test hook) |
| `data-filter-menu` | attribute | **preserved** verbatim on the filter dropdown |
| `"Filter features by status"` | `aria-label` | **preserved** verbatim (existing test selector) |
| `"Add root feature"` | `aria-label` | **preserved** verbatim |
| `"Collapse feature tree"` / `"Expand feature tree"` | `aria-label` | new toggle, by state |

Toggle button: `<Button variant="ghost" size="xs" …>` from `@/ui`, with
`aria-expanded={isTreeOpen}` and `aria-controls="feature-tree-dock"`; glyph `◧` when open, `▶` when
closed (plain text, no new icon component).

#### Moves, not rewrites

- Lift the filter `<div className="relative" ref={filterMenuRef}>…</div>` block and the add-root
  `<Button>` out of the tree pane header (`FeaturesShell.tsx:160-249`) into the header action
  container **verbatim** — same markup, same handlers, same `data-filter-menu`, same labels, same
  outside-click/Escape effect. Only their mount point changes.
- Delete the now-redundant tree-pane header row (the uppercase `Features` label duplicates the
  module header title).
- `getFilteredFeatures`, `childrenByParent`, `load`, the SSE effect, the error and loading early
  returns, and every prop passed to `FeatureTree` / `FeatureDetail` / `NewFeaturePanel` are
  untouched.

#### Anti-patterns (do not implement)

- Do **not** drop `h-full` / `min-h-0` in favour of History's auto-height shell — it breaks the
  `MDEditor height="100%"` pane and turns the board into one long page scroll.
- Do **not** put `max-w-[1600px]` anywhere except the shell root; `FeatureDetail` must not gain a
  competing page-level width cap (0644 applies `max-w-4xl` to the markdown canvas only).
- Do **not** keep the collapsed panel mounted with `w-0` alone, and do **not** paper over it with
  `aria-hidden` — focusable children in a zero-width box are a keyboard trap.
- Do **not** use the `collapse` class token (blocked by `no-daisyui-class-leak`), and do not write
  any `btn*`/`card`/`badge`/`menu`/`dropdown`/`tooltip` token in a `className` — use the `@/ui`
  wrappers.
- Do **not** add a refresh/sync button, rename the module, or edit `modules/features/index.tsx`.
- Do **not** persist `isTreeOpen` to `localStorage` — not requested, and the board has no existing
  UI-state persistence convention.

#### Handoff to dependents

- **0644 (`FeatureDetail`)** receives a pane that is `flex-1 min-w-0 overflow-y-auto` and already
  width-limited by the shell. Its own root stays `flex flex-col h-full`; 0644 adds `relative` to it
  for the metadata drawer. The detail pane is the drawer's positioning context — the shell does not
  provide one for it.
- **0645 (`FloatingAgentBar`)** mounts as a sibling of the shell root inside the returned fragment
  (next to `<NewFeaturePanel>`), so it is viewport-`fixed` and independent of this layout. Z-index
  budget already in use in this module: `FloatingActionProgress` and `NewFeaturePanel` are `z-40`,
  the `FeatureDetail` confirmation modals are `z-50`; the agent bar must therefore sit at `z-30`.

#### Verification intent

Component tests in `apps/web/tests/modules/features/components.test.tsx` (`FeaturesShell` describe
block). The two existing shell tests must keep passing **unmodified** — that is the regression
signal that the filter/add-root move preserved their selectors.
### Plan
- [ ] Wrap the shell in the frozen root container and add the module header row with icon, title,
      subtitle, and the `data-features-actions` container (R1, R2)
- [ ] Move the status-filter dropdown and the add-root button verbatim into the header action
      container and delete the redundant tree-pane header row (R2)
- [ ] Add `isTreeOpen` state, the header toggle button with `aria-expanded`/`aria-controls`, and the
      width-animated `#feature-tree-dock` wrapper with conditionally rendered inner panel (R3)
- [ ] Restyle the tree pane and detail pane as bordered/rounded floating panels inside the
      `flex-1 min-h-0` work area, keeping both independently scrollable (R1, R3)
- [ ] Extend the `FeaturesShell` describe block: header renders icon/title/subtitle and the action
      container; toggle collapses and re-expands the dock and flips `aria-expanded`; tree buttons
      are absent from the DOM while collapsed (R1–R3)
- [ ] Confirm the two pre-existing `FeaturesShell` tests still pass **without edits**, then run
      `bun run lint`, `bun test apps/web/tests/modules/features/components.test.tsx`, and
      `spur rule run` for the `no-daisyui-class-leak` gate
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
