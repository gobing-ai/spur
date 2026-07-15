---
template: feature-impl
schema_version: 1
name: "Add Processes watch-list tab to Teams (supervisor v1, prepare for full ProcessExecutor registry)"
description: ""
status: todo
type: task
profile: standard
feature_id: M1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-15T05:35:26.619Z"
updated_at: "2026-07-15T06:00:32.866Z"
---

## 0262. Add Processes watch-list tab to Teams (supervisor v1, prepare for full ProcessExecutor registry)

### Background
M1 R5 + Decisions: Add a Processes tab to Teams. Its purpose is a "process watch list" of processes created via ProcessExecutor.

Current Observability ProcessListTab walks the OS tree rooted at the serve pid + overlays supervisor entries. For Teams we want a focused watch list, initially of supervised team agents.

v1 will use the existing supervisor list (via /api/team/processes). The task also prepares the UI surface for the future full registry that will come from upstream work in ts-runtime (see 0264).

Controls that used to live in Roster (start/stop per process) can be offered here as well.
### Requirements
R1. Add a new tab entry to TEAMS_TABS: id 'processes', label 'Processes', component = new ProcessesTab.

R2. Implement ProcessesTab (modeled on but not copying the old observability one) that polls /api/team/processes (or the supervisor list) and renders a table with agentId, pid, status, startedAt, actions.

R3. For v1 the list focuses on supervisor-managed processes. Clearly mark or filter to team-related entries.

R4. Provide "Attach" or quick-select action that can populate the Terminal tab's local selection (loose coupling).

R5. Leave extension points / comments for when the full ProcessExecutor registry lands (0264).

R6. Update the shell default and any module registration if needed.
### Acceptance Criteria
```gherkin
@core
Scenario: R5 Processes tab renders a watch list of supervised processes (v1)
  Given spur serve running with one or more supervisor-managed team members
  When the operator opens the Processes tab inside the Teams module
  Then a list/table of processes is shown
  And each row includes at minimum: agentId, pid, status, startedAt
  And status uses the standard Badge component (success for running)
  And the list is clearly labeled as "Supervised Processes (v1)" or equivalent

@core
Scenario: Attach action is available (loose coupling to Terminal)
  Given the Processes tab is displaying at least one running process
  When the operator clicks the "Attach" (or "Open in Terminal") action on a row
  Then the agentId is made available for the Terminal tab's local selection
  (implementation may use event or direct call once 0259 selector is stable)

@edge
Scenario: Empty state when no supervised processes
  Given no team members are currently supervised
  When viewing the Processes tab
  Then a friendly empty message is shown ("No supervised processes" or similar)
  And the UI does not crash or show loading forever

@edge
Scenario: Preparation for full registry is visible
  Given the component source
  Then there is a clear TODO / comment referencing task 0264 and the future full ProcessExecutor registry
  And v1 data source comment points to /api/team/processes (supervisor only)
```
### Q&A
**Q: Should the Processes tab use the full observability tree or just supervisor?**

A: Supervisor only for v1 (via /api/team/processes). This matches the "watch list of processes created via ProcessExecutor" intent and the "supervised team agents" scope. The full tree (with descendants, rss, commands) stays in Observability for now. We prepare the component for future swap to richer registry (0264).

**Q: Where do the old Roster controls (Up/Down, per-member Start/Stop) live now?**

A: Per-process Start/Stop can move into the actions column of this tab. Bulk team Up/Down can be a small header control or left primarily to the CLI for the moment (documented in 0260 redistribution). The main goal of this tab is the watch list + attach.

**Q: How does "Attach" work with the new local selection in Terminal (0259)?**

A: Loose coupling. For this task we implement the button and a clear signal (custom event or a small shared hook). TerminalTab (after 0259) can listen. We avoid tight shared selection state.

**Q: Do we need new server APIs?**

A: No. /api/team/processes + the existing start/stop/stdin endpoints are sufficient for v1.

**Q: Default tab order after Roster removal?**

A: Per 0259/0260 decisions, default remains 'terminal'. Processes becomes a secondary/peer tab (order in TEAMS_TABS can be terminal, processes, messages, activity or similar).

**Q: Scope of "prepare for full ProcessExecutor registry"?**

A: Mostly documentation + TODO comments + keeping the row model simple (agentId as primary key). Actual data source switch and richer metadata (one-shot runs, etc.) is for 0264.
### Design
**New ProcessesTab component in the Teams module (v1 supervisor-focused watch list)**

The goal (per M1) is a "process watch list" scoped to team agents, initially backed by the supervisor's list of processes created via ProcessExecutor (the supervised agent loops). This is deliberately narrower than the full serve-rooted tree in Observability's ProcessListTab (which walks ps + overlays supervisor + descendants).

