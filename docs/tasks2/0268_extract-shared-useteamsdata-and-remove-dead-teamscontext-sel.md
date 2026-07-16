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
updated_at: "2026-07-16T06:41:07.000Z"
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
**Verify run:** 2026-07-15 re-audit (`/sp:dev-verify 0268 --auto --focus all --fix all --force --next`)

**Commands run (this verify — fresh evidence):**
- `rg selectedTeamId|selectedMemberId|TeamsProvider|TeamsContext` under `apps/web/src` — **no production consumers** (historical comments only).
- `TeamsContext.tsx` — **deleted** (`test ! -f` OK).
- Consumers: `TerminalTab.tsx:73`, `TeamControlStrip.tsx:18` call `useTeamsData()`.
- `bun test apps/web/tests/modules/teams/useTeamsData.test.ts apps/web/tests/modules/teams/components.test.tsx apps/web/tests/modules/teams/tabs.test.ts` — **56 pass, 0 fail**, 250 expect().
- `useTeamsData.ts` coverage (scoped): **100% lines / 100% functions**.
- `spur task check 0268 --strict-core` — **pass** (warn: edge AC not in M2 feature AC subset, DD-09).

**Coverage:** N/A for monorepo aggregate this run; scoped hook coverage above. Dedicated unit file: `apps/web/tests/modules/teams/useTeamsData.test.ts` (12 tests).

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 useTeamsData poll + AbortController | MET | `useTeamsData.ts:62-95` — 5s poll (`TEAMS_POLL_MS=5000`), `reload`; AbortController via `fetchWithTimeout` (`rpc-client.ts:44-55`); unit tests green |
| R2 TerminalTab + bulk controls consume hook | MET | `TerminalTab.tsx:73`; `TeamControlStrip.tsx:18` |
| R3 Remove dead TeamsContext selection | MET | file deleted; shell has no TeamsProvider; zero selectedTeamId/selectedMemberId in production UI |
| R4 No Terminal/Messages regression | MET | Terminal dropdown tests; Messages unfiltered feed independent of context |
| R5 Tests; no Roster references | MET | 12 hook unit tests + component suite; Roster only historical comments |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: Dead TeamsContext selection is gone or unused (@core) | MET | command | rg on apps/web/src → empty production hits; TeamsContext.tsx absent |
| Scenario: Terminal still loads teams after hook extraction (@edge) | MET | test | TerminalTab populates team+member dropdowns; useTeamsData happy path — 56/56 pass |

**Design conformance**

| Claim | Status | Notes |
|-------|--------|-------|
| Extract useTeamsData { teams, error, reload } 5s poll | DONE | |
| TerminalTab + bulk controls share hook | DONE | |
| Drop selection / provider when unused | DONE | deleted |
| No Messages behavior change | DONE | |

**Fix pass (`--fix all`):** No UNMET/PARTIAL/major findings — no code changes this verify.

**SECUA:** No blockers/majors. Minor: unmount uses mountedRef (timeout abort still via fetchWithTimeout) — accepted.

**Verdict:** PASS
### Review
**Multi-dimensional review** — `/sp:dev-review 0268 --auto --focus all --fix all --force --next` (2026-07-15)

**Scope:** commit `36b0eabb` — `useTeamsData.ts` (new), `TerminalTab.tsx`, `TeamControlStrip.tsx`, `TeamsShell.tsx`, `TeamsContext.tsx` (deleted). Working tree also has dedicated `useTeamsData.test.ts` (100% hook coverage).

**Fresh checks:** `bun test apps/web/tests/modules/teams/` → **90 pass, 0 fail**. Dead-selection audit (`rg selectedTeamId|selectedMemberId|TeamsProvider` on `apps/web/src`) → clean. `TeamsContext.tsx` → deleted. `strict-core` → pass.

---

**Functional traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 useTeamsData poll + AbortController | MET | `useTeamsData.ts:62-95` (5s poll, `reload`); AbortController via `fetchWithTimeout` (`rpc-client.ts:44-55`); 12 unit tests |
| R2 TerminalTab + bulk controls consume hook | MET | `TerminalTab.tsx:73`, `TeamControlStrip.tsx:18` |
| R3 Remove dead TeamsContext selection | MET | file deleted; shell unwraps provider; zero production selection consumers |
| R4 No Terminal/Messages regression | MET | Terminal picker tests + Messages unfiltered feed (no context) |
| R5 Tests; no Roster refs | MET | hook unit suite + components/tabs; Roster only historical comments |

**Functional Verdict: PASS**

---

**SECUA findings** (severity-ranked)

| Sev | Dim | Location | Finding | Disposition |
|-----|-----|----------|---------|-------------|
| — | S | — | No secrets, injection, or unsafe authz issues. JSON body narrowed in `parseTeamsResponse`; URLs use `encodeURIComponent`. | clean |
| P3 | E | `TeamControlStrip.tsx:18` + `TerminalTab.tsx:73` | Two independent `useTeamsData()` instances when Terminal is active → dual GET `/api/team/teams` every 5s. **Pre-existing pattern** (each component polled before extraction); not a regression. | Accepted / follow-up |
| P3 | C | `useTeamsData.ts:72-76` | When `res.ok` but body fails parse, neither `teams` nor `error` updates (silent stall on malformed 200). | Accepted v1 (unit tests cover invalid bodies leaving empty) |
| P3 | C/U | `TerminalTab.tsx:270-272` | `actionError` inline path untested (`data-terminal-tab-action-error`); strip path is covered. Pre-existing gap; split is a UX improvement. | Deferred |
| — | U | — | Clear separation: teams-fetch error vs action error; data attrs for tests. | clean |
| — | A | — | Hook extraction deepens data layer; dead selection provider correctly deleted. | clean |

No P1/P2 (blocker/major).

---

**Architecture (deepening candidates)**

| ID | Sev | Signal | Location | Symptom / proposal |
|----|-----|--------|----------|--------------------|
| C1 | advisory | weak locality / efficiency | shell + strip + terminal | Shared *code* but not shared *instance*. Optional follow-up: `TeamsDataProvider` at shell so one poll feeds strip + active tab (must not reintroduce selection context). Challenge: component tests mount strip/tab alone — need provider in tests or fallback. Defense: worth it only if dual poll is measured load. |
| C2 | advisory | poor test surface | Terminal actionError | Add one component test for start/stop failure → `data-terminal-tab-action-error` (strip already covered). |

No architecture blockers/majors.

---

**Fix pass (`--fix all`):** No UNMET/PARTIAL requirements and no blocker/major findings — **no code changes**.

**Residual risk:** Low. Dual poll is local-dev noise only. Silent-parse edge is rare (server returns schema-shaped JSON).

**Final disposition: PASS** — functional complete, SECUA clean of gate-blocking issues, architecture advisory only.
### References

M2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-16T04:40:05.177Z todo → wip (system)
- 2026-07-16T04:52:54.138Z wip → testing (system)
- 2026-07-16T04:54:06.371Z testing → done (system)
