---
title: Tasks module frontend enhancement brainstorm
date: 2026-08-24
run_id: 9a6f0c49-ac5e-433c-b5cd-5bac44f6afbc
needs_design: true
---

# Brainstorm — Tasks Module Frontend Enhancement (via open-design)

## Overview

The History module refactor (task 0626) established a module-shell convention: icon + module
name + live chip on the left, append-only tab strip on the right (`HistoryShell.tsx` +
`tabs.ts`). The Tasks module (`apps/web/src/modules/task-kanban/`) never got that treatment —
it renders `KanbanBoard` directly with no module header; filters live in a separate
`TaskFilters` bar (feature / parent-WBS / assignee text inputs) plus a toolbar row inside
`KanbanBoard` (live indicator, folder select, column-visibility checkboxes). The idea: give
Tasks the History-parity header with filters inlined (phase dropdown, status checkboxes, one
combined WBS/feature input — no separate filter section), a full-bleed main body maximizing
lane/card space, richer task cards, and the existing floating/right-dock detail panel kept
as-is. Open Design (MCP live, 8 agent CLIs available) generates the visual design before
implementation. Root `DESIGN.md` is the UI SSOT; the module already resolves its surface
ladder via the `.task-kanban` token scope (task 0420).

## Approaches

### Approach 1: History-parity shell, open-design-prototyped ⭐ Recommended

**Description:** Introduce `TasksShell.tsx` mirroring `HistoryShell.tsx` structure, plus an
append-only `tabs.ts` contract (one tab: `kanban`). One header row carries, left-to-right:
icon + name + live chip → filters (phase `Select`, status checkboxes, combined WBS/feature
input) → tab strip. Header and body are both full-width (no `max-w-[1600px]` wrapper), sharing
one horizontal padding so lanes align under the header. `KanbanBoard`'s internal toolbar is
absorbed into the header; the board becomes pure lanes. Use Open Design
(`create_project` → `start_run` → iterate on the artifact) to prototype the header + card
layout against `DESIGN.md` tokens before writing the React.

**Trade-offs:**
- **Pros:**
  - Follows the established shell convention (`tabs.ts` append-only contract) — future tabs
    (List, Swimlanes, Analytics) slot in without restructuring.
  - Filters in the header reclaim the `TaskFilters` bar's vertical space for lanes/cards —
    directly serves the "no scrollbars, max density" priority.
  - Open-design pass de-risks the visual result before implementation; artifacts double as
    the `docs/04_DESIGN.md` same-commit surface evidence (T3).
  - Subtask progress on cards is computable client-side from `parentWbs` — no contract
    change required for the core card upgrade.
- **Cons:**
  - New shell + tabs contract adds two files and a layout shift — larger diff than a toolbar
    restyle.
  - `TaskKanbanView` is embedded by the Workspace module (`workspace/tabs.ts`); the headerless
    export must be preserved alongside the new shell (two entry points to keep honest).
  - Open-design run adds a generation/iteration loop before code lands.

**Implementation Notes:**
- Header full-width, not `max-w-[1600px]`: a centered header over a full-bleed board
  misaligns the tab strip with the lanes. "Same width as History's header" is honored as
  same *layout/structure*; the width follows the module's full-width mandate (§2.1).
- Combined input parse rule: `/^\d{4}$/` → select/open that task (existing path-WBS popup);
  dotted WBS → `parentWbs` filter; anything else → `featureId` substring filter.
- Status checkboxes reuse the existing lane-visibility toggles (default hidden: blocked,
  cancelled); phase dropdown reuses the `api.task.folders` select.
- Assignee chip on cards requires growing the task-list contract (`assignee` is currently
  client-side-only per `types.ts`) — optional extension, flagged for system-design.
- Detail panel (`TaskDetail`, `--detail-w`, Escape, path-WBS auto-popup): untouched.

**Confidence:** HIGH
**Sources:** `apps/web/src/modules/history/HistoryShell.tsx`, `apps/web/src/modules/history/tabs.ts`,
`apps/web/src/modules/task-kanban/{index,KanbanBoard,TaskFilters,TaskCard,useTaskParams,types}.tsx/ts`,
`apps/web/src/styles/global.css` (0420 token scope), `DESIGN.md` — all read 2026-08-24.
Open Design agent availability verified via `list_agents` 2026-08-24.

### Approach 2: Minimal in-place header (no shell, no open-design)

