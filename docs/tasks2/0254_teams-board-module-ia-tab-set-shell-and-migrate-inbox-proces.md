---
template: feature-impl
schema_version: 1
name: "Teams Board module IA: tab set + shell, and migrate Inbox/Process tabs out of Observability"
description: ""
status: todo
type: task
profile: standard
feature_id: M
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-14T04:29:07.281Z"
updated_at: "2026-07-14T06:45:20.633Z"
---

## 0254. Teams Board module IA: tab set + shell, and migrate Inbox/Process tabs out of Observability

### Background
**Implementation ticket** (feature M) — refined for delegation; the integrating front-end ticket.

**Decided (DD-4):** a **new auto-discovered `Teams` board module** + **move** the Inbox + Process tabs
OUT of Observability into it. Observability keeps system-wide telemetry (system events, jobs,
tool-using). Confirmed tab set: **Roster · Terminal · Messages · Activity**. Reuses the existing
board conventions: `WebModule` auto-discovery (`apps/web/src/modules/discover.ts`, `import.meta.glob`)
and the tab-as-data array (`observability/tabs.ts` — append-only, id-stable). **No new deps**; raw
`fetch` + `EventSource` per 0256.

**Consumes:** 0256 routes (`GET /api/team/teams`, `up`/`down`, existing start/stop) and embeds 0255's
`MemberTerminal`. Reuses the `InboxTab` fetch+EventSource pattern for the Messages tab and the
`SystemEventsTab` feed for Activity.

**Implement AFTER 0256 (routes) and 0255 (MemberTerminal)** — this ticket wires them together.
### Requirements
R1. New `apps/web/src/modules/teams/` module: `index.tsx` exporting a `WebModule` (`id:'teams', route:'teams', sidebarLabel:'Teams'`), a `TeamsShell` mapping over a `tabs.ts` data array — mirroring `observability/`.
R2. Four v1 tabs (data array, stable ids): **Roster**, **Terminal**, **Messages**, **Activity**.
R3. **Roster** tab: teams → members with status (`running|stopped|errored|exited`) from `GET /api/team/teams`; per-member start/stop + per-team up/down controls calling 0256; selecting a member sets shared selection state.
R4. Shared selection (`TeamsContext` or a small store): the selected teamId/memberId drives the Terminal + Messages tabs.
R5. **Terminal** tab: renders 0255 `MemberTerminal` for the selected member (empty state when none selected).
R6. **Messages** tab: selected member's inbox + a dispatch composer (`POST /api/messages`) + the global feed; live-invalidated via `EventSource` (InboxTab pattern).
R7. **Activity** tab: agent-lifecycle + message-event timeline (adapt `SystemEventsTab`, filtered to team/message events).
R8. **Migrate** the Inbox + Process tabs out of `observability/tabs.ts` into the Teams module, keeping their ids stable (append-only contract: re-parent, do not rename); remove them from Observability, which retains system-events/jobs/tool-using. Update observability tests for the removed tabs.
### Acceptance Criteria
Testable checklist:

- **AC1** A `Teams` entry appears in the board sidebar (auto-discovered via `discover.ts`) at route `teams`; `TeamsShell` renders exactly the 4 tabs from `tabs.ts`. (test: render shell, assert tab labels/ids.)
- **AC2** Roster lists teams from `GET /api/team/teams` with per-member status + start/stop + per-team up/down buttons wired to 0256 endpoints. (test: mock fetch, assert render + a button POSTs the right URL.)
- **AC3** Selecting a member updates `TeamsContext`; the Terminal tab then renders `MemberTerminal` for that member and the Messages tab shows that member's inbox + composer. (test: select → assert context + downstream props.)
- **AC4** Observability no longer lists the Inbox or Process tabs; the Teams module lists them (same stable ids); Observability still lists system-events, jobs, tool-using. (test: assert both modules' `tabs.ts` arrays.)
- **AC5** The Messages composer POSTs `/api/messages` and the inbox live-updates on a `message.*` EventSource event (InboxTab pattern). (test: mock fetch + EventSource.)
- **AC6** No new dependency added to `apps/web/package.json`; no dead imports left in observability after the migration.
- **AC7** `bun run lint` + `bun run test` green, including updated observability tests.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Module scaffold** mirrors `apps/web/src/modules/observability/{index.tsx, tabs.ts, *Shell}`.
`TeamsShell` maps over `TEAMS_TABS` (data array, append-only/id-stable). Shared selection via a
`TeamsContext` (`{ selectedTeamId, selectedMemberId, select() }`).

**Tab components** (`apps/web/src/modules/teams/`):
- `RosterTab.tsx` — new; `GET /api/team/teams` (poll + EventSource-invalidate); start/stop/up/down controls (0256).
- `TerminalTab.tsx` — wraps 0255 `MemberTerminal` for `selectedMemberId` (empty state otherwise).
- `MessagesTab.tsx` — adapt `observability/InboxTab.tsx` (agent = selected member) + a send composer.
- `ActivityTab.tsx` — adapt `observability/SystemEventsTab.tsx`, filtered to team/message events.

**Migration:** move `InboxTab.tsx` + `ProcessListTab.tsx` into `teams/` (or re-export from there), remove
their entries from `observability/tabs.ts`, add them to `teams/tabs.ts` with the **same ids** (append-only
contract). Update `apps/web/tests/modules/observability/*` for the removed tabs.

**Grounding:** `apps/web/src/modules/observability/{index.tsx, tabs.ts, InboxTab.tsx, ProcessListTab.tsx,
SystemEventsTab.tsx}`, `apps/web/src/modules/discover.ts`, `apps/web/src/modules/types.ts` (`WebModule`).

**Confidence:** module + tab-as-data mirror **HIGH** (direct copy of observability); the tab migration
without breaking the append-only id contract **MEDIUM**; shared-selection wiring **MEDIUM**.

**Files:** `apps/web/src/modules/teams/{index.tsx, tabs.ts, TeamsShell.tsx, TeamsContext.tsx, RosterTab.tsx,
TerminalTab.tsx, MessagesTab.tsx, ActivityTab.tsx}`; edits to `observability/tabs.ts` + observability tests;
`apps/web/tests/modules/teams/*`.
### Plan
1. Scaffold `teams/` module: `index.tsx` (`WebModule`), `TeamsShell.tsx`, `tabs.ts` — mirror observability.
2. `TeamsContext.tsx` (selected team/member) + provider in the shell.
3. `RosterTab.tsx` against `GET /api/team/teams` + start/stop/up/down controls (0256); wire selection.
4. `TerminalTab.tsx` wrapping 0255 `MemberTerminal` for the selected member.
5. `MessagesTab.tsx` (adapt InboxTab + composer) and `ActivityTab.tsx` (adapt SystemEventsTab).
6. Migrate Inbox + Process tabs out of `observability/tabs.ts` (stable ids) into `teams/tabs.ts`; update observability tests.
7. Tests: shell renders 4 tabs, roster fetch+controls, selection→terminal/messages, migration assertions; `bun run lint && bun run test`.

**Depends on:** 0256 (routes) + 0255 (`MemberTerminal`). Implement last.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

M

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
