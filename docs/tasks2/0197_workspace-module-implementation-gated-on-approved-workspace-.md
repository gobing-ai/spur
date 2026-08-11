---
template: feature-impl
schema_version: 1
name: Workspace module implementation (gated on approved workspace design)
description: ""
status: wip
type: task
profile: standard
feature_id: G3
parent_wbs: null
priority: P3
tags: [approach-c,collaboration,board,gated]
dependencies: []
created_at: 2026-07-03T23:35:28.260Z
updated_at: "2026-08-11T23:13:04.592Z"
---

## 0197. Workspace module implementation (gated on approved workspace design)

### Background
Task 0197 implements feature G3 after the 2026-08-11 boundary review superseded the original standalone
Workspace design. The shipped Board currently overlaps: Teams owns Supervisor, Terminal, Process, and Activity,
while Inbox member tabs also open the process SSE stream and merge stdout/stderr with durable messages.

ADR-052 resolves the boundary and removes a second duplication. `agent.team.<teamId>` already owns `name`,
`work_dir`, and `members`, so G3 uses Team as the v1 workspace context instead of adding a second roster/folder
schema. The task is a Board composition and boundary-cleanup change over existing services.

Current-tree anchors:

- `packages/config/src/index.ts` — `TeamConfigSchema` owns `name`, `work_dir`, and `members`.
- `apps/web/src/modules/teams/tabs.ts` — Teams operational tabs.
- `apps/web/src/modules/inbox/AgentTab.tsx` — overlapping process stream to remove.
- `apps/server/src/modules/team/index.ts` — existing team roster/status response to extend.
- `docs/design/workspace-design.md` and ADR-052 — target contract.
### Requirements
- [ ] **R1 — Separate module ownership.** Inbox renders durable `inbox_messages` only; Teams exclusively renders
      roster, process lifecycle, terminal stdin/stdout, and team lifecycle activity. No process `EventSource` or
      stdout/stderr row remains under `modules/inbox`.
- [ ] **R2 — Preserve message behavior.** Inbox keeps All, Supervisor, and per-member message views, newest/live
      refresh behavior, reply/delivery state, and defensive parsing. Message send, reply, watch, and drain semantics
      are unchanged.
- [ ] **R3 — Neutral shared team feed.** Move the team roster/status hook and its wire types from the Teams module
      to `apps/web/src/lib/use-teams-data.ts`; Teams, Inbox, and Workspace import that single feed.
- [ ] **R4 — Surface project-local workspace facts.** Extend the existing `TeamListing` and `GET /api/team/teams`
      response with `workDir: string | null` and `isCurrentProject: boolean`. Configured teams use `work_dir`;
      orphaned/untethered groups are not selectable Workspace contexts unless their resolved folder matches the
      server project.
- [ ] **R5 — Add Workspace Board composition.** Register `apps/web/src/modules/workspace/` as `id/route:
      workspace`, `sidebarLabel: Workspace`, `order: 0`. It selects only `isCurrentProject` teams and renders
      Overview, Team, Inbox, and Tasks tabs.
- [ ] **R6 — Reuse scoped views.** `TeamsShell` and `InboxShell` accept optional `teamId`; omission preserves the
      current global modules. Workspace passes the selected `teamId`. The Tasks tab embeds the current-project Task
      Kanban; it does not retarget the server or load tasks from another folder.
- [ ] **R7 — No new workspace backend.** Add no workspace config key, service, persistence, route, transport
      contract, or CLI noun. Reuse `/api/team/teams`, `/api/messages`, team process routes, and existing task APIs.
- [ ] **R8 — Verification and docs.** Update focused web/app/server tests for ownership, scope, registration, and
      resource teardown; remove obsolete Inbox timeline tests; keep DESIGN.md accessibility/token conventions;
      synchronize ADR-052, architecture, and surface docs; full repository gates pass.