**Description:** Restyle `KanbanBoard`'s existing toolbar row into a History-like header in
place — icon + name on the left, filters + a hardcoded "Kanban" label on the right. No
`TasksShell`, no `tabs.ts`, no design-generation loop.

**Trade-offs:**
- **Pros:** smallest diff (one file); zero new structure; fastest to ship.
- **Cons:** punts the tab extensibility the idea explicitly prepares for; hardcoded tab label
  diverges from the History/observability shell convention the next module refactor will
  expect; no visual pre-validation; the Workspace embed problem must still be solved
  identically, so the saving is smaller than it looks.

**Confidence:** HIGH (mechanics verified in the same source reads, 2026-08-24)

### Approach 3: Open-design-led multi-view redesign

**Description:** Run the open-design loop over the whole module and ship `tabs.ts` with
Kanban + List (dense sortable table) + Swimlanes (group by feature/assignee) from the start.

**Trade-offs:**
- **Pros:** front-loads the "more tabs later" roadmap with designed, validated views.
- **Cons:** 2–3× the scope; violates surgical-change discipline; "later" tabs were explicitly
  deferred by the idea; each new view multiplies the verification surface for no current
  requirement.

**Confidence:** MEDIUM (views are speculative — no requirements exist for them yet)

## Recommendation

**Approach 1.** It is the only option that satisfies all three stated requirements (header
parity, inline filters, full-width density) *and* the explicit open-design mandate, while
reusing the proven History shell pattern instead of inventing a second convention. Approach 2
saves ~2 files but strands the tab contract; Approach 3 buys unrequested views.

**Suggested future tabs** (for the append-only `tabs.ts`, when prioritized): **List** — dense
sortable table for scanning large task sets; **Swimlanes** — Kanban columns × feature/assignee
rows; **Analytics** — throughput/cycle-time/status distribution, paralleling History's Summary.

**Suggested card additions** (no detail-panel open required): subtask progress (`done/total`,
computed from `parentWbs`), priority as a colored left-border + chip, feature badge (click →
filter by that feature), staleness-tinted relative time, type icon. Assignee chip if the list
contract grows `assignee`.

## Design Summary

**Structure:** `TasksShell.tsx` (new) owns the header row and tab switching; `tabs.ts` (new,
append-only, mirrors History's contract comment) declares `{ id: 'kanban', label: 'Kanban' }`.
`KanbanBoard` loses its toolbar row and renders lanes full-bleed inside `flex-1
overflow-hidden`. Module route `tasks` points at the shell; the exported headerless
`TaskKanbanView` remains for the Workspace embed.

**Header layout (one row, wraps on narrow):** `📋 Tasks` + subtitle + live chip (Live/Polling,
reuses the existing connected indicator) → phase `Select` (`api.task.folders`, active folder
from server) → status checkboxes (lane visibility; blocked/cancelled hidden by default) →
combined WBS/feature input → tab strip (`bg-base-300 p-1 rounded-xl`, History styling).

**Combined input parse rule:** exact 4-digit WBS → navigate `/board/tasks/<wbs>` (opens the
existing detail popup); dotted WBS → `parentWbs` filter; otherwise → `featureId` substring.
All filters stay URL-driven via `useTaskParams` (shareable URLs preserved).

**Body:** full-width, no `max-w` constraint; lanes flex to fill; horizontal scroll only when
lane count exceeds viewport (current behavior); vertical scroll inside lanes only.

**Cards:** existing fields (WBS, name, priority, type, feature, relative time) + subtask
progress derived client-side from `parentWbs` + staleness tint + priority accent. Optional:
assignee chip behind a contract extension (decision for system-design).

**Open-design loop:** `create_project('tasks-frontend')` → `start_run` with a prompt naming
`DESIGN.md` tokens and the header/card spec → iterate on the artifact → implement React to
match → browser-verify golden path (filter, DnD, detail popup) against the artifact.

**Non-goals:** detail panel appearance/behavior unchanged; no new tabs beyond Kanban; no
server-side filter changes except the optional `assignee` contract growth.

## Next Steps

1. Approve idea evaluation (`.spur/run/…-idea-eval-report.md`) → feature-create.
2. System-design state (needs_design=true): settle the assignee contract question and the
   shell/embed split.
3. Open-design project + generation run for header/cards.
4. Decompose: shell+tabs, header filters, card enrichment, open-design loop, verification.
