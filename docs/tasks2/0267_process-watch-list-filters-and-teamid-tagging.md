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
updated_at: "2026-07-16T02:56:41.873Z"
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
**Backend (teamId tagging — R1):**
- `packages/app/src/services/supervisor-service.ts:29-30` — Added `teamId?: string | null` to `ProcessEntry` interface.
- `packages/app/src/services/supervisor-service.ts:154-157` — `start()` resolves `teamId` from `spec.tags` (`team:<id>` prefix). First matching tag wins; null if no team tag.
- `packages/app/src/services/supervisor-service.ts:168-169` — Threaded `teamId` into `PipeProcessOptions` for ProcessRegistry execution row.
- `packages/app/src/services/supervisor-service.ts:185` — `teamId` set on `ProcessEntry` returned by `list()`.
- `apps/server/src/modules/team/index.ts:49` — `GET /api/team/processes` supervised row mapping includes `teamId: p.teamId ?? null`.

**Frontend (filters + empty state — R2, R3, R4):**
- `apps/web/src/modules/teams/ProcessesTab.tsx:52` — Added `teamId: string | null` to `WatchRow` interface.
- `apps/web/src/modules/teams/ProcessesTab.tsx:65-98` — `buildWatchRows` sets `teamId` on supervised rows (`p.teamId ?? null`) and registry rows (`e.teamId ?? null`).
- `apps/web/src/modules/teams/ProcessesTab.tsx:102-130` — `WatchFilters` + `filterWatchRows()` pure helper (runningOnly; source `all|supervisor|one-shot|other`; team / `unassigned`).
- `apps/web/src/modules/teams/ProcessesTab.tsx:131-204` — `ProcessFilterControls` with native checkbox/selects. Source options: all / supervisor / one-shot / other (R2).
- `apps/web/src/modules/teams/ProcessesTab.tsx:218+` — ephemeral `useState<WatchFilters>` (R3); filtered empty state (R4).
- Team column on table (`data-process-team`).

**Tests (R5):**
- `packages/app/tests/services/supervisor-service.test.ts` — 2 teamId tagging tests.
- `apps/web/tests/modules/teams/components.test.tsx` — 9 pure-helper tests (incl. one-shot/other) + 4 filter UI tests.

**Key decisions:**
- teamId from `spec.tags` inside `SupervisorService.start()` — no new service dependency.
- `filterWatchRows` exported for unit testability.
- Native HTML controls for happy-dom + React 19.

**Verify fix (`--fix all`, 2026-07-15):** Source dropdown used `registry`, which never matched production row sources (`one-shot`). Aligned to R2 (`supervisor|one-shot|other`); `other` excludes supervisor and one-shot. Adjusted fixtures + 0264 assertion (dropdown label collision).
### Testing
**Verify run:** 2026-07-15 (standalone `/sp:dev-verify 0267 --auto --focus all --fix all --force --next`)

**Commands run (this verify):**
- `bun test packages/app/tests/services/supervisor-service.test.ts apps/web/tests/modules/teams/components.test.tsx` — **64 pass, 0 fail** (post-fix).
- `spur task check 0267 --strict-core` — **pass** (warning only: AC scenario not in M2 feature AC subset, DD-09).
- Prior implementer suite: `bun run lint` / `bun run test` / `bun run build` reported green at done transition.

**Coverage:**
- `packages/app/src/services/supervisor-service.ts`: 100% lines / 92.11% functions (in scoped test run).
- `apps/web/src/modules/teams/ProcessesTab.tsx`: covered via component + pure-helper tests (`.tsx` excluded from per-file gate).
- Coverage: N/A for full monorepo aggregate this run; scoped evidence above.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 Supervisor start tags teamId when agent has known team | MET | `supervisor-service.ts:154-169,185`; tests `resolves teamId from spec.tags` + `leaves teamId null` (`supervisor-service.test.ts:124-162`); API maps `teamId` (`apps/server/src/modules/team/index.ts:49,65`) |
| R2 ProcessesTab filters: running-only, source (supervisor\|one-shot\|other), optional team | MET | `filterWatchRows` + `ProcessFilterControls` (`ProcessesTab.tsx:102-196`); UI options all/supervisor/one-shot/other; component tests + 9 pure-helper tests |
| R3 Filter state ephemeral (no persistence) | MET | `useState<WatchFilters>` only (`ProcessesTab.tsx:218`); no localStorage for filters |
| R4 Empty state when filters hide all rows | MET | filtered-empty branch + copy (`ProcessesTab.tsx:335-350`); test `filters hiding all rows show the no-matches empty state` |
| R5 Tests for filter logic + API teamId | MET | 9 `filterWatchRows`/`buildWatchRows` unit tests + 4 ProcessesTab filter UI tests + 2 supervisor teamId tests |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: Process watch list can focus running registry executions (@core) | MET | test | `running-only checkbox hides non-running rows`; `runningOnly filter hides non-running rows` — 64/64 green this run |
| Scenario: Supervised spawns carry teamId when team membership is known (@edge) | MET | test | `resolves teamId from spec.tags (team:<id>) and tags the process entry` — expect `entry.teamId` + `calls[0].teamId` = `red-squad` |

**Design conformance**

| Claim | Status | Notes |
|-------|--------|-------|
| UI toggle/selects (running-only, source) | DONE | Single-select (not multi-select) — goal-equivalent; Solution documents native controls |
| Pure helper `filterWatchRows` | DONE | Exported + unit-tested |
| teamId into PipeProcessOptions on supervisor start | DONE | From `spec.tags` `team:<id>` (CHANGED from TeamService map; Solution documents) |
| Ambiguous multi-team: first or unset | DONE | First `team:` tag wins; code comment + prior Review P3 |

**Fix pass (`--fix all`):** Source filter offered `registry`, which does not match production row sources (`one-shot`). Aligned options to R2 (`supervisor` / `one-shot` / `other`); `other` = neither supervisor nor one-shot. Updated unit fixtures + 0264 `getByText('one-shot')` collision with dropdown label.

**SECUA (post-fix):** No blockers/majors. Residual: multi-team first-tag only (accepted P3); `test-cf` pre-existing WebSocket env failure on main (N/A to 0267).

**Verdict:** PASS
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
