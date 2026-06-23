---
schema_version: 1
name: "Task Kanban UI parity v3: right-align status toggle group + right-docked resizable full-height detail panel (frontmatter skip, code-block styling)"
status: done
template: standard
created_at: 2026-06-23T00:39:51.949Z
updated_at: 2026-06-23T00:54:43.669Z
feature_id: F7
---

## 0100. Task Kanban UI parity v3: right-align status toggle group + right-docked resizable full-height detail panel (frontmatter skip, code-block styling)

### Background
Follow-up to 0099 (Task Kanban UI parity v2). After 0099 landed, a visual inspection against the legacy Task Kanban UI (screenshot `~/.gemini/antigravity-ide/brain/f56d596c-2872-4fb1-a35d-77ea92b494d4/legacy_detail_panel_1782163356028.png`; live legacy board served separately) surfaced two remaining gaps. Both were verified against the current code.

**Gap 1 — Status toggle group is left-positioned, separated from the New Task button.** In `apps/web/src/modules/task-kanban/KanbanBoard.tsx:155-198` the header renders left-to-right: `TaskFilters` → Live/Polling indicator → folder `<select>` → status toggle checkboxes → `<div className="flex-1" />` spacer → `+ New Task` button. The `flex-1` spacer at line 194 sits **between** the toggle group and the button, so the toggle group is pushed left and the button floats alone on the right. Desired: the toggle group should be **right-aligned and adjacent to the New Task button** (move the spacer before the toggle group so the group + button form one right-hand cluster).

**Gap 2 — Detail is a centered pop-up modal; it should be a right-docked, resizable, full-height top layer (legacy parity).** `KanbanBoard.tsx:221-292` renders the detail as a centered floating dialog: `fixed inset-0 flex items-center justify-center bg-black/40`, body `max-w-3xl max-h-[85vh] mx-4`. The legacy UI (screenshot) is a **right-docked, full-height overlay** floating above the board on the right (board keeps its width behind it), with a drag handle on its left edge to resize its width. Sub-gaps verified inside the detail:

- **Frontmatter leaks into the markdown preview (real bug).** `TaskService.show()` returns `content: raw` — the *entire file including the `--- ... ---` YAML frontmatter* (`packages/app/src/services/task-service.ts:236`). `TaskDetail` renders this via `MDEditor.Markdown source={serverBody}`, so the YAML block shows at the top of the preview. The frontmatter must be stripped before rendering/editing the body.
- **Code blocks use the default MDEditor theme.** No custom styling for fenced code blocks in the preview; the legacy panel has a distinct, readable code-block style.
- **Metadata-unfolded-by-default is ALREADY satisfied** — `TaskDetail.tsx:53` is `useState(true)`. No change needed; listed only to record that it was checked.

**Decisions (confirmed with Robin):** the docked panel **replaces the centered pop-up only** (the existing RightPanel "Context" surface is left untouched), and it is an **overlay** (floats above the board on the right; the board keeps its full width behind it) — matching the legacy screenshot. If a clean docked implementation already exists in the legacy codebase, copying it verbatim is acceptable; any deviation was to be discussed first (none needed beyond these two confirmed decisions).

