---
template: feature-impl
schema_version: 1
name: "Add Teams bulk Up/Down controls without Roster"
description: ""
status: done
type: task
profile: standard
feature_id: M2
parent_wbs: null
priority: P1
tags: ["teams", "roster-redistribution"]
dependencies: []
created_at: "2026-07-15T23:03:21.128Z"
updated_at: "2026-08-18T04:42:47.442Z"
---

## 0266. Add Teams bulk Up/Down controls without Roster

### Background

M1 dropped Roster and redistributed bulk Up/Down. CLI and POST /api/team/:team/up|down exist, but the Board lacks an obvious bulk control surface. Operators currently need CLI for team-wide start/stop.

### Requirements
R1. Add a Teams UI control (Terminal toolbar or Processes header or thin Team Control strip) for team Up and Down.
R2. Call existing POST /api/team/:team/up and .../down (with optional check/purge as designed).
R3. Show success/error feedback; refresh process/team status after action.
R4. Do not reintroduce a Roster tab.
R5. Tests cover control presence and mocked API posts.
### Acceptance Criteria
```gherkin
@core
Scenario: Team Up and Down are available without Roster
  Given a project with at least one configured team
  When the operator clicks Up for that team in the Teams UI
  Then POST /api/team/:team/up is issued
  And process/team status refreshes

@core
Scenario: Down stops the team via existing API
  Given a running team
  When the operator clicks Down
  Then POST /api/team/:team/down is issued
  And no Roster tab is present
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Bulk team controls on the Board (Roster redistribution finish)**

- Server: `POST /api/team/:team/up` and `.../down` already exist (team module).
- UI placement (recommend Processes header or thin strip above Teams tabs):
  - Team select (reuse teams list) + Up + Down buttons.
  - Confirm modal on Down (destructive), similar to Terminal stop confirm.
- Keep Terminal per-member Start/Stop; bulk is team-scoped.
- Do not re-add RosterTab.
### Plan
1. Add TeamControlStrip component (or Processes/Terminal header controls).
2. Wire Up/Down to existing APIs with fetchWithTimeout.
3. Confirm modal for Down; error banner on failure.
4. Tests for buttons + POST URLs.
5. Manual smoke with spur serve + configured team.
### Solution
**TeamControlStrip component in TeamsShell (R1–R5)**

- `apps/web/src/modules/teams/TeamControlStrip.tsx:1` (new, 253 lines) — thin strip rendered above the tab panel in `TeamsShell`. Owns its own `GET /api/team/teams` fetch (mirrors `parseTeamsResponse` shape; shared `useTeamsData` hook deferred to 0268). Renders team `<Select>` + Up/Down buttons. Up fires `POST /api/team/:team/up` immediately (`TeamControlStrip.tsx:43`). Down opens a confirm modal (`data-team-down-confirm-modal`) before `POST /api/team/:team/down` (`TeamControlStrip.tsx:44`). Success → `data-team-control-notice` inline; error → `data-team-control-error-inline` inline.
- `apps/web/src/modules/teams/TeamsShell.tsx:4` — imports `TeamControlStrip`, renders `<TeamControlStrip />` above `<Tabs>` panel. Import order fixed (Biome organizeImports).
- `apps/web/tests/modules/teams/components.test.tsx:1054` — 6 new TeamControlStrip tests (R1 empty/render, R2 Up POST + notice, R2 Down modal cancel, R2+R3 Down confirm POST + notice, R3 error inline, R1 buttons after team select). `@/ui` Select mock passthrough (`components.test.tsx:56`) extended to include `aria-label` (needed for `getSelectOnChange('team-control')` capture). `id` intentionally NOT passed through — breaks TerminalTab's `<label htmlFor>` association on happy-dom/React 19.

**Key decisions:**
- Both actions post **bare URLs — no `check` / `purge` query params** (R2's "optional check/purge" is deliberately declined). The server reads `?check=true` as a dry-run that materializes and returns `started: []` without starting anything (`apps/server/src/modules/team/index.ts:247,250`), which would make Up a silent no-op; `?purge=true` additionally tears down member specs (`index.ts:277,293`), which exceeds what the Down confirm modal warns about ("terminate all running member processes"). The Up/Down buttons must perform a real start and a stop-only teardown, so neither param is sent.
- The bare-URL contract is pinned by assertions on the posted query string (`components.test.tsx:1123,1228`), not just a substring match on the path — a `.includes('/team/alpha/up')` check stays green if a param is appended, so it could not catch the dry-run regression.
- `load()` moved to success path only (`TeamControlStrip.tsx:119`, not `finally`) — `finally` called `load()` which cleared action errors on success, wiping the error state set by the `!res.ok` branch (`TeamControlStrip.tsx:103`).
- Down confirm modal mirrors TerminalTab's stop-confirm pattern (consistency).
- No Roster tab reintroduced (R4 satisfied by omission).
### Testing
**Verdict: PASS** — confidence **HIGH** (re-audit 2026-07-15 via `/sp:dev-verify 0266 --force --focus all --fix all`)

All 5 requirements and both `@core` AC MET. `--strict-core` gate now green. The prior PARTIAL (Review table) is resolved.

**Commands run (this audit):**
- `bun test tests/modules/teams/components.test.tsx` (apps/web) — **26 pass, 0 fail, 150 expect() calls**
- `bunx tsc --noEmit` (apps/web) — exit 0, clean
- `bun run lint` (monorepo) — all 6 workspaces exit 0
- `bunx biome check` (changed files) — "No fixes applied."
- `rg -ril "roster" apps/web/src apps/web/tests` — zero hits (R4)
- `spur task check 0266 --strict-core` — **PASS** (Review P1–P4 table now present)

**Per-Requirement Traceability** (all confidence HIGH — each backed by a test executed this run)

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — Teams UI control for Up/Down | MET | `TeamControlStrip.tsx:145-199`; mounted `apps/web/src/modules/teams/TeamsShell.tsx:54`; tests `components.test.tsx:1055,1082` |
| R2 — Call POST `/api/team/:team/up` and `/down` | MET | `TeamControlStrip.tsx:43-44,101-102`; POST + bare-query-string asserts `components.test.tsx:1122-1126,1224-1232` |
| R3 — Success/error feedback; refresh after action | MET | notice/error `TeamControlStrip.tsx:201-210`; refresh `load()` `TeamControlStrip.tsx:119`; refetch pinned `components.test.tsx:1131`; tests `:1128,:1226,:1271` |
| R4 — No Roster tab reintroduced | MET | `rg -ril "roster" apps/web/src apps/web/tests` → zero hits |
| R5 — Tests cover control presence and mocked API posts | MET | 6 TeamControlStrip tests `components.test.tsx:1049-1274`; 26/26 green |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Confidence | Evidence |
|----|--------|---------------|------------|----------|
| @core Team Up/Down available without Roster; POST `/up`; status refreshes | MET | test | HIGH | POST asserted `components.test.tsx:1090`; refresh asserted `:1131` (mutation-verified); Roster absent (rg sweep) |
| @core Down stops team via existing API; no Roster tab | MET | test | HIGH | POST asserted `components.test.tsx:1224`; cancel-sends-no-POST `:1130`; Roster absent (rg sweep) |

**Design conformance:** 5/5 claims DONE — thin strip above tabs, team Select + Up/Down, confirm modal on Down (mirrors TerminalTab stop-confirm), per-member Terminal Start/Stop untouched, no RosterTab.

**Fix pass applied (`--fix all`) — 4 findings resolved, 0 unresolved:**

1. *(fixed, HIGH)* **Solution documented `?check=true` / `?purge=true`; code sends neither — the code was right and the record was wrong.** `?check=true` is a server-side dry-run returning `started: []` without starting anything (`apps/server/src/modules/team/index.ts:247-252`); `?purge=true` reaches `teardownTeam` → `deleteAgentSpecFile` on `spur:generated` specs (`packages/app/src/services/team-service.ts`) — deletes spec files from disk, far exceeding the modal's "terminate running processes" warning. Solution corrected to document the bare-URL contract + rationale.
2. *(fixed, HIGH)* **Query-param regression was untested.** Assertions used `.includes('/team/alpha/up')`, which stays green if a param is appended. Added query-string asserts (`components.test.tsx:1126,1232`). Mutation-verified: re-adding both params fails 2 tests; source restored, 26/26 green.
3. *(fixed, HIGH)* **AC clause "process/team status refreshes" had no executable evidence.** The mock recorded only POSTs, so `load()` on the success path (`TeamControlStrip.tsx:119`) was static-ref only — despite a documented bug history (moved out of `finally` because placement was subtle). Added a live refetch assertion (`:1131`). Mutation-verified: commenting out `load()` at :119 fails 1 test.
4. *(fixed, HIGH)* **`--strict-core` Review gate.** Review was prose (`**P1 (blocker):** None.`); `hasPopulatedPriorityTable` (`packages/app/src/services/task-check.ts:74-84`) requires a table row whose severity cell is a bare `P1`–`P4` token (`^\s*P[1-4]\s*$`, `:78`) — `P1 (blocker)` with parenthetical fails. Rewrote Review as a P1–P4 table with bare severity tokens in their own cells. `--strict-core` now **PASS**. *(Operator overrode verify mode's Review-write prohibition per R1; pushback surfaced last turn and confirmed.)*

**Residual (minor, MEDIUM):** TeamControlStrip owns its own teams fetch, duplicating TerminalTab; shared `useTeamsData` hook deferred to 0268 per Design tradeoff. Accepted.

**Coverage:** N/A — `TeamControlStrip.tsx` is `.tsx`, excluded from the per-file gate by `coveragePathIgnorePatterns` (`bunfig.toml:18-19`) and from `require-corresponding-test` (`config/rules/structure/test-location.yaml:41`). Both citations verified this run. Behavior covered by 6 integration tests.

**Confidence caveat (LOW):** Plan step 5 — "Manual smoke with `spur serve` + configured team" — was **not** executed in this audit or the prior run. All evidence is happy-dom integration tests against a mocked `fetch`; no real-runtime browser verification exists for this component. Not a requirement gap; surfaced for transparency.
### Review
| Severity | File | Finding | Recommendation |
|----------|------|---------|----------------|
| P1 | — | None. | — |
| P2 | — | None. | — |
| P3 | `apps/web/src/modules/teams/TeamControlStrip.tsx` | TeamControlStrip fetches its own team list — duplicates TerminalTab's fetch. Shared `useTeamsData` hook deferred to task 0268 per Design Tradeoffs. | Acceptable for now; dedupe in 0268. |
| P4 | `apps/web/tests/modules/teams/components.test.tsx` | `id` intentionally excluded from `@/ui` Select mock passthrough — `aria-label` suffices for test capture, and passing `id` breaks TerminalTab's `<label htmlFor>` association on happy-dom/React 19. | Keep as-is; documented invariant. |
| P4 | `docs/tasks2/0266_add-teams-bulk-up-down-controls-without-roster.md` | Solution section previously documented `?check=true` / `?purge=true` query params the code never sent. Corrected this audit; bare-URL contract now pinned by assertions. | Resolved. |
| P4 | `apps/web/tests/modules/teams/components.test.tsx` | Prior assertions used `.includes()` on the path, staying green if query params were appended; AC-1 "status refreshes" clause had no executable refetch evidence. Both corrected + mutation-verified this audit. | Resolved. |

**Residual risk:** Low. All API calls use `fetchWithTimeout` with proper error handling. Down requires confirmation (destructive guard). No Roster reintroduced (R4). `--strict-core` now passes after converting prose findings to the P1–P4 table.

**Final disposition:** PASS — all 5 requirements met, both `@core` AC MET, 26 tests green, full lint/typecheck clean, `--strict-core` green. (Note: a prior run marked this PASS while Review was prose-only and the suite used loose assertions — both corrected in this re-audit; the present PASS is evidence-backed.)
### References

M2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-16T00:06:26.647Z todo → wip (system)
- 2026-07-16T00:08:05.098Z wip → testing (system)
- 2026-07-16T00:08:16.147Z testing → done (system)
