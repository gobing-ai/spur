---
schema_version: 1
name: Rename the remaining team runtime vocabulary and split TeamService
status: done
template: feature-impl
created_at: 2026-09-15T05:26:45.219Z
updated_at: "2026-09-15T18:22:26.879Z"
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
| R1 | MET | `apps/server/src/modules/processes/index.ts:42` serves `GET /api/processes`, `:82` serves `POST /api/agents/:id/start` (fresh re-read); `/api/team` has zero source hits → every old path 404s by construction; `apps/server/tests/modules/processes/` → 28 pass, 0 fail and `apps/web/tests/modules/projects/` → 170 pass, 0 fail (fresh, callers moved). |
| R2 | MET | `packages/app/src/services/event-names.ts:296-297,316` — catalog carries `agent.started |
| R3 | MET | `packages/app/src/services/agent-coordination-service.ts:234` — `AgentCoordinationService`; server accessor `coordination()` at `apps/server/src/context.ts:158,460`; rg lens `TeamService |
| R4 | MET | `rg "teamTagOf |
| R5 | MET | Same-commit docs landed in the merged commit `004beaf37` chain (observability contracts, control-plane, cli-contracts, 03_ARCHITECTURE, plugin references); 0861's authority sync verified the satellites; `docs/04_DESIGN.md` confirmed index-only. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R6 — Fleet runtime surfaces carry fleet names | MET | test | processes suite 28 pass + web projects suite 170 pass + coordination/fleet/event-names 108 pass (all fresh, 0 fail); rg lens `TeamService |
| AC1 — Routes live under owning nouns (R1) | MET | test | Route registrations `apps/server/src/modules/processes/index.ts:42,82` + processes tests 28 pass (fresh); `/api/team/*` unroutable (zero source hits). |
| AC2 — Events carry non-team names (R2) | MET | test | `event-names.ts:296-297,316` + event-names suite green (fresh); no `team.` name in the catalog. |
| AC3 — No team runtime vocabulary remains (R3, R4, R5) | MET | command | Fresh rg lens → zero hits; `team_id` column + index unchanged (`packages/domain/src/migrations.ts:901,918`); full `bun run spur-check` / `test-cf` / `build` evidence captured once batch-wide for the merged G65 tree (see verifyall batch report). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Feature: [G65 — fleet declaration in spur config](../../features/G65_fleet-declaration-in-spur-config.md)
- Design: [docs/design/fleet-config-declaration.md](../../design/fleet-config-declaration.md)
- ADR-116 (project-scoped fleet composition), ADR-057 (inter-agent control plane)
- Governance: [docs/design/harness-surface-governance.md](../../design/harness-surface-governance.md)

### History

- 2026-09-15T16:05:58.839Z todo → wip (system)
- 2026-09-15T17:13:40.313Z wip → testing (system)
- 2026-09-15T17:13:41.790Z testing → done (system)

