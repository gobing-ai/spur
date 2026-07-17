---
template: feature-impl
schema_version: 1
name: "Fine-tune Teams module UI and supporting APIs"
description: ""
status: done
type: task
profile: standard
feature_id: M3
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-16T18:17:31.146Z"
updated_at: "2026-07-16T23:58:14.423Z"
---

## 0269. Fine-tune Teams module UI and supporting APIs

### Background
Post-M1/M2 review of the Teams board found duplicated team controls, a shared strip that implies selection on global observation tabs, Process row actions that do not apply to non-team registry processes, and Message/Activity feeds that lack team·member·agent identity. Discovery (2026-07-16, `/sp:dev-brainstorm --wayfind`) verified the current code and locked a Terminal-centric design with supporting API enrichment.

**Verified baseline**
- `TeamsShell` mounts `TeamControlStrip` above all tabs (team select + Up/Down + confirm on Down).
- `TerminalTab` has a second team/member toolbar with status in member options and Start/Stop + confirm.
- `ProcessesTab` merges supervisor + ProcessExecutor registry but still shows Attach/Start/Stop on supervised rows.
- `MessagesTab` already uses global `GET /api/messages` but cards only show `from → to` + body; `status` and `inReplyTo` are unused for UX.
- `ActivityTab` filters `agent.|message.|team.|supervisor.` and **omits** catalogued `process.*` events.
- `GET /api/team/teams` does not return optional `model` (present on config/spec).

**Map:** feature [M3](../features/M3_teams-board-continuous-ux-fine-tune-terminal-centric-controls.md) — implement this single comprehensive task next.
### Requirements
R1. Remove the shared `TeamControlStrip` from `TeamsShell` so Process / Message / Activity have no team control chrome.
R2. Rebuild Terminal as a single toolbar with left area (team select, member select, optional model field when present, status badge, Start/Stop for focused member) and right area (per-member status chips with tooltips, Up/Down), left-aligned vs right-aligned with a visual separator.
R3. Member dropdown option text is `{member label} · {agent type}` only — no status in the option string.
R4. Right-area status chips are clickable and set the focused member (same effect as the Member dropdown).
R5. Process tab remains a system-wide watch list (supervisor + registry) with existing filters; remove the Actions column and all Attach/Start/Stop row controls.
R6. Changing team/member selection in Terminal detaches the previous member stream and attaches the newly selected member (`MemberTerminal`); Process no longer provides Attach.
R7. Destructive confirms with Cancel as safe default: focused-member Stop and team Down only (Start/Up remain one-click).
R8. Message tab stays a global feed; each card shows team name, member label, and coding-agent type for from/to when resolvable; delivery chip for `queued`/`injected`; reply badge `Replied` vs `Awaiting reply` from `in_reply_to` relationships.
R9. Activity tab shows all-team activity including `agent.*`, `message.*`, `team.*`, `supervisor.*`, and `process.*`; table columns include Time, Event, Team, Member, Agent, Actor (raw/fallback).
R10. Tab labels: `Processes` → `Process`, `Messages` → `Message` (`tabs.ts` + tests).
R11. Backend: extend `GET /api/team/teams` members with optional `model` (omit when unset); extend `GET /api/messages` (and listRecent mapping) with identity fields + `hasReply`/`replyCount` (or equivalent) so the UI does not invent delivery vs reply semantics.
R12. Update `useTeamsData` / web types and tests; remove or hollow dead Attach producers after Process Attach UI removal; keep confirms covered by tests.
R13. No regression of Terminal localStorage last-selection restore or team empty/error states.
### Acceptance Criteria
```gherkin
@core
Scenario: Shared team control strip is gone from non-Terminal tabs
  Given the Teams board is open
  When the operator switches among Process, Message, and Activity
  Then no team-select / Up / Down control strip is rendered above those tabs
  And those controls appear only on the Terminal tab toolbar

@core
Scenario: Terminal toolbar splits focus left and roster right
  Given a configured team with at least two members
  When the operator opens Terminal and selects a team
  Then the left area shows team select, member select without status text, optional model when present, status badge, and Start/Stop
  And the right area shows one status chip per member plus Up and Down
  And clicking a roster chip focuses that member

@core
Scenario: Process tab is a read-only system watch list
  Given supervised and registry processes exist
  When the operator opens Process
  Then rows list processes across the system with filters available
  And no Attach, Start, or Stop button appears on any row

@core
Scenario: Destructive stops require confirm with Cancel default
  Given a running focused member
  When the operator clicks Stop
  Then a confirm modal appears with Cancel as the safe default
  And team Down uses the same Cancel-default pattern

@core
Scenario: Message cards show identity, delivery, and reply state
  Given messages exist across multiple teams
  When the operator opens Message
  Then each card shows team, member, and coding-agent identity when known
  And each card shows a delivery chip and a Replied or Awaiting reply badge

@core
Scenario: Activity includes process lifecycle and identity columns
  Given agent, message, and process events have occurred
  When the operator opens Activity
  Then process.* lifecycle events appear when present
  And rows show team, member, and agent identity when resolvable

@core
Scenario: Tab labels use singular Process and Message
  Given the Teams shell tab list
  When rendered
  Then the second tab is labeled Process and the third Message

@edge
Scenario: Model field is hidden when unspecified
  Given a focused member whose model is not set
  When Terminal toolbar renders
  Then no empty model field is shown
```
### Q&A
**Q1. Remove toolbar on all four tabs vs keep Terminal toolbar?**  
A1. Remove only the shared shell `TeamControlStrip`. Terminal keeps (and becomes) the sole control surface. (D1)

