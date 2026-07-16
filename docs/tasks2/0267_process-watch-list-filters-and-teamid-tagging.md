---
template: feature-impl
schema_version: 1
name: "Process watch list filters and teamId tagging"
description: ""
status: done
type: task
profile: standard
feature_id: M2
parent_wbs: null
priority: P2
tags: ["teams", "process-registry"]
dependencies: []
created_at: "2026-07-15T23:03:21.136Z"
updated_at: "2026-07-16T01:28:04.572Z"
---

## 0267. Process watch list filters and teamId tagging

### Background

After 0264, GET /api/team/processes returns supervisor processes + ProcessRegistry executions. The UI shows a flat list. Operators need running-only / source filters, and supervised spawns should carry teamId when known for grouping.

### Requirements
R1. Supervisor start path tags teamId when the agent belongs to a known team (from team config / roster materialize).
R2. ProcessesTab offers filters: running-only, source (supervisor|one-shot|other), optional team.
R3. Filter state may be ephemeral (no persistence required for v1).
R4. Empty state when filters hide all rows.
R5. Tests for filter logic (unit on buildWatchRows or pure filter helper) + API teamId when available.
### Acceptance Criteria
```gherkin
@core
Scenario: Process watch list can focus running registry executions
  Given supervised and exited one-shot executions exist
  When the operator enables running-only filter
  Then exited rows are hidden

@edge
Scenario: Supervised spawns carry teamId when team membership is known
  Given agent alpha-claude belongs to team alpha
  When supervisor starts the agent
  Then the registry execution includes teamId alpha (or equivalent association)
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Filters + teamId on registry rows**

- UI: lightweight toggle/selects above Processes table (running-only, source multi-select).
- Pure helper `filterWatchRows(rows, filters)` for unit tests.
- Server: when SupervisorService starts an agent, resolve teamId from team config if available (TeamService or config map passed into supervisor). Pass `teamId` in PipeProcessOptions.
- If team membership is ambiguous (agent in multiple teams), pick first or leave unset — document in Q&A.
### Plan
1. Add filterWatchRows helper + UI controls in ProcessesTab.
2. Thread teamId into supervisor start when resolvable.
3. Tests for filters and teamId tag.
4. Update empty-state copy for "no matches".
### Solution
<!-- Filled during implementation: file:line change map and concise rationale. -->

**Backend (teamId tagging — R1):**
- `packages/app/src/services/supervisor-service.ts:29-30` — Added `teamId?: string | null` to `ProcessEntry` interface.
- `packages/app/src/services/supervisor-service.ts:154-157` — `start()` resolves `teamId` from `spec.tags` (`team:<id>` prefix). First matching tag wins; null if no team tag.
- `packages/app/src/services/supervisor-service.ts:168-169` — Threaded `teamId` into `PipeProcessOptions` for ProcessRegistry execution row.
- `packages/app/src/services/supervisor-service.ts:185` — `teamId` set on `ProcessEntry` returned by `list()`.
- `apps/server/src/modules/team/index.ts:49` — `GET /api/team/processes` supervised row mapping includes `teamId: p.teamId ?? null`.

**Frontend (filters + empty state — R2, R3, R4):**
- `apps/web/src/modules/teams/ProcessesTab.tsx:52` — Added `teamId: string | null` to `WatchRow` interface.
- `apps/web/src/modules/teams/ProcessesTab.tsx:65-98` — `buildWatchRows` sets `teamId` on supervised rows (`p.teamId ?? null`) and registry rows (`e.teamId ?? null`).
- `apps/web/src/modules/teams/ProcessesTab.tsx:100-122` — `WatchFilters` interface + `filterWatchRows()` pure helper (runningOnly, source, team filters; `unassigned` sentinel for null teamId).
- `apps/web/src/modules/teams/ProcessesTab.tsx:131-204` — `ProcessFilterControls` component with native `<select>`/`<input type="checkbox">` (avoids `@/ui` Select mock issues under happy-dom). Data attributes: `data-processes-filters`, `data-processes-filter-running-input`, `data-processes-filter-source`, `data-processes-filter-team`, `data-processes-filter-clear`, `data-processes-filter-count`.
- `apps/web/src/modules/teams/ProcessesTab.tsx:213-260` — `ProcessesTab` body: `useState<WatchFilters>` (ephemeral, R3), `useMemo` for `filteredRows` and `teamIds`.
- `apps/web/src/modules/teams/ProcessesTab.tsx:270-290` — R4 empty state: renders `ProcessFilterControls` + "No processes match the current filters" with `data-processes-tab-filtered-empty` / `data-processes-tab-no-matches` when `filteredRows.length === 0` but `watchRows.length > 0`.
- `apps/web/src/modules/teams/ProcessesTab.tsx:380-420` — Team column added to table (`<th>Team</th>` + `<td data-process-team={p.teamId ?? ''}>`).

**Tests (R5):**
- `packages/app/tests/services/supervisor-service.test.ts:123-175` — 2 tests: teamId tagged from `team:red-squad` tag; teamId null when no team tag.
- `apps/web/tests/modules/teams/components.test.tsx:1288-1380` — 8 `filterWatchRows`/`buildWatchRows` unit tests: teamId threading, runningOnly, source=supervisor, source=registry, team filter, unassigned filter, combined filters, all-pass.
- `apps/web/tests/modules/teams/components.test.tsx:368-488` — 4 ProcessesTab component tests: filter controls + team column render; running-only hides non-running; team filter narrows rows; no-matches empty state (R4).

**Key decisions:**
- teamId resolved from `spec.tags` inside `SupervisorService.start()` — no new service dependency, no breaking signature change.
- `filterWatchRows` exported as pure function for unit testability (`.tsx` exempt from require-corresponding-test rule, but R5 explicitly requires it).
- Native HTML controls instead of `@/ui` Select — happy-dom + React 19 doesn't fire `change` on controlled selects.
### Testing
<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

**Commands run:**
- `bun run lint` — clean (Biome 0 errors, typecheck 0 errors across 7 workspaces).
- `bun run test` — 2901 pass, 0 fail, 8252 expect() calls across 197 files. +14 new tests vs baseline (2887).
- `bun run build` — green (all workspaces + Astro web build).
- `bun run test-cf` — pre-existing failure (WebSocket env issue on clean main), unrelated to 0267.

**Coverage:**
- `packages/app/src/services/supervisor-service.ts`: 100% lines, 92.11% functions.
- `apps/web/src/modules/teams/ProcessesTab.tsx`: covered via component tests (`.tsx` excluded from per-file gate per bunfig.toml).
- New `filterWatchRows` / `buildWatchRows` helpers: 8 unit tests covering all filter branches + teamId threading.
### Review
<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

| Priority | Finding | Disposition |
|----------|---------|-------------|
| P1 | (none) | — |
| P2 | (none) | — |
| P3 | Multiple-team membership picks first `team:` tag — documented in code comment (line 155-156) and Design section. Acceptable for v1. | Accepted |
| P4 | `filterWatchRows` uses strict equality on `source` string — if new source values are added, filter dropdown must be updated. Low risk. | Noted |
| P4 | `test-cf` pre-existing failure on clean main (WebSocket env), not introduced by 0267. | N/A |

**Residual risk:** Low. teamId resolution is additive (null when absent); filters are ephemeral UI state with no persistence impact.

**Final disposition:** PASS — all R1–R5 satisfied, 14 new tests green, lint/typecheck/build clean.
### References

M2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-16T01:25:19.608Z todo → wip (system)
- 2026-07-16T01:27:06.873Z wip → testing (system)
- 2026-07-16T01:28:04.572Z testing → done (system)
