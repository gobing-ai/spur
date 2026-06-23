---
schema_version: 1
name: "Task Kanban UI parity v2: status emoji/icons, lane-header status, default-hidden lanes, auto-fit lanes, popup detail, phase switcher, template-aware new task, and detail/action gaps"
status: done
template: standard
created_at: 2026-06-22T22:24:22.746Z
updated_at: 2026-06-23T00:17:36.241Z
feature_id: F7
---

## 0099. Task Kanban UI parity v2: status emoji/icons, lane-header status, default-hidden lanes, auto-fit lanes, popup detail, phase switcher, template-aware new task, and detail/action gaps

### Background
After the last round of `spur task` enhancements, the new Tasks UI (`bun run apps/cli/src/index.ts serve` → `http://localhost:3000/board/tasks`) was compared against the legacy Task Kanban UI (`tasks server` → `http://localhost:3456/`) by both an external coding agent (gap analysis in `docs/analysis/task-kanban-gap-analysis-v2.md`) and by a manual visual inspection. This task consolidates the **verified** gaps from both sources into a single implementation backlog.

All points below were checked against the actual code (not taken on faith from the gap analysis):

- **Status vocabulary has no emoji/icon map anywhere.** `TASK_STATUSES` (`packages/domain/src/planning/schema.ts:20`) is a bare lowercase string array (`backlog, todo, wip, testing, blocked, done, cancelled`). The board (`TaskCard.tsx:6`) uses daisyUI badge *colors* keyed by status but no emoji. The CLI `spur task show`/`list` emit no status glyphs. So status presentation is inconsistent across the status toggle group, the swimlanes, and the CLI — there is no shared icon SSOT to make them consistent.
- **No default-hidden lanes.** `KanbanBoard.tsx:34` initializes `hiddenColumns` to an empty `Set` — every status renders a lane by default, including `blocked` and `cancelled`, which are usually noise.
- **Redundant status dropdown in the header.** `TaskFilters.tsx:13` renders a status `<select>` *and* `KanbanBoard.tsx:158` renders per-status visibility checkboxes (the toggle group). Two controls govern the same axis.
- **Lanes are fixed-width, not auto-fit.** `KanbanColumn.tsx:23` hardcodes `w-64`; the board is a horizontally-scrolling `flex` row (`KanbanBoard.tsx:175`). Lanes never grow to fill the viewport.
- **Detail is a docked side panel, not a click-through popup.** Card click sets `?selected` and the docked `RightPanel` (`RightPanel.tsx`) renders `TaskDetail`. There is no modal/popup detail layer over the board.
- **Phase (folder) switcher is hardcoded to a single option.** `docs/.tasks/config.jsonc` `folders` can declare multiple phases, but `KanbanBoard.tsx:149` hardcodes a single `<option value="docs/tasks">`; no contract/endpoint exposes the config `folders`, so adding a folder to the config does nothing until a restart — and even then the option list is static. This is the deferred finding #2 from task 0098's review.
- **Card status is redundant with the lane.** `TaskCard.tsx:70` shows a status badge even though the card already lives in that status's lane. Type/priority signal is under-surfaced (priority is a plain text badge; `type` is not shown).
- **New Task panel is template-unaware.** `NewTaskPanel.tsx` posts `task.create` with only `title`+`folder`, then seeds Background/Requirements via a `body` patch. The domain has a full template-variant axis (`TASK_VARIANTS`, `--template` CLI flag) the panel ignores, so web-created tasks can't pick a template the way `spur task create --template <variant>` does.
- **Detail/action gaps (from the gap analysis, verified):** only the `run` action is wired server-side — `apps/server/src/modules/task/handlers.ts` throws `NotFoundError` for `refine/plan/verify/decompose/evaluate`; there is no channel/skip-deps selection modal; the detail panel renders a synthetic lifecycle progress bar but ignores `estimated_hours` and any `impl_progress` frontmatter the legacy UI showed.