**Q2. Should Process keep Attach for convenience?**  
A2. No — read-only Process; Terminal selection is attach. (D3)

**Q3. How to show “message got a response”?**  
A3. Dual signal: delivery chip (`queued`/`injected`) is pipeline state; reply badge uses `in_reply_to` children (`Replied` / `Awaiting reply`). Do not overload delivery status as reply. (D5)

**Q4. Are process start/stop events available?**  
A4. Yes in the system-event catalog: `process.spawned`, `process.exited`, `process.stopped`, `process.started`. Activity must include the `process.` prefix. (D6)

**Q5. Client-only join vs API enrichment?**  
A5. Extend existing endpoints for model + message identity/reply signals; UI may still fall back to `useTeamsData` for joins. (D7)

**Q6. Packaging?**  
A6. Wayfind map M3 + this single comprehensive task 0269. (D8)
### Design
**Approach: Terminal-centric chrome + observation tabs + thin API enrichments**

**Shell**
- `TeamsShell.tsx`: drop `<TeamControlStrip />`.
- Move Up/Down into Terminal then delete orphaned `TeamControlStrip.tsx`.
- Audit `ATTACH_EVENT` shell listener once Process no longer fires attach.

**Terminal toolbar layout**
- Replace `data-terminal-toolbar` with a flex row (`justify-between` or spacer).
- **Left (`data-terminal-focus`):** Team Select → Member Select → optional model text (`data-terminal-model`, only if `currentMember.model`) → status Badge → Start/Stop + existing stop Modal.
- **Right (`data-terminal-roster`):** one status chip per member (tooltip `{id} · {type}`); click sets `memberId`; then Up/Down + Down confirm Modal (from former TeamControlStrip).
- Separator: vertical border or muted divider between areas.
- Member options: `{m.id} · {m.type}` only (no status).

**Process read-only**
- Remove Actions column and Attach/Start/Stop handlers.
- Keep `buildWatchRows` / filters / team column; simplify `canControl`/`canAttach` if unused by UI.
- Empty copy can point operators to Terminal to start agents.

**Message cards**
- Prefer enriched fields: from/to team name, member label, agent type, `hasReply`/`replyCount`.
- Delivery chip from status `queued`|`injected`; reply badge from `in_reply_to` graph (not from delivery status).
- Fallback: raw ids when enrichment missing.

**Activity**
- Add `'process.'` to `TEAM_EVENT_PREFIXES`.
- Columns: Time | Event | Team | Member | Agent | Actor.
- Resolve identity from payload when present, else join actor id via teams roster.

**Backend**
- `GET /api/team/teams`: optional `model` from agent spec when defined.
- Messages `listRecent`: identity join + reply signals; document limit-window semantics if reply count is window-scoped.
- Process event emit sites: verify payload fields; UI fallback OK for v1 if `teamId` missing.

