---
doc: design/workspace
feature_id: G3
owns: SURFACE + mechanism for team-scoped Board composition
authority: derived (ADR wins on conflict)
updated_at: 2026-08-11
---

# Workspace Board module — team-scoped composition

ADR-052 defines the v1 boundary: an existing Team is the workspace context. G3 adds a Board
composition view, not a second domain entity.

## 1. Identity and scope

| Workspace concern | Existing authority |
| --- | --- |
| id | `teamId` under `agent.team` |
| display name | `agent.team.<teamId>.name` |
| git folder | `agent.team.<teamId>.work_dir` |
| roster | `agent.team.<teamId>.members` and materialized agent specs |
| message scope | endpoints whose resolved identity has the selected `teamId` |
| task scope | tasks resolved from the selected team's `work_dir` project |

No `workspaces` config key, WorkspaceService, workspace DTO/table, `/api/workspaces` route, or
`spur workspace` noun is added.

## 2. Module ownership

| Module | Owns | Must not own |
| --- | --- | --- |
| Teams | roster, up/down, start/stop, processes, terminal stdin/stdout, lifecycle activity | durable message history |
| Inbox | durable All/Supervisor/member message history and delivery state | process streams, terminal I/O, lifecycle controls |
| Workspace | selected `teamId`, overview, and composition of scoped Team/Inbox/Tasks views | message delivery, process management, duplicate roster/folder state |

## 3. Board surface

The auto-discovered `workspace` module has four tabs:

| Tab | Reused view | Scope |
| --- | --- | --- |
| Overview | compact team identity/status summary | selected `teamId` |
| Team | Teams operational view | selected `teamId` |
| Inbox | Inbox durable-message view | selected `teamId` |
| Tasks | Task Kanban | selected team's project/work folder |

Global Teams and Inbox modules remain. Workspace passes optional scope props into reusable views;
it does not change the `WebModule` registry contract.

## 4. Implementation seams

- Move `useTeamsData` from the Teams module to a neutral web data location because Teams, Inbox,
  and Workspace consume the same team feed.
- Give Team and Inbox views an optional `teamId`; omission preserves their global behavior.
- Remove Inbox `AgentTab` frame streaming and `timeline.ts`; retain durable per-agent message filters.
- Reuse `GET /api/team/teams`, `GET /api/messages`, and existing task APIs. Filter in the client for
  v1 because the feeds already carry team/member identity and current data bounds are small.
- Keep message send/drain semantics unchanged; Workspace scope is a Board read/composition boundary,
  not a new delivery authorization model.

## 5. Verification contract

- Inbox opens no process `EventSource` and renders no stdout/stderr rows.
- Teams retains terminal/process/activity behavior and resource teardown coverage.
- Workspace renders Team, Inbox, and Tasks with one selected `teamId`; switching scope updates all
  composed views without changing global module defaults.
- No workspace schema/API/CLI artifacts exist.

## 6. Non-goals

Multiple teams per workspace, cross-workspace messaging policy, workspace CRUD, remote workspaces,
permissions, and concurrent multi-workspace scheduling.