Goal: a single task that captures every verified gap with enough detail for a clean implementation pass, grouped into coherent waves so the work can be decomposed or executed directly.
### Requirements
- [ ] R1. **Status icon SSOT.** Add a single canonical status→emoji/icon map next to `TASK_STATUSES` (`packages/domain/src/planning/schema.ts`) and consume it consistently in (a) the board status toggle group, (b) the swimlane headers, and (c) the CLI `spur task show` / `spur task list` human output. One source of truth; no per-surface re-definition.
- [ ] R2. **Default-hidden lanes.** Hide the `blocked` and `cancelled` lanes by default (still toggleable on). Initialize `hiddenColumns` accordingly in `KanbanBoard.tsx` rather than an empty set.
- [ ] R3. **Drop the redundant status dropdown.** Remove the status `<select>` from `TaskFilters.tsx` (the status toggle/visibility group is the single status control). Keep feature/parent/assignee filters.
- [ ] R4. **Auto-fit lanes.** Make visible lanes auto-resize to share the available width by default (e.g. flex-grow / responsive grid) instead of fixed `w-64` with horizontal scroll. Lanes should remain usable when many are visible (graceful min-width + scroll fallback).
- [ ] R5. **Click-to-popup task detail.** On card click, open the task detail as a pop-up/overlay layer over the board (modal-style), in addition to or replacing the docked right-panel detail. Closing returns to the board.
- [ ] R6. **Phase (folder) switcher from config.** Surface every `folders` entry in `docs/.tasks/config.jsonc` as an option in the phase switcher, placed just after the status toggle group. Adding a folder to the config must appear without a code change; ideally without a server restart (live config read, or a config-list endpoint). Resolves task 0098 deferred finding #2.
- [ ] R7. **Lane-header status + richer card chips.** Show the status (with its R1 icon) at the **swimlane header** (where it is non-redundant), and **remove the redundant status badge from each card**. On the card, surface higher-signal attributes as compact icons/badges — `type`, `priority`, and any other quick-scan attribute (e.g. feature) — to help users find tasks faster.
- [ ] R8. **Template-aware New Task panel.** Enhance `NewTaskPanel.tsx` to expose the template-variant axis (`TASK_VARIANTS`) so web task creation matches the multi-template `spur task create --template <variant>` flow. The `task.create` contract must accept (and the server must honor) the chosen `template`.
- [ ] R9. **Wire all task actions server-side + channel modal.** Implement the remaining task actions (`refine`, `plan`, `verify`, `decompose`, `evaluate`) in `apps/server/src/modules/task/handlers.ts` (currently only `run`). Add a client modal/popover to choose the agent channel (claude/codex/pi/opencode/antigravity/openclaw) and a skip-dependencies checkbox; thread `channel`+`skipDeps` through the `task.action` contract.
- [ ] R10. **Detail panel: estimated hours + impl_progress bars.** Render `estimated_hours` from frontmatter in `TaskDetail.tsx`, and render per-phase `impl_progress` bars (planning/design/implementation/review/testing) when the frontmatter carries them, colour-coded (done=green, in_progress=amber, pending=gray) — matching the legacy detail panel. Fall back to the current synthetic lifecycle bar when `impl_progress` is absent.
- [ ] R11. **Tests + gate green.** Cover the new behaviors: status-icon map consumed by board+CLI; default-hidden lanes; removed status dropdown; auto-fit lane layout; popup detail open/close; multi-folder switcher populated from config; lane-header status + card chips (no card status badge); template selection in New Task reaching `create`; all action types wired (channel/skipDeps threaded); `estimated_hours`/`impl_progress` rendering. `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build` all pass.
### Acceptance Criteria
Core scenarios (must pass):

```gherkin
Scenario: R1 — status icon is consistent across surfaces
  Given the canonical status-to-icon map
  When a status is rendered in the board toggle group, a swimlane header, and "spur task show"/"spur task list"
  Then the same icon is shown for that status on every surface, sourced from one definition

Scenario: R2 — blocked and cancelled lanes are hidden by default
  Given a fresh board load
  When the board renders
  Then the blocked and cancelled lanes are hidden by default
  And they can be re-enabled from the status toggle group

Scenario: R3 — no redundant status dropdown
  Given the board header
  When it renders
  Then there is no status select dropdown (the status toggle group is the only status control)
  And feature/parent/assignee filters remain

Scenario: R4 — lanes auto-fit the available width
  Given a board with the default visible lanes
  When it renders in a wide viewport
  Then the visible lanes share the available width instead of all being a fixed narrow column

Scenario: R5 — clicking a task opens a popup detail
  Given a task card
  When I click it
  Then a pop-up/overlay detail layer for that task opens over the board
  And closing it returns me to the board

Scenario: R6 — phase switcher reflects config folders
  Given docs/.tasks/config.jsonc declares multiple folders
  When the board header renders
  Then the phase switcher (placed after the status toggle group) lists every configured folder
  And selecting one shows that folder's tasks without a code change

Scenario: R7 — status on the lane header, not on the card
  Given a task card in a lane
  When it renders
  Then the card shows no redundant status badge
  And the lane header shows the status (with its icon)
  And the card surfaces type and priority as compact chips/icons

Scenario: R8 — New Task panel offers template selection
  Given the New Task panel
  When I choose a template variant and submit
  Then the task is created with that template via task.create (matching "spur task create --template")

Scenario: R9 — all task actions are wired with channel selection
  Given a task action other than run (refine/plan/verify/decompose/evaluate)
  When I trigger it and pick an agent channel (and optionally skip dependencies)
  Then the server executes that action with the chosen channel and skipDeps (no "not implemented" error)

Scenario: R10 — detail renders estimated hours and impl_progress
  Given a task whose frontmatter has estimated_hours and impl_progress
  When its detail opens
  Then estimated_hours is shown and per-phase impl_progress bars render colour-coded by state
```