**Tests**
- Web: strip removal, toolbar selectors, Process no-actions, tab labels, Message badges, Activity process prefix.
- Server/app: teams DTO model; messages enrichment.
### Plan
1. Extend `GET /api/team/teams` with optional `model`; update `useTeamsData` parse + types; tests.
2. Extend messages listRecent/API with identity + reply signals; tests.
3. Terminal: merge TeamControlStrip Up/Down into Terminal toolbar; implement left/right layout, chip click, model field, member option text; remove shell strip; tests.
4. Process: remove Actions/Attach/Start/Stop; keep filters + system-wide list; clean attach-bus producers; tests.
5. Message tab UI: identity + delivery + reply badges; tests.
6. Activity: add `process.*`, identity columns, resolve helpers; tests.
7. Tab label wording Process/Message + snapshot/unit updates.
8. Confirm-modal audit (Stop + Down only, Cancel default); full teams web suite + relevant server tests green.
9. `spur task check 0269`; feature refresh M3.
### Solution
## Solution — 0269 Fine-tune Teams module UI and supporting APIs

**Change map**

| File:line | Change | Why |
|-----------|--------|-----|
| `apps/server/src/modules/team/index.ts:236-239` | Surface `model` from spec.config when defined; omit when unset | R11 — optional model field |
| `apps/server/tests/modules/messages/index.test.ts:127-129` | Expect `to`, `hasReply`, `replyCount` in feed response | R11 — tests |
| `packages/domain/src/dao/inbox-recent-dao.ts:43-76` | Add `countReplies(ids)` method | R11 — reply signals |
| `packages/domain/tests/dao/inbox-recent-dao.test.ts:86-130` | Tests for `countReplies` | R11 — coverage |
| `packages/app/src/services/team-service.ts:99-137` | Add `MessageEndpointIdentity`, `RecentMessageRow` types | R8, R11 |
| `packages/app/src/services/team-service.ts:291-357` | Rewrite `listRecent()` with identity join + reply counts | R8, R11 — backend enrichments |
| `packages/app/src/index.ts:173-174` | Export `MessageEndpointIdentity`, `RecentMessageRow` | Public surface |
| `packages/app/tests/services/team-service.test.ts:266-350` | Tests for identity/reply fields | R8, R11 coverage |
| `apps/web/src/modules/teams/useTeamsData.ts:12,46-48` | Parse optional `model` field | R11 web |
| `apps/web/src/modules/teams/tabs.ts:17-18` | Labels: `Processes`→`Process`, `Messages`→`Message` | R10 |
| `apps/web/src/modules/teams/TeamsShell.tsx:1-4` | Remove `TeamControlStrip`/`ATTACH_EVENT` imports | R1, R6 |
| `apps/web/src/modules/teams/TeamsShell.tsx:50` | Remove `<TeamControlStrip />` render | R1 |
| `apps/web/src/modules/teams/TeamControlStrip.tsx` | **Deleted** — up/down merged into Terminal | R1, R3 |
| `apps/web/src/modules/teams/attach-bus.ts` | **Deleted** — no more cross-tab attach | R4, R6 |
| `apps/web/src/modules/teams/TerminalTab.tsx:1-3` | Add `fetchWithTimeout`/`resolveApiUrl` imports | Needed after attach-bus removal |
| `apps/web/src/modules/teams/TerminalTab.tsx:14-15` | Add `teamUpUrl`, `teamDownUrl` | R3 |
| `apps/web/src/modules/teams/TerminalTab.tsx:80` | Add `confirmDownFor` state | R7 destructive confirms |
| `apps/web/src/modules/teams/TerminalTab.tsx:147-176` | Add `sendTeamAction`, `handleChipClick` callbacks | R3, R4 |
| `apps/web/src/modules/teams/TerminalTab.tsx:199-319` | Rebuild toolbar: left focus + right roster layout | R2, R3, R4 |
| `apps/web/src/modules/teams/TerminalTab.tsx:373-410` | Down confirm modal (Cancel default) | R7 |
| `apps/web/src/modules/teams/ProcessesTab.tsx:2-3` | Remove `Button`, `requestAttach` imports | R5 |
| `apps/web/src/modules/teams/ProcessesTab.tsx:57-58,220,268-288` | Remove `startUrl`/`stopUrl`/`actionPending`/`toggleStatus` dead code | R5 |
| `apps/web/src/modules/teams/ProcessesTab.tsx:393,420-446` | Remove Actions column header + row td | R5 |
| `apps/web/src/modules/teams/MessagesTab.tsx:4-23` | Add `MsgEndpoint`, `RecentMessageRow` types | R8 |
| `apps/web/src/modules/teams/MessagesTab.tsx:105-148` | Enrich card: identity, delivery chip, reply badge | R8 |
| `apps/web/src/modules/teams/ActivityTab.tsx:5-14,21,34-48,121-138` | Add `process.` prefix, identity columns, payload parsing | R9 |
| `apps/web/tests/modules/teams/attach-bus.test.ts` | **Deleted** | Cleanup |
| `apps/web/tests/modules/teams/components.test.tsx:189,243-244,306-308,670-673,500-512` | Updated assertions for all behavioral changes | Test alignment |