**Non-goals:** multiple teams per workspace, remote/multi-project task loading, workspace CRUD, permissions,
cross-workspace delivery authorization, supervisor-hub routing, relay controls, and concurrent workspace scheduling.
### Acceptance Criteria
```gherkin
Feature: Team-scoped Workspace Board composition

  @core
  Scenario: R1 — Module ownership follows ADR-052
    Given Teams, Inbox, and Workspace previously had overlapping ownership
    When the G3 implementation begins
    Then ADR-052 defines Teams as the process control plane and Inbox as the durable message plane
    And the design introduces no separate Workspace domain entity or CLI noun

  @core
  Scenario: R2 — A workspace binds a git folder and a team
    Given a configured project-local team
    When the Workspace module loads that team
    Then the team id identifies the workspace context
    And its configured work directory and materialized roster are shown without duplicate workspace state

  @core
  Scenario: R3 — Workspace tabs compose the collaboration surfaces
    Given a project-local team is selected
    When the operator switches among Overview, Team, Inbox, and Tasks
    Then Team reuses the scoped process-control view
    And Inbox reuses the scoped durable-message view
    And Tasks reuses the current project Task Kanban

  @core
  Scenario: R4 — Workspace inboxes are isolated
    Given messages exist for two different teams
    When the operator opens the Workspace Inbox for the first team
    Then only messages whose resolved sender or recipient belongs to that team are shown
    And no process stdout or stderr frame is rendered by Inbox
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Decision authority.** ADR-052 and `docs/design/workspace-design.md` supersede ADR-042's unified
message/process timeline. The decision record is
`docs/plans/2026-08-11-g3-team-inbox-workspace-boundary-brainstorm.md`.

**Ownership invariant.** Teams is the control plane; Inbox is the durable message plane; Workspace is a
composition shell. A component may read team identity outside Teams, but process streams and lifecycle mutations
remain under Teams. Workspace never writes message or process state itself.

**Frozen surfaces and paths.**

1. Extend `packages/app/src/services/team-service.ts` `TeamListing` with `workDir: string | null` and
   `isCurrentProject: boolean`. Resolve configured `work_dir` relative to the service cwd; compare normalized
   absolute paths. Orphaned/untethered groups use a common spec workspace only when all member specs agree,
   otherwise `workDir = null` and `isCurrentProject = false`.
2. Extend the existing raw-Hono `/api/team/teams` response in `apps/server/src/modules/team/index.ts` with those
   fields. No endpoint or oRPC contract is added.
3. Move `apps/web/src/modules/teams/useTeamsData.ts` to `apps/web/src/lib/use-teams-data.ts`, preserving polling,
   parsing, and reload behavior. `TeamGroup` gains the two fields above.
4. Change `TeamsShell` and each Teams tab component to accept `{ teamId?: string }`. When set, filter the shared
   team feed and team-scoped event/process rows; when omitted, preserve current global behavior.
5. Change `InboxShell`, `AllTab`, and `SupervisorTab` to accept `{ teamId?: string }`. Filter a message when either
   endpoint's resolved `teamId` equals the scope. `AgentTab` becomes a durable-message filter only. Delete
   `apps/web/src/modules/inbox/timeline.ts` and remove Inbox imports of `process-stream`.
6. Add `apps/web/src/modules/workspace/{index.tsx,WorkspaceShell.tsx,tabs.ts,OverviewTab.tsx}`. Module registration
   is `id: 'workspace'`, `route: 'workspace'`, `sidebarLabel: 'Workspace'`, `order: 0`. The shell selects the first
   `isCurrentProject` team by default and renders Overview, scoped `TeamsShell`, scoped `InboxShell`, and the
   existing Task Kanban view. If none exists, show an actionable empty state pointing to `agent.team` config.

**Task scope.** The Tasks tab is project-local: `spur serve` already binds task APIs to one cwd. It does not query
an arbitrary `workDir`; only `isCurrentProject` teams are Workspace candidates. Global Teams/Inbox continue to
show other configured or materialized groups.

**Anti-patterns.** Do not add a `Workspace` model/service/schema/table/route/CLI noun; do not duplicate team
polling; do not keep a hidden Inbox process stream; do not move message delivery through process stdin; do not
generalize `WebModule` for arbitrary props or runtime nesting; do not add cross-project task loading.

**Primary test targets.** `packages/app/tests/services/team-service.test.ts`, server team module tests,
`apps/web/tests/modules/teams`, `apps/web/tests/modules/inbox`, module discovery/registry tests, and new Workspace
component tests. Tests must prove global omission behavior and scoped `teamId` behavior separately.
### Plan
- [ ] **P1 — Team context facts (R4, R7).** Add `workDir`/`isCurrentProject` to `TeamListing` and the existing
      `/api/team/teams` response; cover configured, orphaned, mismatched, and common-workspace cases.
- [ ] **P2 — Neutral team feed (R3).** Move `useTeamsData` and wire types to `apps/web/src/lib`; repoint consumers
      with behavior-preserving tests.
- [ ] **P3 — Cut Inbox from the process plane (R1, R2).** Convert member tabs to message-only, add optional
      `teamId` filtering to message views, delete timeline/frame logic and obsolete tests, and verify no Inbox
      process stream remains.
- [ ] **P4 — Scope Teams without changing globals (R1, R6).** Thread optional `teamId` through TeamsShell and
      operational tabs; preserve no-prop behavior and lifecycle/terminal resource teardown.
- [ ] **P5 — Add Workspace module (R5, R6).** Register order 0; implement team selection, Overview, scoped Team
      and Inbox tabs, current-project Tasks composition, and the no-project-local-team empty state.
- [ ] **P6 — Focused verification (R8).** Run the narrow app/server/web tests first, then Biome/typecheck; fix all
      ownership, accessibility, resource teardown, and module-registry regressions.
- [ ] **P7 — Documentation and full gates (R8).** Keep ADR-052, `03`, `04`, Inbox/Workspace satellites, and feature
      G3 synchronized; run `bun run autofix`, `bun run spur-check`, `bun run lint`, `bun run test`, `bun run
      test-cf`, `bun run build`, feature/task checks, and confirm only intentional git changes.
### Solution
**Solution**

Implemented the G3 Workspace Board composition as a boundary-cleanup over existing services (ADR-052). Change map (file:line):

- **R4/R7 (P1) Backend.** `packages/app/src/services/team-service.ts:198` — `TeamListing` gains `workDir: string | null` and `isCurrentProject: boolean` (`:210-212`); `listTeams()` resolves configured `work_dir` relative to service cwd (normalized absolute compare, `:575`), and orphaned/untethered groups use a common spec workspace only when all member specs agree. `apps/server/src/modules/team/index.ts:222-223` surfaces both fields on the existing `GET /api/team/teams` (no new endpoint/contract/noun).
- **R3 (P2) Neutral feed.** `apps/web/src/modules/teams/useTeamsData.ts` → `apps/web/src/lib/use-teams-data.ts:24-26` (git move, logic preserved); `TeamGroup` gains the two fields; consumers (Teams tabs, InboxShell, Workspace) repointed to the shared feed.
- **R1/R2 (P3) Cut Inbox from process plane.** Deleted `apps/web/src/modules/inbox/timeline.ts` + its test. `AgentTab.tsx` rewritten to durable-message filter only (no process EventSource). `apps/web/src/modules/inbox/AllTab.tsx:89` `filterMessagesByTeam` checks both `to.teamId` and `from.teamId`; `SupervisorTab.tsx` and `InboxShell.tsx` accept `{ teamId? }` and thread scope; dropdown hidden when scoped.
- **R1/R6 (P4) Scope Teams.** `apps/web/src/modules/teams/TeamsShell.tsx` + operational tabs accept `{ teamId? }`; scoped filtering preserves global omission behavior.
- **R5/R6 (P5) Workspace module.** New `apps/web/src/modules/workspace/index.tsx:13-21` (registered `id/route: workspace`, `sidebarLabel: Workspace`, `order: 0`), `WorkspaceShell.tsx`, `tabs.ts`, `OverviewTab.tsx`. Shell selects first `isCurrentProject` team and renders Overview + scoped TeamsShell + scoped InboxShell + current-project `TaskKanbanView` (exported from `apps/web/src/modules/task-kanban/index.tsx`); actionable empty state when no project-local team.
- **R8 (P6/P7) Tests + docs.** Added `packages/app/tests/services/team-service.test.ts` R4 cases (configured/orphaned/disagree/untethered), `apps/server/tests/modules/team/index.test.ts` response assertions, `apps/web/tests/modules/inbox/inbox.test.tsx` scoped-isolation tests (incl. member→supervisor regression), `apps/web/tests/modules/workspace/workspace.test.tsx`, `apps/web/tests/lib/use-teams-data.test.ts`; removed obsolete `inbox/timeline.test.ts` + old `useTeamsData.test.ts`. Docs (ADR-052, 03/04, feature G3) synchronized.
- **Review fix (P2).** `apps/web/src/modules/inbox/SupervisorTab.tsx` previously filtered on `m.to.teamId === teamId` only, dropping member→supervisor rows (supervisor endpoint has no teamId). Now reuses `filterMessagesByTeam` so sender-OR-recipient team membership survives scoping.
### Testing
**Testing**

Commands run and outcomes (all green):

- `bun test packages/app/tests/services/team-service.test.ts apps/server/tests/modules/team/index.test.ts apps/web/tests/modules/workspace/ apps/web/tests/lib/use-teams-data.test.ts apps/web/tests/modules/inbox/inbox.test.tsx apps/web/tests/modules/teams/components.test.tsx` → 179 pass / 0 fail (focused targets; covers R4 backend cases, workspace module/shell, lib feed, inbox scoped isolation incl. member→supervisor regression, teams scoping).
- `bun test apps/web/tests` → 650 pass / 0 fail.
- `bun run typecheck` → all 7 workspaces exit 0.
- `bun run lint` (biome check . --error-on-warnings + typecheck) → clean.
- `bun run test` → 4875 pass / 0 fail across 270 files (three consecutive clean runs; a transient 2-fail on the first run self-resolved with no code change).
- `bun run test-cf` → clean (Worker entry).
- `bun run build` → all workspaces exit 0 (cli, server, web).
- `bun run corpus-check` → OK, 0 new corpus errors.
- `spur task check 0197 --folder docs/tasks2 --strict-core` → pass, no findings, no missing sections.

Coverage: per-file line/function ≥ 90% gate satisfied across the changed workspaces (coverage table in `bun run test` output shows no below-threshold files in the changed paths).

**Acceptance Criteria Verification** (from review + verify step):

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| [doc-only] R1 — Module ownership follows ADR-052 | MET | static-ref | ADR-052 + workspace-design.md; AgentTab durable-message-only; timeline.ts deleted; no Workspace noun |
| R2 — A workspace binds a git folder and a team | MET | test | team-service.test.ts configured/orphaned/disagree/untethered; workDir/isCurrentProject surfaced |
| R3 — Workspace tabs compose the collaboration surfaces | MET | test | workspace.test.tsx; WorkspaceShell renders scoped TeamsShell + InboxShell + TaskKanbanView |
| R4 — Workspace inboxes are isolated | MET | test | inbox.test.tsx scoped AllTab + SupervisorTab regression; filterMessagesByTeam both endpoints |

Verdict: **PASS** (8/8 requirements MET, 4/4 AC MET, evidence-rule pass, task check pass).
### Review
**Review**

Independent review by `sp-super-reviewer` (functional traceability + SECUA + architecture) over the uncommitted diff. Disposition: **PASS** after one P2 fix.

| Severity | Finding | Resolution |
| --- | --- | --- |
| P2 | Scoped `SupervisorTab` dropped member→supervisor messages (filter checked `m.to.teamId` only; supervisor endpoint has no teamId) — under-satisfied R4 isolation (sender OR recipient) | Fixed: reuse `filterMessagesByTeam` (checks both `to.teamId` and `from.teamId`); regression test added (`report to supervisor` m4 survives scoping). `apps/web/src/modules/inbox/SupervisorTab.tsx` |
| P3 | Workspace + composed tab each mount independent `useTeamsData` (2× 5s polls, no shared client cache) | Accepted — no duplicate *implementation* (single shared hook); out of scope. |
| P3 | `isCurrentProject` uses lexical `resolve()` not `realpath` (symlink edge) | Accepted — edge; documented residual. |
| P4 | Overview "Last refresh" shows wall-clock not fetch time; empty-state flash on initial load; scoped TerminalTab no auto-select | Accepted — non-blocking usability advisories. |

Traceability: R1–R8 all MET (8/8). Anti-patterns all avoided (no Workspace backend noun; single shared feed; no hidden Inbox process stream; no process-stdin delivery; no WebModule over-generalization; no cross-project task loading). Resource teardown (inbox SSE abort/close, member terminal) verified.

Residual risk: none blocking. P3/P4 advisories tracked as non-blocking notes (shared client cache, realpath normalization, refresh timestamp, empty-state flash).
### References
- Feature G3
- ADR-052
- `docs/design/workspace-design.md`
- `docs/design/inbox-board-module.md`
- `docs/plans/2026-08-11-g3-team-inbox-workspace-boundary-brainstorm.md`
- Tasks 0193, 0195, 0196, and 0422
### History
- 2026-07-03T23:44:29.208Z todo → blocked (system)
- 2026-08-11T20:04:01.961Z blocked → todo (system)
- 2026-08-11T23:13:04.592Z todo → wip (system)