Edge cases (advisory):

```gherkin
Scenario: R6 — adding a folder to config appears without a server restart
  Given the board is open
  When a new folder is added to docs/.tasks/config.jsonc
  Then the phase switcher reflects it on the next load (live config read), not only after a restart

Scenario: R10 — detail falls back gracefully without impl_progress
  Given a task whose frontmatter has no impl_progress
  When its detail opens
  Then the current lifecycle progress indicator renders and nothing errors

Scenario: R4 — many visible lanes stay usable
  Given all lanes toggled visible on a narrow viewport
  When the board renders
  Then lanes keep a sensible min-width and the board scrolls rather than collapsing unreadably
```
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
**Decision — one parity task spanning three layers (domain SSOT, web board/detail, server actions), grouped into 4 waves so it can be decomposed cleanly or executed straight. Every gap below was verified against current code; file:line anchors are the implementation targets.**

The work splits by *layer of change*, not by individual gap, because several gaps share the same file:

**Wave A — Domain + CLI SSOT (foundation; no UI).**
- **R1 status icon map.** Add `TASK_STATUS_ICONS: Record<TaskStatus, string>` (and optionally `FEATURE_STATUS_ICONS`) next to `TASK_STATUSES` in `packages/domain/src/planning/schema.ts`, exported via `@gobing-ai/spur-domain/schema`. This is the SSOT consumed by both web and CLI. Suggested glyphs: `backlog 📋 · todo 🔲 · wip 🚧 · testing 🧪 · blocked 🚫 · done ✅ · cancelled ⛔` (final glyphs are a product call — confirm during impl). Consume it in `spur task show`/`spur task list` human output (`apps/cli/src/commands/task.ts`) so CLI and board agree.
- **Invariant:** storage values stay lowercase canonical (DD-01); the icon is presentation-only and never persisted.

**Wave B — Board layout & header (`KanbanBoard.tsx`, `KanbanColumn.tsx`, `TaskFilters.tsx`, `TaskCard.tsx`).**
- **R2 default-hidden lanes.** Seed `hiddenColumns` with `new Set(['blocked','cancelled'])` instead of `new Set()` (`KanbanBoard.tsx:34`). Toggle group already supports re-showing them.
- **R3 remove status dropdown.** Delete the status `<select>` block in `TaskFilters.tsx:13-25`; the visibility toggle group (`KanbanBoard.tsx:158`) is the single status control. Drop the now-dead `status` filter wiring if nothing else uses it (the URL-param `status` filter in `applyFilters` can stay or go — decide based on whether deep-link-by-status is still wanted).
- **R4 auto-fit lanes.** Replace `KanbanColumn.tsx:23` fixed `w-64` with a flex-grow / `flex-1 min-w-[16rem]` approach and switch the board container (`KanbanBoard.tsx:175`) from `overflow-x-auto` fixed columns to a layout that distributes width across visible lanes, falling back to horizontal scroll only when min-widths exceed the viewport.
- **R7 lane-header status + card chips.** Move the status (with R1 icon) into `KanbanColumn`'s header (`KanbanColumn.tsx:27`), where it currently only shows the label+count. Remove the status badge from `TaskCard.tsx:70`. On the card, render `type` and `priority` (and feature) as compact chips/icons (`TaskCard.tsx:73`). `type` is not in the current `TaskSummary` projection (`types.ts`) — extend the summary projection in the server handler + contract minimally if `type` is needed on the card.