**Verification**
```bash
bun run test  # 2902 pass, 0 fail across 197 files
cd apps/web && bun run tsc --noEmit  # clean
cd packages/app && bun run tsc --noEmit  # clean
```
### Testing
**Verify run:** 2026-07-16 `/sp-dev-verify 0269 --auto --next --focus all --fix all --force`

**Commands run (this verify):**
- `bun test apps/web/tests/modules/teams packages/app/tests/services/team-service.test.ts packages/domain/tests/dao/inbox-recent-dao.test.ts apps/server/tests/modules/messages` — **145 pass, 0 fail**, 531 expect()
- Static: `TeamControlStrip.tsx` deleted; `attach-bus.ts` deleted; tab labels Process/Message; no Process row attach buttons in UI
- `cd apps/web && bun run tsc --noEmit` — clean

**Coverage:** N/A for monorepo aggregate this run. Scoped evidence: domain `inbox-recent-dao` 100% lines/functions; app `team-service` ~97% lines in this suite; web teams component suite includes new 0269 cases.

**Fix pass (`--fix all`):**
1. MessagesTab reply badge always shows Replied vs Awaiting reply from `hasReply` (was wrongly gated on `inReplyTo`).
2. ActivityTab roster fallback via `useTeamsData` + `buildRosterIndex` / `enrichRowFromRoster`.
3. Tests: shell strip absent, Terminal left/right+chips+model edge, Message identity/delivery/reply, Activity process.* + identity helpers.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 Remove shell TeamControlStrip | MET | `TeamsShell.tsx` no strip; test shell has no `[data-team-control-strip]`; file deleted |
| R2 Terminal left/right toolbar | MET | `TerminalTab.tsx` `data-terminal-focus` + `data-terminal-roster` + `justify-between`; component test |
| R3 Member options id · type only | MET | `TerminalTab.tsx` options `{id} · {type}`; test asserts no `running` in options |
| R4 Clickable roster chips | MET | chips call `handleChipClick`; test clicks chip → member select = coder |
| R5 Process read-only | MET | no Actions column; tests expect 0 attach/toggle buttons |
| R6 Terminal selection attaches | MET | `MemberTerminal` keyed by `memberId`; attach-bus deleted; Process no Attach |
| R7 Confirm Stop + Down | MET | stop + down modals with Cancel; existing stop modal test |
| R8 Message identity + delivery + reply | MET | enriched API fields + UI badges; message tests for Awaiting/Replied + delivery |
| R9 Activity process.* + identity cols | MET | `process.` prefix; Team/Member/Agent columns; roster enrich helpers + tests |
| R10 Tab labels Process/Message | MET | `tabs.ts`; shell tab labels test |
| R11 Backend model + messages enrich | MET | `team/index.ts` model; `listRecent` identity + `countReplies`; app/domain/server tests |
| R12 useTeamsData + tests + dead attach cleanup | MET | model parse; attach-bus deleted; tests updated |
| R13 localStorage restore no regression | MET | existing Terminal restore/persist/stale tests still green |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: Shared team control strip is gone from non-Terminal tabs | MET | test | TeamsShell no `[data-team-control-strip]`; Up/Down on Terminal only |
| Scenario: Terminal toolbar splits focus left and roster right | MET | test | focus/roster/chips/up/down assertions + chip click selects member |
| Scenario: Process tab is a read-only system watch list | MET | test | 0 attach/toggle buttons; filters remain |
| Scenario: Destructive stops require confirm with Cancel default | MET | test | stop modal test; Down modal present in TerminalTab |
| Scenario: Message cards show identity, delivery, and reply state | MET | test | identity/delivery/reply badge tests |
| Scenario: Activity includes process lifecycle and identity columns | MET | test | process.spawned rendered; identity columns + roster enrich unit test |
| Scenario: Tab labels use singular Process and Message | MET | test | shell tabs labels Terminal/Process/Message/Activity |
| Scenario: Model field is hidden when unspecified | MET | test | model shown for sonnet member; null for member without model |