Data source:
- Reuse the existing lightweight `GET /api/team/processes` (already implemented in server team module).
- Response shape: `{ processes: [{ agentId, pid, status, startedAt, exitCode? }], count }`
- No need for the heavier `/api/observability/processes` (full tree with ppid, depth, rss, command, etc.).

UI:
- Polling component (every 3s, like ProcessListTab and Roster).
- Simple table or list:
  - agentId (clickable / primary)
  - pid
  - status (reuse Badge: success for running, ghost otherwise)
  - startedAt (formatted, or relative)
  - Actions column: "Attach" (primary action), and Start/Stop buttons (moved from Roster controls).
- "Attach" action: signals the local selection in Terminal tab (loose coupling). Since Terminal (0259) now owns its own state, we can:
  - Dispatch a custom event (e.g. 'teams:attach-process') that TerminalTab listens for.
  - Or (simpler for v1): the Attach button can log the intent and we wire it properly in a follow-up once Terminal selector is stable. For the task, implement the button + a TODO comment.
- Empty/loading/error states consistent with other tabs.
- Header: "Supervised Processes" + count, with note "v1 — supervisor only (full ProcessExecutor registry coming via 0264)".

Component location:
- New file: `apps/web/src/modules/teams/ProcessesTab.tsx`
- Register in `tabs.ts`: add `{ id: 'processes', label: 'Processes', component: ProcessesTab }` (after Terminal or at logical place; order per append-only contract after 0260 removal of Roster).

Integration:
- Add to TeamsShell tablist (already dynamic over TEAMS_TABS).
- Update default active tab? (leave as 'terminal' per 0259/0260 decisions; Processes is secondary watch surface).
- Reuse existing patterns: fetchWithTimeout, resolveApiUrl, Badge, Loading from '@/ui'.
- For actions: reuse the start/stop URLs and act() logic patterns from the old RosterTab (now being redistributed).
- No new server endpoints needed for v1.

Preparation for full registry (0264):
- Leave clear extension points: a comment "TODO: switch data source to full ProcessExecutor registry when available (task 0264)".
- Keep the component decoupled from specific supervisor shape where possible (use a small adapter or typed interface).
- AgentId will remain the key for attach/selection.

Controls migration (from dropped Roster):
- Per-process Start/Stop can live in the actions column (only enabled for appropriate states).
- Bulk team Up/Down will likely live in a small header toolbar or be left to CLI for now (document in task).

Trade-offs:
- Duplicates some polling + table rendering logic from ProcessListTab → acceptable for scoped view; can later extract a shared <ProcessTable> if duplication grows.
- Read-only list + light actions for v1. Full "watch + control" surface can deepen later.
- Loose coupling for Attach: avoids tight dependency between tabs while 0259/0262 land in parallel.

Impacted files (for this task):
- apps/web/src/modules/teams/tabs.ts (add ProcessesTab import + entry)
- apps/web/src/modules/teams/ProcessesTab.tsx (new)
- apps/web/src/modules/teams/TeamsShell.tsx (no change needed if using the array)
- Tests: apps/web/tests/modules/teams/ (add basic mount + poll test)
- M1 AC comment for R5

No changes to server, supervisor, or upstream ProcessExecutor yet (that's 0264).
### Plan
1. Create `apps/web/src/modules/teams/ProcessesTab.tsx`:
   - Polling fetch of `/api/team/processes` (3s interval, AbortController like other tabs).
   - Render table/list using existing Badge/Loading.
   - Columns: agentId (monospace), pid, status (Badge), startedAt (formatted), actions.
   - "Attach" button that signals agentId (for now: console + TODO; later integrate with Terminal local state from 0259).
   - Optional: Start/Stop buttons per row (migrate logic from old RosterTab).

2. Update `apps/web/src/modules/teams/tabs.ts`:
   - Import ProcessesTab.
   - Add `{ id: 'processes', label: 'Processes', component: ProcessesTab }` to TEAMS_TABS (append-only after Roster removal).

3. Ensure TeamsShell continues to work (no change needed; it already maps over the array).

4. Add basic test coverage in the teams test files (mount, data loading, empty state).

5. Update M1 feature AC comment for R5 to point at this task.

6. Add prominent v1 note + TODO for 0264 upstream registry in the component.

7. Run web checks (`bun run check`), `spur task check 0262`, and manual smoke in the board (after starting some team members).

8. Coordinate with 0260 (Roster removal) and 0259 (Terminal) so controls and attach make sense together.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

M1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
