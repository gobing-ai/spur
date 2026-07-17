---
template: feature-impl
schema_version: 1
name: "Fine-tune Teams module UI and supporting APIs"
description: ""
status: todo
type: task
profile: standard
feature_id: M3
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-16T18:17:31.146Z"
updated_at: "2026-07-16T18:19:11.249Z"
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature map: [M3](../features/M3_teams-board-continuous-ux-fine-tune-terminal-centric-controls.md)
- Prior: M1, M2 (0265–0268 residual polish)
- Key code: `apps/web/src/modules/teams/*`, `apps/server/src/modules/team/index.ts`, `apps/server/src/modules/messages/index.ts`, `packages/app/src/services/event-names.ts`, `packages/app/src/services/supervisor-service.ts`, `packages/app/src/services/team-service.ts`
### History
