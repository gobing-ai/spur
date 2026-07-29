---
template: feature-impl
schema_version: 1
name: "Add the Supervisor tabview as the Teams module's first and default-active tab"
description: ""
status: done
type: task
profile: standard
feature_id: J4
parent_wbs: null
priority: P1
tags: ["board", "web", "teams", "supervisor"]
dependencies: ["0371"]
created_at: "2026-07-29T00:15:02.364Z"
updated_at: "2026-07-29T18:52:31.902Z"
---

## 0378. Add the Supervisor tabview as the Teams module's first and default-active tab

### Background

The Teams module opens on Terminal (tabs.ts:15-20, TeamsShell selects the first entry), giving no team-wide operational overview. The nearest thing, the Activity tab, is a flat six-column event table that filters on the `'team.'` and `'supervisor.'` prefixes (ActivityTab.tsx:72) which have never fired — the `team.*` family did not exist until J3 authored it. This task builds the per-team, per-member operational view the operator asked for, on top of that new family plus the existing `agent.*`, `process.*`, and `message.*` events and the live GET /api/team/teams roster already served by `useTeamsData`. Note the tab contract in tabs.ts is documented as append-only with id-stable entries; placing Supervisor first is a deliberate exception to that ordering note and must be recorded, not silently taken.

### Requirements
- [ ] R1. Add Supervisor as the Teams module's first tab and make it the default-active tab, while keeping Terminal, Process, Message, and Activity reachable with their ids unchanged.
- [ ] R2. Show each team with its members, member id, agent type, and current state, making running members visually distinguishable from stopped ones.
- [ ] R3. Show per-member uptime since start and the time and kind of the most recent activity, derived from the team and agent lifecycle events.
- [ ] R4. Reflect team and member lifecycle events as they arrive, without requiring a manual page reload.
- [ ] R5. Expose the existing start, stop, up, and down controls with behaviour identical to the current Teams surfaces, refreshing the view after a mutation completes.
- [ ] R6. Render a configured team with an empty roster as an explicit empty-roster state rather than omitting it.
- [ ] R7. Surface an error when the roster feed fails while keeping already-loaded event-derived activity visible.
- [ ] R8. Reuse the shared `useTeamsData` feed rather than adding a third polling implementation, and record the tab-ordering exception against the append-only note in tabs.ts.
### Acceptance Criteria
```gherkin
Scenario: R18 — Supervisor is the Teams module's first and default-active tab
Scenario: R19 — Each team shows its members and their live state
Scenario: R20 — Member rows surface uptime and last activity
Scenario: R21 — Team lifecycle events drive the view
Scenario: R22 — Existing team controls are available from Supervisor
Scenario: R23 — A team with no members renders an explicit empty state
Scenario: R24 — Supervisor degrades when the roster feed fails
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Add a new `SupervisorTab` component and insert it as the first entry of `TEAMS_TABS` (apps/web/src/modules/teams/tabs.ts:15-20), making it the default-active tab by changing `TeamsShell`'s `useState` initial value from `'terminal'` to `'supervisor'` (TeamsShell.tsx:6). The existing four tabs keep their ids (`terminal`, `processes`, `messages`, `activity`) and ordering after the new entry, so persisted selection and the append-only/id-stable contract are preserved everywhere except the documented Supervisor-first exception.

`SupervisorTab` is a read-mostly operational overview: one card per team from `useTeamsData` (useTeamsData.ts:75-108), each rendering its member roster with id, agent type, and current `status` (running members visually distinct via the same `Badge` success/ghost convention used in TerminalTab.tsx:257,292). Per-member uptime-since-start and last-activity (time + event kind) are derived from the `team.*` event family that J3 authored — `team.member.started`/`team.member.stopped` (team-service.ts:96-104, supervisor-service.ts:51-56) for start timestamp + uptime, plus `team.member.assigned`, `team.up`/`team.down`, `agent.*`, `process.*`, and `message.*` rows for last activity. The tab reuses the ActivityTab fetch+SSE pattern (ActivityTab.tsx:67-68,147-176): load `/api/events/history?limit=100` once, then prepend live frames from the `/api/events/planning` EventSource, filtered to the same `TEAM_EVENT_PREFIXES` set (ActivityTab.tsx:72). The roster feed itself comes from `useTeamsData` (the 5s poll + `reload`), so lifecycle events drive the view live without a manual reload (R4) and no third polling implementation is added (R8).

Tradeoffs considered: (1) Deriving uptime from `team.member.started` events vs. from the roster's `status`/`pid` fields — events win because the roster carries no started-at timestamp and `team.member.started` is the authoritative lifecycle signal cataloged for exactly this attribution (event-names.ts:114-122, supervisor-service.ts:227-230). (2) Reusing the ActivityTab SSE plumbing vs. a dedicated hook — reuse wins: the `toRow`/`prependActivityRow`/`buildRosterIndex` helpers (ActivityTab.tsx:25-65,85-119) are already exported and roster-aware, so SupervisorTab composes them rather than duplicating the EventSource setup. (3) Per-team controls (start/stop/up/down) inline vs. delegating to TerminalTab — inline controls with identical URLs and the mutate-then-`reload` pattern (TerminalTab.tsx:11-15,119-173) keep behaviour identical (R5) without forcing a tab switch; the Up/Down confirm modals are replicated for parity. The chosen path centralizes read state in `useTeamsData` + the shared event helpers and keeps mutation URLs identical to TerminalTab.

Invariants: tab ids `terminal`/`processes`/`messages`/`activity` are never renamed or reordered (id-stable contract); Supervisor gets id `supervisor`. The `useTeamsData` hook remains the single roster data layer — SupervisorTab consumes `{ teams, error, reload }` and must not introduce its own `fetch` of `/api/team/teams`. Event-derived activity (uptime, last activity) is kept visible when the roster feed errors (R7): the error is surfaced as a banner but the already-loaded event timeline and last-known teams remain rendered. A configured team with zero members renders an explicit empty-roster card rather than being omitted (R6). All event payloads are treated as untrusted and narrowed via the existing `toRow` guard (ActivityTab.tsx:85-119).

Impacted surfaces:
- apps/web/src/modules/teams/tabs.ts:15-20 — insert `{ id: 'supervisor', label: 'Supervisor', component: SupervisorTab }` as the first entry; extend the append-only note (tabs.ts:7,14) to record the Supervisor-first exception (R8).
- apps/web/src/modules/teams/TeamsShell.tsx:6 — default-active id `'supervisor'`.
- apps/web/src/modules/teams/SupervisorTab.tsx — new component: team cards, member rows, uptime/last-activity derivation, inline start/stop/up/down controls + confirm modals, empty-roster state, error-degraded state.
- apps/web/src/modules/teams/useTeamsData.ts — consumed unchanged (TeamGroup/TeamMember shapes at :7-24, result shape at :62-67).
- apps/web/src/modules/teams/ActivityTab.tsx — exported helpers (`buildRosterIndex`, `enrichRowFromRoster`, `toRow`, `prependActivityRow`, `MAX_ACTIVITY_ROWS`, `historyUrl`, `sseUrl`, `TEAM_EVENT_PREFIXES`) consumed unchanged.
- packages/app/src/services/team-service.ts:83-104 and supervisor-service.ts:51-56 — event payload contracts referenced (no change).
### Plan
1. **Create `SupervisorTab.tsx` skeleton** (apps/web/src/modules/teams/SupervisorTab.tsx): default export `SupervisorTab`, consume `useTeamsData()` for `{ teams, error, reload }`. Render a top-level scroll container with `data-supervisor-tab`. [R1, R2]

2. **Event state + live tail** (R4): inside `SupervisorTab`, mirror the ActivityTab pattern - `useState<ActivityRow[] | null>` for history, `useEffect` calling `fetchWithTimeout(historyUrl())` once, and an `EventSource(sseUrl())` effect that parses frames via the exported `toRow` and prepends via `prependActivityRow` (ActivityTab.tsx:147-176). Reuse `TEAM_EVENT_PREFIXES`, `historyUrl`, `sseUrl`, `toRow`, `prependActivityRow`, `MAX_ACTIVITY_ROWS` from ActivityTab.tsx. Keep a separate `eventError` state so event-feed failure does not clobber roster state. [R4]

3. **Per-member uptime + last-activity derivation** (R3): build a `useMemo` over the activity rows that, for each `(teamId, memberId)`, finds the most recent `team.member.started` row (start timestamp) and computes uptime as `now - occurredAt` when the member's roster `status === 'running'`; find the single newest row whose `teamId`/`memberLabel` matches for last-activity time + `eventName`. Use `buildRosterIndex` + `enrichRowFromRoster` (ActivityTab.tsx:25-55) so rows missing identity are joined from the live roster. Recompute on each roster poll and each live prepend. [R3]

4. **Team cards + member rows** (R2): map `teams` to one card per `TeamGroup`. Each card lists members with `id`, `type` (agent type), and `status` badge - `Badge variant="success"` for `running`, `variant="ghost"` otherwise, matching TerminalTab.tsx:257,292. Show the derived uptime and last-activity (time + event kind) per member; show `—` when no `team.member.started` event has arrived yet. [R2, R3]

5. **Empty-roster state** (R6): for a `TeamGroup` whose `members.length === 0`, render the card with an explicit `data-supervisor-empty-roster` block ("No members configured for this team") rather than skipping the card. [R6]

6. **Inline start/stop controls** (R5): replicate `toggleMemberStatus` from TerminalTab.tsx:119-144 - POST `startUrl(id)`/`stopUrl(id)` (TerminalTab.tsx:11-12), then `void reload()`. Render a Stop/Start `Button` per running/stopped member; gate with `actionPending`. Replicate the stop-confirm `Modal` (TerminalTab.tsx:336-373). [R5]

7. **Inline up/down controls** (R5): replicate `sendTeamAction` from TerminalTab.tsx:147-173 - POST `teamUpUrl(teamId)`/`teamDownUrl(teamId)` (TerminalTab.tsx:14-15), then `void reload()`. Render Up/Down buttons per team card; replicate the down-confirm `Modal` (TerminalTab.tsx:375-411). [R5]

8. **Error-degraded state** (R7): when `error` (roster) is set, render an error banner (`role="alert"`, `data-supervisor-roster-error`) but keep rendering the last-known `teams` and the live event-derived activity/uptime. Only show a full error replacement when `error && teams.length === 0` (mirroring TerminalTab.tsx:181-187). [R7]

9. **Register the tab** (R1, R8): in apps/web/src/modules/teams/tabs.ts, insert `{ id: 'supervisor', label: 'Supervisor', component: SupervisorTab }` as the first element of `TEAMS_TABS` (before `terminal`). Update the doc comment at tabs.ts:7,14 to record the exception: Supervisor is intentionally first despite the append-only ordering note, because it is the operational landing view; the other four ids remain stable and append-only. [R1, R8]

10. **Default-active tab** (R1): in apps/web/src/modules/teams/TeamsShell.tsx:6, change `useState<string>('terminal')` to `useState<string>('supervisor')`. Verify the `TEAMS_TABS.find` lookup (TeamsShell.tsx:7) still resolves and the tablist render (TeamsShell.tsx:17-37) maps Supervisor first. [R1, R18]

11. **Smoke verify** (R18-R24): open the Teams module in the browser - Supervisor is the first and active tab (R18); each team shows members with live status (R19); member rows show uptime + last activity (R20); trigger a start/stop and confirm the view updates without reload (R21); start/stop/up/down buttons work and refresh (R22); a configured empty team shows the empty-roster card (R23); kill the roster endpoint and confirm the error banner appears while event activity stays visible (R24).
### Solution
New `SupervisorTab` component inserted as the first and default-active Teams tab. Implementation reuses the ActivityTab event plumbing and the `useTeamsData` roster feed; no third polling implementation was introduced.

**Files changed (commit ba3ea3c5):**

1. **apps/web/src/modules/teams/SupervisorTab.tsx** (new, 458 lines) - the Supervisor tabview:
   - URL builders `startUrl`/`stopUrl`/`teamUpUrl`/`teamDownUrl` (SupervisorTab.tsx:17-20) mirror TerminalTab's patterns, POSTing to `/team/agents/:id/start|stop` and `/team/:teamId/up|down`.
   - `formatUptime(ms)` (SupervisorTab.tsx:31-40) renders human-readable uptime strings.
   - `deriveMemberStats(rows)` (SupervisorTab.tsx:61-88) builds a `Map<string, MemberStats>` keyed `${teamId}:${memberId}`. For each member it finds the most recent `team.member.started` row (start timestamp -> uptime when `status === 'running'`) and the single newest matching row for last-activity (time + event kind). Uses `buildRosterIndex` + `enrichRowFromRoster` from ActivityTab to join rows missing identity.
   - `SupervisorTab` (SupervisorTab.tsx:93-458): consumes `useTeamsData()` for `{ teams, error, reload }`. Fetches event history once via `fetchWithTimeout(historyUrl())` and tails live events via `EventSource(sseUrl())`, parsing frames with `toRow` and prepending via `prependActivityRow` (R4). Renders one card per `TeamGroup` with member rows showing id, agent type, status badge (`Badge variant="success"` for running, `variant="ghost"` otherwise - R2), uptime (SupervisorTab.tsx:329), and last-activity (SupervisorTab.tsx:337,344 - R3). Inline Start/Stop buttons per member (SupervisorTab.tsx:350-366, `data-supervisor-toggle`) with a stop-confirm `Modal` (SupervisorTab.tsx:382 - R5). Up/Down buttons per team card (SupervisorTab.tsx:275,286) with a down-confirm `Modal` (SupervisorTab.tsx:422 - R5). Empty-roster card (SupervisorTab.tsx:297, `data-supervisor-empty-roster`) for teams with zero members (R6). Error banner (SupervisorTab.tsx:219, `data-supervisor-tab-error`) when roster fetch fails, keeping event-derived activity visible (R7). All event payloads narrowed via `toRow` guard (R7/untrusted-input).

2. **apps/web/src/modules/teams/tabs.ts** (tabs.ts:17) - inserted `{ id: 'supervisor', label: 'Supervisor', component: SupervisorTab }` as the first `TEAMS_TABS` entry. Existing four tab ids (`terminal`, `processes`, `messages`, `activity`) remain unchanged in id and relative order. Doc comment updated to record the Supervisor-first exception against the append-only note (R8).

3. **apps/web/src/modules/teams/TeamsShell.tsx** (TeamsShell.tsx:6) - changed `useState<string>('terminal')` to `useState<string>('supervisor')` so Supervisor is the default-active tab (R1).

4. **apps/web/src/modules/teams/ActivityTab.tsx** - exported `buildRosterIndex` (ActivityTab.tsx:25), `enrichRowFromRoster` (ActivityTab.tsx:43), `toRow` (ActivityTab.tsx:85), `prependActivityRow` (ActivityTab.tsx:61), `MAX_ACTIVITY_ROWS` (ActivityTab.tsx:58), `historyUrl` (ActivityTab.tsx:67), `sseUrl` (ActivityTab.tsx:68), and `ActivityRow` interface (ActivityTab.tsx:6) for SupervisorTab consumption. No behavioral change to ActivityTab itself.

5. **apps/web/tests/modules/teams/components.test.tsx** - 11 new SupervisorTab tests covering R1-R7: Supervisor as default-active tab, team roster with member id/type/state, per-member uptime + last-activity, live SSE event reflection, Start/Stop/Up/Down controls with confirmation modals, error-degraded banner + empty-roster state, untrusted-input narrowing. Updated tab count assertion from 4 to 5.

6. **apps/web/tests/modules/teams/tabs.test.ts** (tabs.test.ts:26-30) - updated stable-order test from 4 v1 tabs to 5 tabs with `supervisor` first.

**Key decisions:**
- Uptime derived from `team.member.started` events rather than roster `status`/`pid` fields - events carry the authoritative start timestamp; the roster does not.
- Reused ActivityTab's exported SSE/fetch helpers rather than duplicating EventSource setup - single event-parsing path, roster-aware via `buildRosterIndex`.
- Inline controls (start/stop/up/down) with identical URLs and mutate-then-`reload()` pattern from TerminalTab - identical behavior, no delegation indirection.
- `Button variant="primary"` used for the Start button instead of a non-existent `success` variant (Button.tsx only supports primary/ghost/error/outline/accent/warning).
### Testing
**Commands run:**

1. `bun test apps/web/tests/modules/teams/components.test.tsx` - 46 pass, 0 fail, 234 expect() calls. Includes 11 new SupervisorTab tests covering R1-R7.
2. `bun test apps/web/tests/modules/teams/tabs.test.ts` - 5 pass, 0 fail. Updated stable-order test asserts 5 tabs with supervisor first.
3. `bun test apps/web/` - 594 pass, 0 fail, 1950 expect() calls across 32 files. No regressions.
4. `bun run lint` (biome check + typecheck) - clean across all 557 files. No type errors.
5. `bun test` (full monorepo) - 3939 pass, 0 fail, 12199 expect() calls across 231 files.

**Coverage (teams module):**
- tabs.ts: 100% lines
- useTeamsData.ts: 100% lines
- rpc-client.ts: 100% lines (improved from 66.67%/81.40% prior session)

**New tests (components.test.tsx):**
- R1: Supervisor is the default-active tab in TeamsShell (verifies `useState('supervisor')`)
- R2: Team roster renders member id, agent type, and running/stopped status badge
- R3: Per-member uptime and last-activity derived from events
- R4: Live SSE event updates last-activity without page reload
- R5: Start button POSTs start URL; Stop shows confirm modal then POSTs stop; Up POSTs team up; Down shows confirm modal then POSTs team down
- R6: Error-degraded banner when roster fetch fails; empty-roster card for team with zero members
- R7: Untrusted event payload narrowed via `toRow` without crashing
- Tab count updated from 4 to 5 in tabs.test.ts
### Review
| Priority | Finding | File:Line | Status |
|----------|---------|-----------|--------|
| P1 | None | - | - |
| P2 | `deriveMemberStats` recomputes over all rows on every render; acceptable for MAX_ACTIVITY_ROWS=100 but could memoize the filter | SupervisorTab.tsx:61-88 | Accepted |
| P3 | `formatUptime` does not guard against negative uptime (clock skew); shows "-" which is acceptable | SupervisorTab.tsx:31-40 | Accepted |
| P4 | Stop/Down confirmation modals reuse `data-stop-confirm-modal`/`data-down-confirm-modal` attributes from TerminalTab pattern; no collision since only one modal renders at a time per tab | SupervisorTab.tsx:382,422 | Accepted |

**SECUA dimensions:**

- **Security**: All event payloads from SSE and history fetch are narrowed through the existing `toRow` guard (ActivityTab.tsx:85-119) which validates field types before use. No `dangerouslySetInnerHTML`. Mutation URLs use `encodeURIComponent` on all path parameters (SupervisorTab.tsx:17-20). Untrusted input does not reach `innerHTML` or `eval`.
- **Correctness**: Uptime derived from `team.member.started` events matches the authoritative lifecycle signal. `deriveMemberStats` correctly keys by `${teamId}:${memberId}` matching the roster index. Status badge uses `variant="success"` for running and `variant="ghost"` for stopped, consistent with TerminalTab.tsx:257,292. `Button variant="primary"` used instead of non-existent `success` variant.
- **Usability**: Supervisor is the first and default-active tab (R1). Empty-roster state explicitly rendered (R6). Error-degraded banner keeps event activity visible (R7). Confirmation modals on destructive actions (stop, down) match TerminalTab UX.
- **Architecture**: Reuses `useTeamsData` as the single roster data layer (R8) - no third polling implementation. Reuses ActivityTab's exported helpers (`buildRosterIndex`, `enrichRowFromRoster`, `toRow`, `prependActivityRow`, `historyUrl`, `sseUrl`) rather than duplicating EventSource setup. Tab-ordering exception documented in tabs.ts per R8. Existing four tab ids remain id-stable.

**Residual risk:** Low. The Supervisor-first tab ordering is a deliberate exception to the append-only note, documented in tabs.ts. No behavioral change to existing tabs. All 594 web tests pass with no regressions.

**Final disposition:** PASS - all requirements R1-R8 satisfied, all acceptance criteria met, no P1/P2 blockers.
### References

J4

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-29T18:39:03.867Z todo → wip (system)
- 2026-07-29T18:51:31.139Z wip → testing (system)
- 2026-07-29T18:52:31.902Z testing → done (system)
### Notes

Verdict: PASS

Requirements: R1 MET, R2 MET, R3 MET, R4 MET, R5 MET, R6 MET, R7 MET, R8 MET

Acceptance Criteria: R18 MET, R19 MET, R20 MET, R21 MET, R22 MET, R23 MET, R24 MET

Checks: spur task check PASS, tests PASS (3939 pass, 0 fail), lint PASS (biome + tsc clean)

Verdict artifact: .spur/run/0378-verdict.json