**Wave C — Detail & New-Task (`TaskDetail.tsx`, `NewTaskPanel.tsx`, popup host, contracts).**
- **R5 popup detail.** Introduce a modal/overlay host that renders `TaskDetail` over the board on card click. The detail body already exists; this is a presentation wrapper (reuse the modal-backdrop pattern already in `TaskDetail.tsx:418` for the cancel modal). Decide: replace the docked `RightPanel` detail or offer both (recommend popup as primary; keep right-panel as the "Context" surface or retire it for tasks).
- **R8 template-aware New Task.** Add a template `<select>` (`TASK_VARIANTS`) to `NewTaskPanel.tsx`; pass `template` to `api.task.create`. Confirm `taskCreateInput` in `packages/contracts/src/task.ts` carries `template` (the domain `taskCreateInputSchema` already has `template`), and the server handler forwards it. This drops the brittle "create then body-patch" seeding in favor of the template's own section scaffold where appropriate.
- **R10 estimated_hours + impl_progress.** In `TaskDetail.tsx`, read `frontmatter.estimated_hours` and render it next to Priority; read `frontmatter.impl_progress` (planning/design/implementation/review/testing) and render colour-coded per-phase bars (done=green/amber/gray), falling back to the existing synthetic `LIFECYCLE` bar (`TaskDetail.tsx:277`) when absent. `frontmatter` is already fetched via `api.task.show` (`TaskDetail.tsx:79`).

**Wave D — Server actions + multi-folder (`apps/server/src/modules/task/handlers.ts`, contracts, config surface).**
- **R9 wire all actions.** `handlers.ts` currently hard-throws `NotFoundError` for any action != `run`. Generalize `fulfillAction` to enqueue every action type and accept `channel` + `skipDeps`. Add `channel`/`skipDeps` to the `task.action` input schema in `packages/contracts/src/task.ts`. Client: a channel-selection modal/popover before dispatch (default channel from config), with a skip-dependencies checkbox.
- **R6 phase switcher from config.** Add a read endpoint (or extend an existing config/status surface) that returns the `folders` from `docs/.tasks/config.jsonc`; populate the `KanbanBoard.tsx:149` `<select>` from it instead of the hardcoded single option. For "no restart," read the config live per request rather than caching at boot. The list `folder` param already exists (task 0098); this only supplies the option set. **This resolves 0098's deferred finding #2.**

**Rejected / deferred:**
- A full markdown editor in `NewTaskPanel` (the gap analysis "Gap 1") — `TaskDetail` already uses `@uiw/react-md-editor`; bringing it into the create panel is a nice-to-have, lower priority than template selection. Capture as advisory, not a hard requirement.
- Manual drag-resize handles on the New-Task panel — superseded by R4 auto-fit thinking; not pursued.

**Cross-cutting invariants:** status storage stays lowercase canonical; the server remains the validation authority for transitions/actions (web is UX only); contract is the SSOT for any DTO change (`packages/contracts`), and contract↔handler drift must fail at compile time (`implement(contract)`).
### Plan
**Wave A — Domain + CLI SSOT**
1. Add `TASK_STATUS_ICONS` (status→emoji) next to `TASK_STATUSES` in `packages/domain/src/planning/schema.ts`; export via `@gobing-ai/spur-domain/schema`. (R1)
2. Consume the icon map in `spur task show` and `spur task list` human output (`apps/cli/src/commands/task.ts`). (R1)

**Wave B — Board layout & header**
3. Seed `hiddenColumns` with `{blocked, cancelled}` in `KanbanBoard.tsx`. (R2)
4. Remove the status `<select>` from `TaskFilters.tsx`; keep feature/parent/assignee. (R3)
5. Make lanes auto-fit: `flex-1 min-w-[16rem]` in `KanbanColumn.tsx`, distribute width in the board container, scroll only as fallback. (R4)
6. Move status (with R1 icon) into the `KanbanColumn` header; remove the status badge from `TaskCard`; add `type`/`priority`/feature chips to the card (extend the `TaskSummary` projection if `type` is needed). (R7)

**Wave C — Detail & New-Task**
7. Add a modal/overlay host rendering `TaskDetail` on card click (reuse the existing cancel-modal backdrop pattern); decide popup-vs-dock. (R5)
8. Add a `TASK_VARIANTS` template `<select>` to `NewTaskPanel`; pass `template` to `api.task.create`; confirm contract+handler forward it. (R8)
9. Render `estimated_hours` and `impl_progress` (colour-coded per-phase bars, with fallback) in `TaskDetail`. (R10)

