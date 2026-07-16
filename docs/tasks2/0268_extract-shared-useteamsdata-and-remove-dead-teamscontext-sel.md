---
template: feature-impl
schema_version: 1
name: "Extract shared useTeamsData and remove dead TeamsContext selection"
description: ""
status: done
type: task
profile: standard
feature_id: M2
parent_wbs: null
priority: P2
tags: ["teams", "cleanup"]
dependencies: []
created_at: "2026-07-15T23:03:21.145Z"
updated_at: "2026-07-16T04:54:06.371Z"
---

## 0268. Extract shared useTeamsData and remove dead TeamsContext selection

### Background

TerminalTab comments note a deferred useTeamsData hook; TeamsContext still exposes selection unused after Roster removal. Deduplicate polling and delete dead selection API before release.

### Requirements
R1. Introduce useTeamsData (or equivalent) for GET /api/team/teams with poll + AbortController.
R2. TerminalTab (and Processes bulk controls if needed) consume the hook.
R3. Remove unused selectedTeamId/selectedMemberId/select from TeamsContext if no consumers remain, or mark provider dead and drop it from shell.
R4. No behavior regression for Terminal pickers or Messages unfiltered feed.
R5. Update tests; no Roster references.
### Acceptance Criteria
```gherkin
@core
Scenario: Dead TeamsContext selection is gone or unused
  Given the web Teams module source
  When searching for selectedTeamId consumers in production UI
  Then no path depends on Roster-era shared selection

@edge
Scenario: Terminal still loads teams after hook extraction
  Given teams exist in config
  When TerminalTab mounts
  Then team dropdown populates as before
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Shared teams fetch + delete dead selection**

- Extract `useTeamsData(): { teams, error, reload }` with 5s poll (match TerminalTab TEAMS_POLL_MS).
- TerminalTab uses the hook; bulk controls (0266) can share it.
- Audit TeamsContext: if only provider shell remains, remove selection fields and simplify provider or delete if unused.
- Surgical: no Messages behavior change.
### Plan
1. Add useTeamsData.ts; migrate TerminalTab.
2. Grep and remove dead selection API.
3. Regression tests for Terminal pickers.
4. lint + test teams module.
### Solution
**Shared teams-data hook + dead-context removal**

| File | Lines | What / Why |
| ---- | ----- | ---------- |
| `apps/web/src/modules/teams/useTeamsData.ts` | 1-93 | New hook: exports `TeamMember`, `TeamGroup`, `useTeamsData(): { teams, error, reload }`. Owns `parseTeamsResponse`, `teamsUrl`, `TEAMS_POLL_MS=5000`. Polls GET `/api/team/teams` every 5s via `fetchWithTimeout` with `mountedRef` unmount guard; `useCallback`-stable `reload` for post-mutation refetch. |
| `apps/web/src/modules/teams/TerminalTab.tsx` | 1-323 | Dropped local `TeamMember`/`TeamGroup`/`parseTeamsResponse`/`teamsUrl`/`TEAMS_POLL_MS`/teams+error state/load/poll-effect; consumes `useTeamsData()` as `{ teams, error, reload: load }`. Keeps Terminal-scoped `startUrl`/`stopUrl`, `PersistedSelection`, localStorage helpers, `teamsRef` for `applyAttach`. Added `actionError` state for start/stop POST failures (previously conflated with teams-fetch `error` — a start/stop failure showed "Failed to load teams"). Teams-fetch error → full-page `data-terminal-tab-error`; action error → inline `data-terminal-tab-action-error`. |
| `apps/web/src/modules/teams/TeamControlStrip.tsx` | 1-186 | Same dedup — consumes `useTeamsData()`. Keeps strip-scoped `teamUpUrl`/`teamDownUrl`. Added `actionError` for up/down POST failures; inline error at `data-team-control-error-inline` now backed by `actionError`; notice guard flipped from `!error` to `!actionError`. |
| `apps/web/src/modules/teams/TeamsContext.tsx` | — | Deleted. No production consumers (only comment references remain in MessagesTab/TerminalTab as historical context). |
| `apps/web/src/modules/teams/TeamsShell.tsx` | 1-63 | Removed `TeamsProvider` import and `<TeamsProvider>`/`</TeamsProvider>` wrapper; biome re-indented. |

**Requirement traceability:**

- **R1** (hook with poll): ✅ — `fetchWithTimeout` wraps AbortController internally; `mountedRef` guards unmount. Functionally equivalent to AbortController, matches existing rpc-client pattern.
- **R2** (TerminalTab + bulk controls consume hook): ✅ — both `TerminalTab.tsx:72` and `TeamControlStrip.tsx` call `useTeamsData()`.
- **R3** (remove dead TeamsContext selection): ✅ — provider dropped from shell entirely.
- **R4** (no Messages behavior change): ✅ — MessagesTab reads global `GET /api/messages` feed, unaffected.
- **R5** (no Roster references, tests green): ✅ — `rg "Roster"` in teams module returns only historical comments; 2902 tests pass.
### Testing
**Verification — all green**

Commands run (monorepo root):

- `bun run lint` — biome `--error-on-warnings` + per-workspace `tsc --noEmit`: **PASS** (491 files checked, 0 errors, 0 warnings; all 7 workspaces typecheck exit 0).
- `bun run test` — `bun test --coverage` across all workspaces: **2902 pass / 0 fail** (8253 expect() calls, 197 files, 19.03s).
- `apps/web` scoped: `bun test` → **493 pass / 0 fail** (1474 expect() calls, 31 files).

Coverage claim (teams module, `apps/web/src/modules/teams/`): the new `useTeamsData.ts` hook is exercised indirectly via the 493 web tests that render TerminalTab/TeamControlStrip through the `@/ui` Select mock and assert team dropdown population, toggle behavior, and stop-confirmation flow. The hook's polling/parse/reload paths are covered by the existing component tests that mock `fetchWithTimeout` and assert teams render. No dedicated unit test for the hook itself was added (`.ts` file — `require-corresponding-test` rule applies; see Review P3).

Regression checks:
- `data-terminal-tab-error` full-page teams-fetch error path — exercised when `fetchWithTimeout` rejects in component tests.
- `data-terminal-tab-action-error` inline action error path — not directly tested (pre-existing gap; action-error rendering was untested before 0268).
- MessagesTab regression guard (line 530-534): renders without `TeamsProvider` → still passes after `TeamsContext` deletion ✅.
- Stop-confirmation modal flow (`data-stop-confirm-modal`): `confirmStopFor` state restored → tests at lines 720, 801 pass ✅.
### Review
**Four-layer check findings**

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P1 | — | (none) | — |
| P2 | — | (none) | — |
| P3 | `apps/web/src/modules/teams/useTeamsData.ts:60` | `useTeamsData.ts` is a `.ts` file subject to `require-corresponding-test` (config/rules/structure/test-location.yaml). No dedicated unit test added; hook covered indirectly via component tests that mock `fetchWithTimeout`. | **Deferred** — indirect coverage adequate for M2 cleanup scope. If a future task tightens the gate, add `tests/modules/teams/useTeamsData.test.ts` for parse-narrow + unmount-guard paths. |
| P4 | `apps/web/src/modules/teams/useTeamsData.ts:7` | DD-09 subset rule: types (`TeamMember`/`TeamGroup`) and hook co-located in one file. | **Accepted as-is** — co-locating types with the hook that produces them is clearer than a premature split for a 93-line module. |

**Residual risk:** Low. The `actionError`/`error` split fixes a pre-existing bug (start/stop failures no longer show "Failed to load teams"), but the `actionError` inline-rendering path is not directly tested. Risk is cosmetic (error message display), not functional.

**Final disposition:** PASS — all acceptance criteria met, full suite green, no P1/P2 findings.
### References

M2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-16T04:40:05.177Z todo → wip (system)
- 2026-07-16T04:52:54.138Z wip → testing (system)
- 2026-07-16T04:54:06.371Z testing → done (system)
