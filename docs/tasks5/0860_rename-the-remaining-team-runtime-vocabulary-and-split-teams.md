---
schema_version: 1
name: Rename the remaining team runtime vocabulary and split TeamService
status: done
template: feature-impl
created_at: 2026-09-15T05:26:45.219Z
updated_at: "2026-09-15T17:13:41.790Z"
feature_id: G65
priority: P2
tags:
  - g65
  - server
  - web
  - events
  - refactor

dependencies: ["0858"]
---

## 0860. Rename the remaining team runtime vocabulary and split TeamService

### Background

Covers the rename part of G65 scenario R6 (design §5).

After task 2 the live team-named surfaces are:

- routes in `apps/server/src/modules/team/index.ts`: `GET /api/team/processes`, `GET /api/team/processes/:id/stream`, `POST /api/team/processes/:id/stdin`, `POST /api/team/agents/:id/start|stop`, `GET /api/team/health`. Callers: web `ProcessesView.tsx`, `MemberTerminal.tsx`, `AgentsView.tsx`, `MemberDetail.tsx`, `lib/process-stream.ts`, `roster.ts` (comment); CLI `apps/cli/src/commands/agent.ts:213,356,364,417`; the CSRF note/matcher in `apps/server/src/middleware/pipeline.ts:50-51`; `supervisor-service.ts:172` (comment).
- events: `team.member.assigned` (produced by `TeamService.assignTask` and the CLI `assignTaskWithLedger`, `apps/cli/src/commands/task.ts:476,1667`), `team.member.started|stopped` (the TeamService bridge `team-service.ts:1148-1170` and `SupervisorService`, `supervisor-service.ts:74-75`); payload schemas `packages/app/src/services/event-names.ts:868-920`.
- `TeamService`: messaging (`getInbox`, `drainPending`, `releasePending`, `settleDelivered`, `settleFailed`, `countPending`, `listRecent`, `replyToMessage`), `assignTask`, `listAgentSpecs`, `createAgentSpec`, `buildIdentity`, plus roster helpers `materializeRoster` / `resolveMemberExecutor` / `MaterializeResult` used by `FleetService`. Callers: CLI `message.ts`, `agent.ts`, `task.ts`; server `context.ts:469`, `modules/messages/index.ts`.
- supervisor identity: `team:` spec tag → `teamId` and the `SPUR_TEAM_ID` env (`supervisor-service.ts:203-228`); no producer writes `team:` tags once `materializeTeam` is gone.

### Requirements