Goal: close both gaps so the new Tasks UI reaches detail-panel + header parity with the legacy board.
### Requirements
- [ ] R1. **Right-align the status toggle group adjacent to New Task.** In `KanbanBoard.tsx` header, move the `flex-1` spacer to BEFORE the status toggle group so the folder select / Live indicator stay left, and the status toggle group + `+ New Task` button form one right-aligned cluster. The button sits immediately to the right of the toggle group.
- [ ] R2. **Convert the centered pop-up detail to a right-docked, full-height overlay.** Replace the centered modal in `KanbanBoard.tsx:221-292` with a panel anchored to the right edge (`fixed top-0 right-0 h-full`), full board height, floating above the board (board keeps its width behind it). Closing (✕ / Esc / backdrop click) dismisses it. Scope: replaces the pop-up only; the RightPanel "Context" surface is untouched.
- [ ] R3. **Make the docked panel width resizable.** Add a drag handle on the panel's left edge so the user can resize its width (with a sensible min/max). Persisting the width (e.g. localStorage) is optional/advisory, not required.
- [ ] R4. **Strip frontmatter from the body before rendering/editing.** The markdown preview AND the edit buffer must show only the body (everything after the `--- ... ---` YAML block), never the raw frontmatter. Fix at the source so the body content excludes frontmatter — either `TaskService.show()` returns frontmatter-stripped content (preferred — `task-service.ts:236` currently returns `content: raw`), or `TaskDetail` strips it on receipt. Frontmatter values still surface via the existing Metadata pane, not the raw YAML.
- [ ] R5. **Custom code-block styling in the preview.** Style fenced code blocks in the markdown preview (and editor preview) with a readable, theme-consistent treatment (background, padding, mono font, overflow scroll) closer to the legacy panel. Applies to the docked panel's rendered body.
- [ ] R6. **Preserve existing detail behavior.** All current `TaskDetail` features keep working inside the docked panel: status transitions, action buttons + channel/skip-deps modal, body edit/save (markdown), metadata pane (unfolded by default — already `useState(true)`), estimated_hours / impl_progress, cancel-confirm modal. No regressions.
- [ ] R7. **Tests + gate green.** Cover: header cluster right-alignment (toggle group + New Task grouped right of the spacer); docked panel renders right-anchored full-height and closes on ✕/Esc/backdrop; resize handle adjusts width; body preview/edit excludes frontmatter (assert no `---`/YAML keys render); code-block styling applied. `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build` all pass.
### Acceptance Criteria
Core scenarios (must pass):

```gherkin
Scenario: R1 — status toggle group is right-aligned next to New Task
  Given the board header
  When it renders
  Then the folder select and Live indicator stay on the left
  And the status toggle group is right-aligned, immediately left of the New Task button

Scenario: R2 — detail opens as a right-docked full-height overlay
  Given a task card
  When I click it
  Then a panel docks to the right edge at full board height, floating above the board
  And the board keeps its width behind the panel
  And clicking the close button, pressing Escape, or clicking the backdrop dismisses it

Scenario: R3 — the docked panel is width-resizable
  Given the docked detail panel is open
  When I drag its left-edge handle
  Then the panel width changes within sensible min/max bounds

Scenario: R4 — frontmatter is not shown in the body preview or editor
  Given a task whose file starts with a YAML frontmatter block
  When the detail body renders in preview mode
  Then no raw frontmatter (the --- delimiters or YAML keys) appears in the rendered markdown
  And entering edit mode shows the body without the frontmatter block

Scenario: R5 — fenced code blocks are styled
  Given a task body containing a fenced code block
  When the detail preview renders
  Then the code block has a distinct, readable, theme-consistent style (background, mono font, scroll on overflow)

Scenario: R6 — existing detail behavior is preserved in the docked panel
  Given the docked detail panel is open
  When I use status transitions, action buttons (with the channel/skip-deps modal), body edit/save, and the metadata pane
  Then all behave as before, with the metadata pane unfolded by default
```

Edge cases (advisory):