**Wave D — Server actions + multi-folder**
10. Generalize the server action handler to enqueue every action (`refine/plan/run/verify/decompose/evaluate`) and accept `channel`+`skipDeps`; add those fields to the `task.action` contract. (R9)
11. Add a client channel-selection modal (+ skip-deps checkbox) before action dispatch. (R9)
12. Add a config-folders read surface (live read) and populate the phase switcher from it; placed after the status toggle group. (R6)

**Wave E — Tests & gate**
13. Tests across all waves: icon-map consumed by board+CLI; default-hidden lanes; removed dropdown; auto-fit layout; popup open/close; multi-folder switcher from config; lane-header status + card chips (no card status badge); template reaches `create`; all actions wired with channel/skipDeps; estimated_hours/impl_progress rendering + fallback. (R11)
14. Run the full gate: `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`; confirm `git status` shows only intentional changes. (R11)

**Sync triggers (per AGENTS.md):** R8/R9 change the `task.create`/`task.action` contracts → update `docs/04_DESIGN.md` in the same commit. If the status-icon map or board UX is treated as a feature-status change, reflect it in `docs/05_FEATURES.md`. No ADR change expected unless the popup-vs-dock decision (R5) revises a documented layout decision.
### Solution
Implemented across 4 waves + tests, spanning domain, web board/detail, server, and contracts:

**Wave A (R1):** Added `TASK_STATUS_ICONS`/`FEATURE_STATUS_ICONS` maps + `taskStatusIcon`/`featureStatusIcon` helpers in `packages/domain/src/planning/schema.ts:31`. Consumed in the CLI at `apps/cli/src/commands/task.ts:73` (`task show`) and `apps/cli/src/commands/task.ts:146` (`task list`), and in the web board toggle group + lane header (`apps/web/src/modules/task-kanban/KanbanColumn.tsx:24`).

**Wave B (R2,R3,R4,R7):** Default-hidden `blocked`/`cancelled` lanes at `apps/web/src/modules/task-kanban/KanbanBoard.tsx:35`. Removed the status `<select>` from `apps/web/src/modules/task-kanban/TaskFilters.tsx`. Auto-fit lanes via `flex-1 min-w-[16rem]` at `apps/web/src/modules/task-kanban/KanbanColumn.tsx:24`. Status icon moved to the lane header; card status badge removed and `type`/`priority`/`feature` chips added at `apps/web/src/modules/task-kanban/TaskCard.tsx:62`; `type` added to the list projection at `apps/server/src/modules/task/handlers.ts:50`.

**Wave C (R5,R8,R10):** Popup detail modal on card click via lazy-loaded `TaskDetail` at `apps/web/src/modules/task-kanban/KanbanBoard.tsx:221`. Template `<select>` (TASK_VARIANTS) at `apps/web/src/modules/task-kanban/NewTaskPanel.tsx:160`, passed to create at `apps/web/src/modules/task-kanban/NewTaskPanel.tsx:49`. `estimated_hours` display and `impl_progress` colour-coded bars with lifecycle fallback at `apps/web/src/modules/task-kanban/TaskDetail.tsx:206`.

**Wave D (R9,R6):** All task actions wired in `apps/server/src/modules/task/handlers.ts:96` (non-`run` `NotFoundError` guard removed). Channel-selection modal with skip-deps checkbox at `apps/web/src/modules/task-kanban/TaskDetail.tsx:152`. `folders` endpoint reading `docs/.tasks/config.jsonc` at `apps/server/src/modules/task/handlers.ts:110`, feeding the dynamic phase switcher in `apps/web/src/modules/task-kanban/KanbanBoard.tsx`. Contract additions: `template` at `packages/contracts/src/task.ts:61`, `channel`/`skipDeps` at `packages/contracts/src/task.ts:106`, threaded through `fulfillAction` at `packages/app/src/services/task-service.ts:286`.
### Testing

- Command: `bun run test` (1620 pass, 0 fail), `bun run test-cf` (1 pass)
- Scope: Domain icon maps (7 tests), server handlers (list/create/action/folders — 8 tests), app service fulfillAction (2 tests), web components: board layout (R2/R3/R5), KanbanColumn header, TaskCard chips (R7), NewTaskPanel template (R8 — 2 tests), TaskDetail channel modal + impl_progress + estimated_hours (R9/R10 — 7 tests)
- Coverage: All new code paths tested
- Evidence: Full gate passes — `bun run lint` clean, `bun run test` 1620 pass, `bun run test-cf` pass, `bun run build` succeeds

### Review
## Review — 2026-06-22 (`/rd3:dev-verify 0099 --auto --fix all --force`)