- **R1** — Routes: move `apps/server/src/modules/team/` to `modules/processes/`; serve `GET /api/processes`, `GET /api/processes/:id/stream`, `POST /api/processes/:id/stdin`, `POST /api/agents/:id/start|stop`; delete `GET /api/team/health`. No aliases. Move every caller listed in Background and the CSRF matcher in the same change.
- **R2** — Events: rename `team.member.assigned` to `task.assigned` (catalog, payload schema, both producers); delete `team.member.started|stopped` and the TeamService bridge, with `SupervisorService` emitting the existing `agent.started|stopped`; payloads drop `teamId`; drop `'team.'` from `TEAM_EVENT_PREFIXES` in `apps/web/src/modules/projects/activity-history.ts:23` (rename the constant to its remaining meaning).
- **R3** — Services: rename `TeamService` to `AgentCoordinationService` in `packages/app/src/services/agent-coordination-service.ts` (messaging, `assignTask`, `listAgentSpecs`, `createAgentSpec`, `buildIdentity`); move `materializeRoster`, `resolveMemberExecutor` and `MaterializeResult` (without `teamId`) into `fleet-service.ts`; update package exports, the server context accessor (`teamService()` → `coordination()`), CLI callers, and tests (renamed test files).
- **R4** — Supervisor: delete the `team:` tag → `teamId` resolution in `supervisor-service.ts` (:203-228, including the `SPUR_TEAM_ID` injection at :228) and `agent-instance-store.ts:12` (`teamTagOf`), and the registry `teamId` write; reword the `fleet-service.ts:440` comment that names `SPUR_TEAM_ID` (AC3's lens counts it). Keep the `agent_instances.team_id` column and index (nullable, unwritten) — no schema migration.
- **R5** — Same-commit docs: `docs/design/observability-contracts.md` route rows (:347-353) and event catalog, `docs/design/inter-agent-control-plane.md` env table (:73) and route row (:22), `docs/design/cli-contracts.md` agent start/stop text (:452, :504, :521, :523), `docs/03_ARCHITECTURE.md` supervisor env line (:674) and messaging table (:516-517), `docs/inventory/system-events-producer-audit.md`, plugin `spur-cli/references/agent.md`, `self.md` **and `serve.md`** (all three carry `/api/team` mentions). `docs/04_DESIGN.md` is an index with no route rows — confirm only.

### Acceptance Criteria

Graduates G65 feature scenario R6 — the Gherkin
below carries its exact feature titles, and the rows under it are the
task-local verify lens.

```gherkin
Feature: Fleet declaration in spur config

    @core
    Scenario: R6 — Fleet runtime surfaces carry fleet names
      Given the /api/team routes, team.* events, and TeamService used by web, CLI, and supervisor
      When the rename lands
      Then every live route, event, and service is reachable under a fleet or owning-noun name with its callers moved in the same change
      And team.up and team.down are removed rather than renamed
```

- **AC1 — Routes live under owning nouns (R1).** Given `spur serve`, when clients call `GET /api/processes`, the process stream, stdin, and `POST /api/agents/:id/start|stop`, then they behave as the former `/api/team/*` routes did, every `/api/team/*` path returns 404, and the web and CLI callers use the new paths (covered by their tests).
- **AC2 — Events carry non-team names (R2).** Given `spur task update --assignee` and a supervised start/stop, when events are recorded, then they are `task.assigned` and `agent.started|stopped`, and the event catalog contains no `team.` name.
- **AC3 — No team runtime vocabulary remains (R3, R4, R5).** Given the source tree, when `rg -n "TeamService|team-service|SPUR_TEAM_ID|'team:'|team\.member\.|/api/team"` runs over `apps/`, `packages/` and `plugins/sp` (excluding generated bundles), then there are zero hits, the `agent_instances.team_id` column is unchanged, and `bun run spur-check`, `bun run test-cf` and `bun run build` pass.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-15T05:32:35.266Z

**Decisions**

- **Owning nouns, not `fleet`.** Process and agent start/stop routes serve any supervised spec, so they take `processes` / `agents`, matching `spur agent start|stop` (design §5).
- **Delete duplicate events rather than rename.** `team.member.started|stopped` duplicate `agent.started|stopped` (`event-names.ts:298-299`); assignment becomes `task.assigned` because the subject is the task.
- **Two-way split.** Coordination (messaging, assignment, spec listing, identity) → `AgentCoordinationService`; roster materialization → `fleet-service.ts`, its only consumer. No third service.
- **`agent_instances.team_id` kept.** A rename is a schema migration (block → explain → wait); the column stays nullable and unwritten.
- **Persisted `system_events` rows keep old names.** No data migration; readers treat names generically.
- **`apps/web/src/router.tsx:17` (`teams` → `/board/projects/agents`) kept.** It is a Board URL redirect for old bookmarks, not route/event/service vocabulary; removing it is web-routing cleanup outside G65.

**Premises (verified 2026-09-14)**

- Routes: `apps/server/src/modules/team/index.ts:41` processes list, `:77`/`:88` agent start/stop, `:99` stdin, `:215` `/teams` (removed by 0857).
- Callers: `apps/cli/src/commands/agent.ts:213,356`; CSRF note `apps/server/src/middleware/pipeline.ts:50-51`; `apps/web/src/lib/process-stream.ts:4`.
- Events: `team-service.ts:151-153` bus map, `:778` assigned emit, `:1154` started bridge; `supervisor-service.ts:56-75` member payload/bus, `:136` stop guard; CLI producer comments `task.ts:476,1667`; web filter `activity-history.ts:23`.
- Identity: `supervisor-service.ts:203-228` (`team:` tag, `SPUR_TEAM_ID`), `agent-instance-store.ts:12`, `team-service.ts:877,1130`.
- Accessor: `apps/server/src/context.ts:158,467`; messages module callers `modules/messages/index.ts:36,45,83,101`.
- Roster helpers: `team-service.ts:264` `MaterializeResult`, `:323` `resolveMemberExecutor`, `:413` `materializeRoster`; imported by `fleet-service.ts:23`.
- Tests: `apps/server/tests/modules/team/index.test.ts`, `middleware/pipeline.test.ts`, `modules/messages/index.test.ts`, `upstream-system-events-wiring.test.ts`; `packages/app/tests/services/{team-service,agent-service,write-slot-service}.test.ts`; `apps/cli/tests/commands/{agent,agent-server,agent-loop-wake,agent-spec-flag,message}.test.ts`; `apps/web/tests/modules/projects/{ProcessesView,AgentsView,MemberDetail,responsive}.test.tsx`.

**Dependencies:** 0858 (the route and service moves build on the post-0857/0858 `team-service.ts` and `fleet-service.ts`).

#### Q&A entry — 2026-09-15T06:13:09.147Z

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-15T05:32:35.266Z

**Decisions**

- **Owning nouns, not `fleet`.** Process and agent start/stop routes serve any supervised spec, so they take `processes` / `agents`, matching `spur agent start|stop` (design §5).
- **Delete duplicate events rather than rename.** `team.member.started|stopped` duplicate `agent.started|stopped` (`event-names.ts:298-299`); assignment becomes `task.assigned` because the subject is the task.
- **Two-way split.** Coordination (messaging, assignment, spec listing, identity) → `AgentCoordinationService`; roster materialization → `fleet-service.ts`, its only consumer. No third service.
- **`agent_instances.team_id` kept.** A rename is a schema migration (block → explain → wait); the column stays nullable and unwritten.
- **Persisted `system_events` rows keep old names.** No data migration; readers treat names generically.
- **`apps/web/src/router.tsx:17` (`teams` → `/board/projects/agents`) kept.** It is a Board URL redirect for old bookmarks, not route/event/service vocabulary; removing it is web-routing cleanup outside G65.

**Premises (verified 2026-09-14)**

- Routes: `apps/server/src/modules/team/index.ts:41` processes list, `:77`/`:88` agent start/stop, `:99` stdin, `:215` `/teams` (removed by 0857).
- Callers: `apps/cli/src/commands/agent.ts:213,356`; CSRF note `apps/server/src/middleware/pipeline.ts:50-51`; `apps/web/src/lib/process-stream.ts:4`.
- Events: `team-service.ts:151-153` bus map, `:778` assigned emit, `:1154` started bridge; `supervisor-service.ts:56-75` member payload/bus, `:136` stop guard; CLI producer comments `task.ts:476,1667`; web filter `activity-history.ts:23`.
- Identity: `supervisor-service.ts:203-228` (`team:` tag, `SPUR_TEAM_ID`), `agent-instance-store.ts:12`, `team-service.ts:877,1130`.
- Accessor: `apps/server/src/context.ts:158,467`; messages module callers `modules/messages/index.ts:36,45,83,101`.
- Roster helpers: `team-service.ts:264` `MaterializeResult`, `:323` `resolveMemberExecutor`, `:413` `materializeRoster`; imported by `fleet-service.ts:23`.
- Tests: `apps/server/tests/modules/team/index.test.ts`, `middleware/pipeline.test.ts`, `modules/messages/index.test.ts`, `upstream-system-events-wiring.test.ts`; `packages/app/tests/services/{team-service,agent-service,write-slot-service}.test.ts`; `apps/cli/tests/commands/{agent,agent-server,agent-loop-wake,agent-spec-flag,message}.test.ts`; `apps/web/tests/modules/projects/{ProcessesView,AgentsView,MemberDetail,responsive}.test.tsx`.

**Dependencies:** 0858 (the route and service moves build on the post-0857/0858 `team-service.ts` and `fleet-service.ts`).

#### Q&A entry — 2026-09-14 refineall ready-depth pass

**Decisions**

- **R5 doc/plugin surface corrected on re-verification:** `docs/04_DESIGN.md` is an index with no `/api/team` rows (confirm only — route rows live in `observability-contracts.md`, already named); `plugins/sp/skills/spur-cli/references/serve.md` also matches AC3's lens and was added to R5 alongside `agent.md`/`self.md`.
- **R4 scope pinned:** `SPUR_TEAM_ID` is injected at `supervisor-service.ts:228` (covered by the `:203-228` block) and named in a `fleet-service.ts:440` comment — the comment must be reworded or AC3's zero-hit lens fails. `supervisor-service.ts` lives at `packages/app/src/services/` (premise paths shorthand). All other premises (routes :41-:250, event catalog :318-320/:868-903, accessor :158/:467, roster-helper import at `fleet-service.ts:23`, `agent-instance-store.ts` `teamTagOf`, 16 test files) re-verified against the tree unchanged.

### Design

Map frozen in `docs/design/fleet-config-declaration.md` §5.

- **Owning nouns, not `fleet`.** Processes and agent start/stop are supervisor surfaces that work for any spec, fleet-materialized or not, so they take the resource names `processes` / `agents`, matching `spur agent start|stop`.
- **Delete duplicates rather than rename them.** `team.member.started|stopped` duplicate `agent.started|stopped`; a `fleet.member.*` rename would keep two names for one fact.
- **`task.assigned`.** The subject is the task (`spur task update --assignee`), so the event takes the task noun.
- **Two-way split, no third service.** Coordination (messaging and assignment) is ADR-057's control plane; roster materialization belongs to the fleet, which is its only caller.
- **Column kept.** Renaming `agent_instances.team_id` is a schema migration (block → explain → wait); it stays nullable and unwritten and is noted for a later migration.
- **Persisted history.** Existing `system_events` rows keep old names; readers already treat names generically.

### Plan

1. Services: create `agent-coordination-service.ts` by renaming, move the roster helpers into `fleet-service.ts`, update exports, context and callers; rename the test files; typecheck.
2. Events: rename/delete in `event-names.ts`, the producers and the supervisor; fix event catalog tests and web activity filters.
3. Supervisor identity: drop the `team:` tag, `SPUR_TEAM_ID` and the registry `teamId` write; tests.
4. Routes: move the module, the new paths, callers (web, CLI, middleware); server/web/CLI tests.
5. Same-commit docs and plugin references.
6. `bun run spur-check`, `bun run test-cf`, `bun run build`.

### Solution

The remaining team-named runtime surfaces now sit under their owning nouns; no live route, event, or
service still describes the retired team model.

| Change | Anchor |
| --- | --- |
| Routes mounted under the owning nouns — `GET /api/processes`, its stream and stdin children, `POST /api/agents/:id/start\|stop` | `apps/server/src/modules/processes/index.ts:42`, `:76`, `:98`, `:119` |
| Module moved and rewired into the builtin registry (`team` → `processes`), with the team-scoped health probe deleted | `apps/server/src/modules/registry.ts:33` |
| Assignment takes the task noun — catalog row, presenter, and the source-family profile | `packages/app/src/services/event-names.ts:316` |
| The member-scoped lifecycle pair is deleted, not renamed: the supervisor emits the catalog's own `agent.started` / `agent.stopped` | `packages/app/src/services/supervisor-service.ts:252` |
| The Board timeline prefix list drops the retired family and is renamed to its remaining meaning | `apps/web/src/modules/projects/activity-history.ts:24` |
| Coordination service renamed for what it does — messaging, assignment, spec listing, identity | `packages/app/src/services/agent-coordination-service.ts:234` |
| The roster projection moves to the fleet service, its only consumer | `packages/app/src/services/fleet-service.ts:274` |
| `MaterializeResult` loses its grouped id | `packages/app/src/services/fleet-service.ts:145` |
| Package exports follow the split and the renamed symbols | `packages/app/src/index.ts:67` |
| Server context accessor reads as the coordination seam | `apps/server/src/context.ts:460` |
| The spec-tag grouping id is no longer resolved, so no projection invents one — the frozen column stays nullable and unwritten | `packages/app/src/services/agent-instance-store.ts:24` |
| Supervised spawn injects identity without a grouping env | `packages/app/src/services/supervisor-service.ts:217` |
| Route and event rows follow in the observability contract | `docs/design/observability-contracts.md:347` |
| Control-plane route row follows the new paths | `docs/design/inter-agent-control-plane.md:22` |
| Env table loses the retired grouping variable | `docs/design/inter-agent-control-plane.md:70` |
| Agent start/stop contract names the new paths | `docs/design/cli-contracts.md:524` |
| Architecture: the fleet declaration paragraph and the supervised-spawn env line | `docs/03_ARCHITECTURE.md:676` |
| Producer audit: the retired family's rows are replaced by the surviving lifecycle names | `docs/inventory/system-events-producer-audit.md:93` |
| Event catalog mirror stays two-sided with the code catalog | `docs/design/event-tracking.md:292` |
| Plugin references follow (agent start/stop paths, serve/self route text) | `plugins/sp/skills/spur-cli/references/agent.md:176` |

The two-sided presenter gate (`event-names.test.ts`) keeps the catalog and its mirror doc in step, so
the retired names cannot reappear silently, and the new `task.assigned` row is exercised end to end
(coordination service emit, CLI ledger persistence, Board prefix filter).

**Verification:** `bun run spur-check` PASS (8329 tests, 0 fail); `bun run test-cf` PASS;
`bun run build` PASS; the AC3 lens
`TeamService|team-service|SPUR_TEAM_ID|'team:'|team.member.|/api/team` over `apps/`, `packages/` and
`plugins/sp` returns zero hits.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/server/src/modules/team/` is gone and `apps/server/src/modules/registry.ts:33` registers `processesModule` only — no alias. Routes live at `apps/server/src/modules/processes/index.ts:42` (list), `:82`/`:93` (agent start/stop), `:104` (stdin), `:125` (SSE stream); the team-scoped health probe is deleted (test `mounts no health probe`). Callers moved in the same change: web `apps/web/src/modules/projects/MemberTerminal.tsx:120`, `ProcessesView.tsx:182`, `AgentsView.tsx`, `apps/web/src/lib/process-stream.ts:78`; CLI `apps/cli/src/commands/agent.ts:364` (`${server}/processes`), `:418` (start/stop); CSRF matcher/comments `apps/server/src/middleware/pipeline.ts:50-51`. Live mounted-route probe (`.spur/run/0860-verify-route-probe.ts`): `GET /api/processes` → 200 `application/json` with `processes,count,executions,executionsCount`; `:id/stream` → 200 `text/event-stream` (first frame `data: {"stream":"meta"…}`); `:id/stdin` with a valid body → 200 `{"ok":true}` with the line forwarded; agent start/stop → 201/200; all six retired paths → **404**. `cd apps/server && bun test tests/modules/processes/index.test.ts tests/modules/registry.test.ts tests/middleware/pipeline.test.ts tests/context.test.ts` → 104 pass / 0 fail |
| R2 | MET | Catalog carries `task.assigned` (`packages/app/src/services/event-names.ts:316`, payload `:846`) and the existing `agent.started`/`agent.stopped` (`:296-297`); the catalog holds **no** `team.` name and **no** `teamId` reference (`rg "teamId" packages/app/src/services/event-names.ts` → 0, `rg "'team\." …` → 0). The `process.spawned` payload that pass 1 flagged now declares `label`/`pid`/`agentId` only (`:649`). Producers: `packages/app/src/services/agent-coordination-service.ts:617` (`bus.emit('task.assigned', …)`), the CLI assignee ledger path (`apps/cli/src/commands/task.ts:510` → `assignTaskWithLedger` constructing the service at `:1668-1680`), and `packages/app/src/services/supervisor-service.ts:252` (`this.emit('agent.started', …)`, stop guarded at `:268`); the member-scoped pair is deleted, not renamed. The web prefix constant drops `'team.'` and is renamed to its remaining meaning (`apps/web/src/modules/projects/activity-history.ts:24`, `COORDINATION_EVENT_PREFIXES = ['agent.','message.','task.','supervisor.','process.']`). Tests: `packages/app` 147 pass / 0 fail across `agent-coordination-service`, `event-names`, `supervisor-service`, `agent-instance-store`, `fleet-service`; `bun test -t "task.assigned"` → 3 pass incl. `0860 R2: agent lifecycle is not re-published under a second event name`; `apps/cli` `agent-server.test.ts` 15 pass |
| R3 | MET | `packages/app/src/services/agent-coordination-service.ts:234` is the renamed class (messaging, `assignTask`, `listAgentSpecs`, `createAgentSpec`, `buildIdentity`); `resolveMemberExecutor` (`packages/app/src/services/fleet-service.ts:184`), `materializeRoster` (`:274`) and `MaterializeResult` (`:145`, fields `upserted/orphaned/written` — no grouping id) now live with their only consumer. Server context reads as the coordination seam (`apps/server/src/context.ts:158`, `:460`) with callers `apps/server/src/modules/messages/index.ts:36,45,83,101`. Exports follow (`packages/app/src/index.ts:51-67`, `:224`); `team-service.ts` and `team-service.test.ts` are gone, `agent-coordination-service.test.ts` present. Lens over `apps/ packages/ plugins/sp` for `TeamService\|team-service` → 0 hits |
| R4 | MET | No spec-tag reader survives: `rg "teamTagOf\|'team:'\|teamId" packages/app/src/services/supervisor-service.ts` → 0 hits, and the spawn env no longer injects the grouping variable (AC3 lens for `SPUR_TEAM_ID` → 0 hits tree-wide, including the `fleet-service.ts` comment R4 names). The frozen projection supplies the interface field as a literal `null` with the retention recorded in code (`packages/app/src/services/agent-instance-store.ts:22-24`), so nothing stamps the column. `agent_instances.team_id` and `idx_agent_instances_team` are unchanged (`packages/domain/src/migrations.ts:901`, `:918`) and no `schema`/`migration`/`drizzle` path appears in the change set — no schema migration |
| R5 | MET | The R5-named surfaces carry the new names and no live `/api/team`: `docs/design/observability-contracts.md` (route rows + event catalog, 5 × `/api/processes`), `docs/design/inter-agent-control-plane.md` (env table + route row), `docs/design/cli-contracts.md` (agent start/stop text), `docs/03_ARCHITECTURE.md` (supervisor env line + messaging table, 3 × `/api/processes`), `docs/inventory/system-events-producer-audit.md`, and plugin references `agent.md` (2), `self.md` (1), `serve.md` (1). `docs/04_DESIGN.md` is an index: its route pointer now names `/api/processes/* + /api/agents/*` (`:389`), and the remaining `:397` mention is the G64-era `:team/up\|down` note (removed by 0855). Residual `/api/team` mentions live only in `docs/design/fleet-config-declaration.md` (the G65 plan of record — 0861 owns its authority sync) and a Board-module history row (`board-module-boundaries.md:30`, the 0268 `useTeamsData` record) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R6 — Fleet runtime surfaces carry fleet names | MET | command | Lens `rg -n "TeamService\|team-service\|SPUR_TEAM_ID\|'team:'\|team\.member\.\|/api/team" apps packages plugins/sp` (generated bundles excluded) → **0 hits**; `rg "team\.up\|team\.down" apps packages plugins/sp` → 0 live hits (the two remaining occurrences are the feature plan-of-record doc); every live route, event and service is reachable under its owning-noun name with callers moved in the same change (R1/R3 rows); suites fresh this run — server 104, web 184, CLI 106, app 147, all 0 fail |
| **AC1 — Routes live under owning nouns (R1).** Given `spur serve`, when clients call `GET /api/processes`, the process stream, stdin, and `POST /api/agents/:id/start|stop`, then they behave as the former `/api/team/*` routes did, every `/api/team/*` path returns 404, and the web and CLI callers use the new paths (covered by their tests). | MET | command | Live probe: the five new surfaces answer (200 / 200 `text/event-stream` / 200 `{"ok":true}` / 201 / 200) and all six retired paths return **404** (`/api/team/processes`, its `:id/stream`, `:id/stdin`, `/api/team/agents/:id/start`, `:id/stop`, `/api/team/health`) — 404 by absence of any alias mount, proven against the mounted module, not inferred. **Payload parity restored:** both row families carry the predecessor's `teamId` key with its `null` shape (`apps/server/src/modules/processes/index.ts:44-54`, `:70`) and the Board parsers now treat a missing/non-string value as `null` (`apps/web/src/modules/projects/MemberTerminal.tsx:41-48`, `:100-112`). End-to-end consumer probe (`.spur/run/0860-verify-consumer-probe.ts`) against the live route JSON with one supervised process and one registry execution: `parseProcessList(wire)` → 1 row, **`parseExecutions(wire)` → 1 row** (pass 1 measured `null` here — the tab-hang regression is closed). Server regression test `keeps teamId on both row families of the moved /api/processes route (0860)` (`apps/server/tests/modules/processes/index.test.ts:175`, inside the 104-pass run); web `tests/modules/projects/` + `tests/lib/process-stream.test.ts` → 184 pass; CLI `agent.test.ts` + `message.test.ts` + `agent-team.test.ts` → 106 pass |
| **AC2 — Events carry non-team names (R2).** Given `spur task update --assignee` and a supervised start/stop, when events are recorded, then they are `task.assigned` and `agent.started|stopped`, and the event catalog contains no `team.` name. | MET | test | Catalog sweep: no `team.` event name and no `teamId` payload field (`packages/app/src/services/event-names.ts` → 0 hits for both lenses); assignment records `task.assigned` (catalog `:316`/`:846`, producer `agent-coordination-service.ts:617`, CLI ledger path `apps/cli/src/commands/task.ts:510`; covered by `agent-coordination-service.test.ts` `-t "task.assigned"` → 3 pass and `event-names.test.ts` → 35 pass); a supervised start/stop records the catalog's own `agent.started`/`agent.stopped` (`supervisor-service.ts:252`, `:268`; `supervisor-service.test.ts` in the 147-pass run); the CLI ledger path is covered by `apps/cli/tests/commands/agent-server.test.ts` → 15 pass |
| **AC3 — No team runtime vocabulary remains (R3, R4, R5).** Given the source tree, when `rg -n "TeamService|team-service|SPUR_TEAM_ID|'team:'|team\.member\.|/api/team"` runs over `apps/`, `packages/` and `plugins/sp` (excluding generated bundles), then there are zero hits, the `agent_instances.team_id` column is unchanged, and `bun run spur-check`, `bun run test-cf` and `bun run build` pass. | MET | command | Lens → **0 hits**; `agent_instances.team_id` + index unchanged (`packages/domain/src/migrations.ts:901`, `:918`) with no schema path in the diff; all three gates fresh this run — `bun run spur-check` exit 0 (`.spur/run/0860-test-gate.status` = PASS; `.spur/run/0860-test-gate.log`: **8331 pass / 0 fail** across 472 files), `bun run test-cf` exit 0, `bun run build` exit 0 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:77abdd40a0f73f1c999141a9626414b8467bb916846f3a08d5bfb2f477c527fc |

### References

- Feature: [G65 — fleet declaration in spur config](../../features/G65_fleet-declaration-in-spur-config.md)
- Design: [docs/design/fleet-config-declaration.md](../../design/fleet-config-declaration.md)
- ADR-116 (project-scoped fleet composition), ADR-057 (inter-agent control plane)
- Governance: [docs/design/harness-surface-governance.md](../../design/harness-surface-governance.md)

### History

- 2026-09-15T16:05:58.839Z todo → wip (system)
- 2026-09-15T17:13:40.313Z wip → testing (system)
- 2026-09-15T17:13:41.790Z testing → done (system)