**Design conformance**

| Claim | Status | Notes |
|-------|--------|-------|
| Drop TeamControlStrip; Up/Down in Terminal | DONE | |
| Left focus / right roster layout | DONE | separator is border-l before Up/Down |
| Process read-only | DONE | |
| Message identity + delivery + reply | DONE | fixed badge logic this verify |
| Activity process.* + identity | DONE | payload + roster fallback this verify |
| Backend teams model + messages enrich | DONE | |
### Review
**Review run:** 2026-07-16 `/sp-dev-review 0269` + residual cleanup pass

**Disposition:** PASS — all review residuals fixed (P1–P4).

**Scope:** Teams module continuous UX fine-tune (Terminal-centric chrome, read-only Process, identity-rich Message/Activity, API enrichment).

**Priority findings**

| Pri | Location | Finding | Resolution |
| --- | -------- | ------- | ---------- |
| P1 | — | None | — |
| P2 | `MessagesTab.tsx` load path | Untrusted JSON was cast to `MsgRow[]`; missing `to` / reply fields could throw at render | **Fixed:** `parseMessagesFeed` + `parseEndpoint` runtime narrow; unit test defaults missing fields |
| P2 | `ProcessesTab.tsx` `WatchRow` | Dead `canControl` / `canAttach` fields after row actions removed (0269 R5) | **Fixed:** fields removed from interface and `buildWatchRows` |
| P3 | `team-service.ts` `listRecent` docs | JSDoc claimed window-scoped reply counts; SQL counts all children of window parents | **Fixed:** docs aligned with `countReplies` behavior |
| P4 | `ActivityTab` / supervisor payloads | Identity best-effort when actor ≠ agentId and process events lacked teamId | **Fixed:** `ProcessEventPayload` stamps `teamId` + `agentType`; `extractSystemEventActor` falls back to `agentId`; `toRow` maps payload identity; roster enrich uses memberLabel/agentId |
| P4 | `ActivityTab.tsx` SSE | Unbounded prepend of live rows on long sessions | **Fixed:** `prependActivityRow` caps at `MAX_ACTIVITY_ROWS` (100, matches history limit) |

**Functional traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `TeamsShell.tsx` — no TeamControlStrip; file deleted |
| R2 | MET | `TerminalTab.tsx` left focus / right roster |
| R3 | MET | Member options `{id} · {type}` |
| R4 | MET | Roster chips set focused member |
| R5 | MET | Process table has no Actions; dead flags removed |
| R6 | MET | `MemberTerminal` by `memberId`; attach-bus deleted |
| R7 | MET | Stop + Down modals with Cancel |
| R8 | MET | Message cards + `listRecent` identity/reply + feed parse |
| R9 | MET | `process.` prefix; payload + roster identity |
| R10 | MET | `tabs.ts` Process / Message |
| R11 | MET | teams `model` field; `countReplies` + identity join |
| R12 | MET | useTeamsData model parse; tests updated |
| R13 | MET | localStorage restore path + tests green |

**Functional Verdict: PASS**

**SECUA summary:** S — no secrets/injection; E — reply-count query + capped Activity buffer; C — feed narrow + process identity stamps; U — docs fixed; A — Terminal owns lifecycle, dead attach surface removed.

**Residual risk:** None open for 0269 scope.

**Re-test (residual cleanup):** `bun test apps/web/tests/modules/teams packages/app/tests/services/supervisor-service.test.ts` (+ system-events wiring) → green.

**Final disposition:** **PASS**
### References
- Feature map: [M3](../features/M3_teams-board-continuous-ux-fine-tune-terminal-centric-controls.md)
- Prior: M1, M2 (0265–0268 residual polish)
- Key code: `apps/web/src/modules/teams/*`, `apps/server/src/modules/team/index.ts`, `apps/server/src/modules/messages/index.ts`, `packages/app/src/services/event-names.ts`, `packages/app/src/services/supervisor-service.ts`, `packages/app/src/services/team-service.ts`
### History
- 2026-07-16T21:42:51.836Z todo → wip (system)
- 2026-07-16T21:43:41.014Z wip → testing (system)
- 2026-07-16T22:01:25.355Z testing → done (system)