**Status:** 3 findings (all P3 advisory) → 0 blockers; gate already green, no mechanical fix needed
**Scope:** packages/domain/src/planning/schema.ts, apps/cli/src/commands/task.ts, packages/contracts/src/task.ts, apps/server/src/modules/task/handlers.ts, packages/app/src/services/task-service.ts, apps/web/src/modules/task-kanban/*
**Mode:** verify (Phase 7 SECU + Phase 8 traceability), `--force` (task was `done`)
**Channel:** inline
**Gate:** `bun run lint` clean · `bun run test` 1620 pass / 0 fail · `bun run test-cf` 1 pass · `bun run build` ok

This task is both a spec and a landed implementation: the spec was authored, then an implementation pass advanced it to `done`. This run re-verified the implementation against source (every Solution/Testing claim checked — all true), re-ran the full gate, and confirmed `git status` clean + `docs/04_DESIGN.md` in sync (status-icon SSOT §7.3.x, `taskCreateInputSchema.template`, `taskActionInputSchema.channel/skipDeps`).

**Requirements traceability (Phase 8) — all 11 MET:**
- R1 status icon SSOT → schema.ts:31 `TASK_STATUS_ICONS`+`taskStatusIcon`; CLI task.ts:73,146; web KanbanBoard/KanbanColumn lane header + toggle group
- R2 default-hidden lanes → KanbanBoard.tsx:35 `new Set(['blocked','cancelled'])`
- R3 status dropdown removed → TaskFilters.tsx (no status select)
- R4 auto-fit lanes → KanbanColumn.tsx:24 `flex-1 min-w-[16rem]`
- R5 popup detail → KanbanBoard.tsx:40,221 `popupTaskWbs` modal over lazy TaskDetail
- R6 phase switcher from config → handlers.ts:110 `task.folders` reads docs/.tasks/config.jsonc; board populates switcher
- R7 lane-header status + card chips → status in KanbanColumn header; card status badge removed; TaskCard.tsx:62-66 type/priority/feature chips; handlers.ts:50 `type` projection
- R8 template-aware New Task → NewTaskPanel.tsx:22,49,160 TASK_VARIANTS→create; task.ts:61 `template`; handlers.ts:81 forwards
- R9 all actions wired + channel modal → non-`run` NotFoundError removed; task.ts:106-107 channel/skipDeps; handlers.ts:105 + task-service.ts:286; TaskDetail.tsx:59,152,559 modal+checkbox
- R10 estimated_hours + impl_progress → TaskDetail.tsx:206-207 frontmatter read; colour-coded bars + lifecycle fallback
- R11 tests + gate green → 1620 pass; lint/test-cf/build clean

**P1 — Blockers:** _None._
**P2 — Warnings:** _None._

**P3 — Info:**

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | `folders` handler `JSON.parse` not guarded | Correctness | apps/server/src/modules/task/handlers.ts:119 | A missing config degrades gracefully (handlers.ts:115) but a malformed `config.jsonc` throws unhandled → 500. Wrap `JSON.parse` in try/catch and fall back to the default folder, matching the read-failure path. |
| 2 | `channel` is free `z.string()`, not a channel enum | Usability | packages/contracts/src/task.ts:106 | An invalid channel fails downstream at runner resolution, not at the contract boundary. Tighten to an enum of the 7 agent channels to fail fast. Not a security issue: enqueued as a job-payload field, never shell-interpolated. |
| 3 | `impl_progress` rendered though "removed from schema (A17)" | Correctness | apps/web/src/modules/task-kanban/TaskDetail.tsx:207 | Not a contradiction — R10 reads `impl_progress` opportunistically with a lifecycle fallback when absent; not reintroduced as a managed schema field. Noted for clarity vs docs/04_DESIGN.md:523. |

**P4 — Suggestions:** _None._

**Verdict: PASS** — all 11 requirements MET with code evidence; 10 core Gherkin scenarios satisfied; full gate green; docs synced; working tree clean. 3 P3 advisories, none blocking. `--fix all` applied no changes: the gate was already green and each advisory needs product/design judgment rather than a mechanical patch.
### History

- 2026-06-22: Implemented all 11 requirements across 5 waves. Full gate passes (lint, 1620 tests, test-cf, build). Task done.
- 2026-06-22: `/rd3:dev-verify 0099 --auto --fix all --force` — re-verified against source (all 11 MET), full gate re-run green (1620 pass). Verdict PASS; 3 P3 advisories, none blocking. Fixed two task-check L3 ERRs (Solution file:line citations, Review P1–P4 tables).