```gherkin
Scenario: R4 — a body with a fenced YAML example is not mistaken for frontmatter
  Given a task body containing a ```yaml code fence (not the file's frontmatter)
  When the body renders
  Then only the leading file frontmatter is stripped; the in-body YAML fence renders normally

Scenario: R2 — opening a second task replaces the panel content without stacking
  Given the docked panel is open for one task
  When I click a different card
  Then the same docked panel updates to the new task (no second panel, no stale content)

Scenario: R3 — resize respects min width so the panel stays usable
  Given the docked panel
  When I drag the handle to the extreme
  Then the panel clamps to a minimum readable width rather than collapsing
```
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
**Decision — two focused web-tier changes (header re-order + docked detail panel) plus one small server/domain fix (frontmatter-stripped body). Confirmed: replace the pop-up only; overlay (board keeps width). Reuse the existing `ResizeHandle` and `MarkdownDocument` parsing rather than inventing new mechanisms.**

**R1 — header cluster (KanbanBoard.tsx).** The only change is moving `<div className="flex-1" />` (currently line 194) to sit *before* the status toggle group block (currently lines 180-192). Result: `TaskFilters`, Live/Polling indicator, folder select stay left; the spacer pushes the toggle group + `+ New Task` button to the right as one cluster. Pure JSX re-order; no state/logic change.

**R2/R3 — right-docked resizable overlay (KanbanBoard.tsx + reuse ResizeHandle).** Replace the centered-modal markup (lines 221-292) with a right-anchored overlay:
- Backdrop: keep a `fixed inset-0 bg-black/40` click-to-close + `Esc` handler (overlay style — board stays full width behind it; backdrop is optional but matches the current dismiss UX).
- Panel: `fixed top-0 right-0 h-full` with a width driven by a CSS var / state (e.g. `w-[var(--detail-w)]`, default ~`36rem`, `min` ~`28rem`, `max` ~`80vw`), `flex flex-col`, `border-l`, `shadow-2xl`, `overflow-hidden`.
- Resize: reuse `apps/web/src/components/ResizeHandle.tsx` (`targetVar`/`onResizeEnd(px)` API) on the panel's LEFT edge. It already implements pointer-drag → px; wire `onResizeEnd` to persist width to state (optionally `localStorage`, advisory). Direction `horizontal`.
- Header + body: keep the existing `✕`/title header and the `<TaskDetail .../>` body (lazy-loaded, Suspense) exactly as today — only the OUTER container shape changes from centered to docked.
- "Open second task replaces content, no stacking": already holds — a single `popupTaskWbs` state drives one panel; clicking another card just updates it.

**R4 — strip frontmatter from the body (server/domain, the root fix).** `TaskService.show()` returns `content: raw` (`task-service.ts:236`) — the whole file. `MarkdownDocument.parse` already separates `_frontmatterBlock` from `_preamble` + sections (markdown-document.ts:175,182). Preferred fix: add a `bodyWithoutFrontmatter` accessor to `MarkdownDocument` (`serialize()` result minus the leading `_frontmatterBlock`, i.e. `_preamble + sections`), and have `show()` return that as `content`. This is the SSOT fix — every consumer (web preview AND editor draft) gets body-only, and the in-body ```yaml fences are untouched (only the leading file frontmatter is removed). Rejected: client-side regex strip in `TaskDetail` — brittle (would also strip a body that legitimately starts with `---`), and duplicates parsing the domain already does. Edit/save path stays correct because `updateBody` already targets "everything between frontmatter and the first `###`" (task-service.ts:251) — body-only in means body-only out.

**R5 — code-block styling (TaskDetail / web CSS).** `MDEditor.Markdown` renders fenced code via its default theme. Add a scoped style (Tailwind classes on a wrapper, or a small CSS rule targeting the markdown container's `pre`/`code`) for background, padding, mono font, and `overflow-x-auto`, theme-consistent with `spur-surface`/`spur-border`. Keep it scoped to the detail body so it doesn't leak into other markdown surfaces.

**R6 — preserve behavior.** No `TaskDetail` internal logic changes — it already does transitions, action+channel modal, body edit/save, metadata (unfolded by default, `TaskDetail.tsx:53` `useState(true)`), estimated_hours/impl_progress, cancel modal. The docked container wraps the same component, so these ride along. Verify nothing depends on the old centered-modal dimensions.

**Cross-cutting:** server remains validation authority; `show()` content-shape change is internal (contract `content: string` unchanged — still a string, just frontmatter-free), so no contract/DTO break. If any test asserted `show().content` includes frontmatter, update it to the body-only expectation (R8-style: tests encode intent — the intent is "body for the editor," not "raw file").

**Rejected/deferred:** persisting panel width across sessions (localStorage) — advisory, not required (R3). Inline-split layout — explicitly not chosen (overlay confirmed). Retiring the RightPanel Context surface — explicitly out of scope (replace pop-up only).
### Plan
1. R1: move the `flex-1` spacer in `KanbanBoard.tsx` to before the status toggle group so folder/Live stay left and the toggle group + New Task button form a right-aligned cluster. (R1)
2. R4: add a `bodyWithoutFrontmatter` accessor to `MarkdownDocument` (`_preamble` + sections, no `_frontmatterBlock`); change `TaskService.show()` to return it as `content`. Update any test asserting `content` includes frontmatter. (R4)
3. R2: replace the centered-modal markup in `KanbanBoard.tsx` with a right-anchored overlay panel (`fixed top-0 right-0 h-full`, width via state/CSS var, `border-l`, `shadow-2xl`); keep backdrop click + Esc to close; keep the existing header + lazy `TaskDetail` body. (R2)
4. R3: mount `ResizeHandle` on the panel's left edge; wire `onResizeEnd(px)` to the panel-width state with min/max clamp (optional localStorage persist). (R3)
5. R5: add scoped code-block styling for the detail body's markdown (`pre`/`code`: background, padding, mono, `overflow-x-auto`), theme-consistent and scoped to the detail panel. (R5)
6. R6: confirm all existing `TaskDetail` behavior works inside the docked panel — transitions, action+channel/skip-deps modal, body edit/save, metadata pane (unfolded default), estimated_hours/impl_progress, cancel modal. No regressions. (R6)
7. R7: tests — header right-cluster ordering; docked panel right-anchored + full-height + closes on ✕/Esc/backdrop; resize handle changes width (clamped); body preview/edit excludes frontmatter (no `---`/YAML keys; in-body ```yaml fence preserved); code-block styling present; second-card-click updates same panel. (R7)
8. Run the full gate: `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`; confirm `git status` shows only intentional changes. (R7)

**Sync triggers (per AGENTS.md):** R4 changes `TaskService.show()` content semantics (frontmatter-free body) but not the contract DTO (`content: string` unchanged) — note it in `docs/04_DESIGN.md` if the show-content shape is documented there. No ADR change (UI refinement within the existing board design; the docked-vs-popup choice does not revise a binding decision). Reflect board-detail status in `docs/05_FEATURES.md` if tracked there.
### Solution

## Solution

R1 header spacer: `apps/web/src/modules/task-kanban/KanbanBoard.tsx:180` — moved `flex-1` before toggle group.
R2 docked panel: `apps/web/src/modules/task-kanban/KanbanBoard.tsx:244` — right-anchored overlay with backdrop.
R3 resize: `apps/web/src/modules/task-kanban/KanbanBoard.tsx:247` — ResizeHandle with invert; `apps/web/src/components/ResizeHandle.tsx:29` — invert support.
R4 frontmatter: `packages/domain/src/planning/markdown-document.ts:225` — bodyWithoutFrontmatter; `packages/app/src/services/task-service.ts:236` — show() uses it.
R5 code styling: `apps/web/src/styles/global.css:38` — scoped pre/code rules.

All changes are minimal, surgical edits. No new files, no new abstractions.

### Testing

## Testing

- Command: `bun run lint && bun run test && bun run test-cf && bun run build`
- Scope: domain MarkdownDocument tests (5 new: bodyWithoutFrontmatter), task-service show test (updated), board tests (7 new: header cluster, docked panel, resize handle, close behavior), task-detail tests (33 existing — no regressions)
- Result: pass — 1632 tests, 0 failures. Coverage: 99.68% funcs, 99.13% lines (above 90% threshold)
- Evidence:
  - `packages/domain/tests/planning/markdown-document.test.ts` — 44 pass (incl. 5 new bodyWithoutFrontmatter tests)
  - `packages/app/tests/services/task-service.test.ts` — 35 pass (show test updated for stripped frontmatter)
  - `apps/web/tests/modules/task-kanban/board.test.tsx` — 15 pass (incl. 7 new docked-panel/header tests)
  - `apps/web/tests/modules/task-kanban/task-detail.test.tsx` — 33 pass (no regressions)
  - `apps/server` Vitest CF — 1 pass
  - Build (cli, server, web) — all pass
- Next action: none (gate green)

### Review
## Review — 2026-06-23

**Status:** 0 findings | **Verdict:** PASS
**Scope:** `apps/web/` + `packages/domain/` + `packages/app/`
**Mode:** verify | **Channel:** inline
**Gate:** all gates pass

#### P1 — Blockers
None.

#### P2 — Warnings
None.

#### P3 — Info
None.

#### P4 — Suggestions
None.

#### Requirements Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `KanbanBoard.tsx:180` flex-1 before toggle group |
| R2 | MET | `KanbanBoard.tsx:244` right-docked + backdrop/Esc/close |
| R3 | MET | `KanbanBoard.tsx:247` ResizeHandle invert |
| R4 | MET | `markdown-document.ts:225` bodyWithoutFrontmatter; `task-service.ts:236` |
| R5 | MET | `global.css:38` scoped code-block rules |
| R6 | MET | TaskDetail unchanged; 33 existing tests pass |
| R7 | MET | Lint ✓, 1632 tests, test-cf ✓, build ✓ |
### P1 — Blockers
None.

### P2 — Warnings
None.

### P3 — Info
None.

### P4 — Suggestions
None.

### Requirements Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `KanbanBoard.tsx:180` flex-1 moved before toggle group |
| R2 | MET | `KanbanBoard.tsx:244` right-docked panel + backdrop close |
| R3 | MET | `KanbanBoard.tsx:247` ResizeHandle with invert |
| R4 | MET | `markdown-document.ts:225` bodyWithoutFrontmatter; `task-service.ts:236` |
| R5 | MET | `global.css:38` scoped code-block styling |
| R6 | MET | TaskDetail unchanged; 33 existing tests pass |
| R7 | MET | Lint ✓, 1632 tests, test-cf ✓, build ✓ |
### Findings

No findings — SECU scan clean:
- **Security:** No hardcoded secrets, no injection vectors, no auth/authz changes
- **Efficiency:** No N+1 queries, no unbounded growth, no blocking I/O introduced
- **Correctness:** No empty catch blocks, no `any` usage, no missing null checks. The `bodyWithoutFrontmatter` getter is pure computation (no side effects). The `invert` prop in ResizeHandle is a simple sign flip.
- **Usability:** Code follows existing conventions. Imports ordered by Biome. CSS scoped to `[data-testid="detail-body"]` to avoid leaking.

### Requirements Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — Right-align toggle group | MET | `KanbanBoard.tsx:180` flex-1 spacer before toggle group. Test: `board.test.tsx` |
| R2 — Right-docked overlay panel | MET | `KanbanBoard.tsx:244` `fixed top-0 right-0 h-full`. Backdrop + Esc/✕ close. Tests: 4 board tests |
| R3 — Resizable width | MET | `KanbanBoard.tsx:247-254` ResizeHandle with invert. `ResizeHandle.tsx:29` invert support. Test: board test |
| R4 — Strip frontmatter | MET | `markdown-document.ts:225-239` bodyWithoutFrontmatter. `task-service.ts:236` uses it. Tests: 5 domain + 1 app |
| R5 — Code-block styling | MET | `global.css:38-55` scoped pre/code rules for detail body |
| R6 — Preserve behavior | MET | TaskDetail unchanged; 33 existing tests pass |
| R7 — Gate green | MET | Lint ✓ | 1632 tests pass | test-cf ✓ | Build ✓ |

### History
- 2026-06-23T00:45:49.045Z todo → wip (system)
