# G6 runtime inventory — project fleet identity, delivery, and legacy migration

Task 0828 · report only (no production change) · consumed by 0829 (rest/GTD dispatch prototypes) and 0830 (Projects conversation/agents/work/global-input prototypes).
Frozen sections: **Provenance · Runtime path · Fault probes · Migration matrix · Handoff**.

## 1. Provenance

| Fact | Value | Source |
| --- | --- | --- |
| Tree | worktree `spur-new-runall-g6-d77b`, HEAD `6070879e8` ("docs(tasks): refine G6 prototype tasks 0829/0830 to ready depth") | `git log --oneline -1` |
| ts-db (installed) | `0.4.62`, resolved via store link `~/.bun/@gobing-ai+ts-db@0.4.62+39fe09901e9c1f39` | `node_modules/@gobing-ai/ts-db/package.json`; `apps/cli/package.json:32` `^0.4.62` |
| ts-ai-runner (installed) | `0.4.62` | `node_modules/@gobing-ai/ts-ai-runner/package.json`; manifest catalog pin |
| spur CLI used for corpus writes | source-local `bun apps/cli/src/index.ts … --json` | task 0828 directive |
| Approvals governing direction | Robin approval 2026-09-11; ADR-022/037/052/057/058 still govern production behavior | docs/features/G6_…design.md, docs/00_ADR.md |
| Role vocabulary SSOT | closed `['scribe','coder','reviewer','planner']`; `orchestrator` is NOT an accepted role id | packages/config/src/index.ts:153–156 (`AGENT_ROLE_NAMES`); config layer `agent.roles` is the ADR-078 SSOT |
| Board global bar | stub: submit clears field + honesty notice, no dispatch | apps/web/src/components/GlobalAgentBar.tsx:36–39, 69 |

Evidence classification used below: **[S]** = source read; **[T]** = runnable test/probe (path given); **[N]** = assertion from reading, not a live probe.

## 2. Runtime path (R1)

### 2.1 Project registry → config/spec

| Hop | Owner | Identity/context carrier | Notes |
| --- | --- | --- | --- |
| Registry file | `~/.config/spur/projects.json`, schema `projectEntrySchema {name,path,port}` | `SPUR_PROJECTS_FILE` env override | packages/config/src/projects.ts:10–36 [S] |
| Registry service | `ProjectRegistry` (`packages/app/src/services/project-registry.ts:147`) — upsert/list/setPort/allocatePort(3000–3999)/healStale, advisory mkdir lock | cwd-independent, host-global | project-registry.ts:187–219, 367–405, 407–445 [S] |
| Serve launch | `startRegisteredProject` spawns detached `spur serve --cwd <projectPath>` via ProcessExecutor `nohup … &`, then polls the port | project path is pinned at spawn as serve cwd | project-start … in packages/app/src/services/project-start.ts:169–268 [S] |
| Per-project config | merged global+project `SpurConfig` threaded on contexts (A5/ADR-082) — no per-slice load | transport: `TeamServiceContext.spurConfig` / `reloadAgentConfig` (0799 R3) | packages/app/src/services/team-service.ts:67–72, 688–694 [S] |
| Spec files | `.spur/agents/<id>.yaml` via `saveAgentSpec`/`loadAgentSpecs` (ts-ai-runner 0.4.62) | spec `id` = `teamId-<memberLocalId>`, tags `team:<id>`+`spur:generated` | team-service.ts:92–94, 543–660 [S] |
| Team materialization | `materializeTeam` — executor pin authoritative; role-only member resolves via shared tier ladder (cheapest eligible executor); records `executor` + `config.role` on the spec | duplicate members disambiguate via frozen-index `memberLocalId` `<role>-<n>`; roster order is config-array order, index-frozen | team-service.ts:687–727, 745–790 [S] |

### 2.2 Supervisor

| Hop | Owner | Notes |
| --- | --- | --- |
| Executor | `SupervisorService` (`packages/app/src/services/supervisor-service.ts:142`) over injected `ProcessExecutor` (`runStreaming`) | fake-able seam used by probes [S] |
| Spawn command | `config.command` wins; else default wrapper `process.execPath apps/cli/src/index.ts agent loop --spec <id>` (0258/0542) | supervisor-service.ts:85–95, 428–446 [S] |
| Identity env | injects `SPUR_SPEC_ID`, `SPUR_TEAM_ID` (first `team:` tag), fresh `SPUR_RUN_ID` (process generation), `SPUR_SERVE_URL` pass-through into the child env | supervisor-service.ts:207–224 [S] |
| Restart | abnormal exit → bounded backoff [1000,2000,4000,8000,16000], max 5 attempts → `errored` | supervisor-service.ts:91–92, 288–322 [S] |
| Events | `process.spawned/exited/stopped` + `team.member.started/stopped` (dedup vs explicit stop via `teamMemberStopEmitted`) | supervisor-service.ts:71–109, 229–253, 269–318 [S] |
| Loop | `runAgentLoop` drains via `drainPending` each iteration; non-empty → `svc.run`; empty → idle sleep `--poll` (default 2000 ms); abort-exits cleanly | apps/cli/src/commands/agent.ts:706–745 [S] |

### 2.3 CLI / HTTP / Board / plugin entry points (R1 "every entry point")

- CLI `spur agent`: run/loop/wait/create/edit/delete/list/doctor — apps/cli/src/commands/agent.ts:30–213 [S].
- CLI `spur message`: send/inbox/reply/watch — apps/cli/src/commands/message.ts:26–124 [S].
- CLI `spur team`: assign/status/up/down/start/stop — apps/cli/src/commands/team.ts:42–101 [S]; CLI `spur projects`: add/remove/list/start/stop — apps/cli/src/commands/projects.ts:13–188 [S]; CLI `spur serve` — apps/cli/src/commands/serve.ts [S].
- HTTP server (`apps/server/src`): `/api/messages` GET/POST + `/api/messages/:id/reply` (apps/server/src/modules/messages/index.ts:26–71) and `/api/messages/inbox`; `/api/team/*` start/stop/stdin/stream/teams/up/down/health (apps/server/src/modules/team/index.ts:41–304); `/api/project`, `/api/projects`, `/api/projects/start` project-identity/start proxies (apps/server/src/modules/health/index.ts:45–100). Server context composes TeamService + SupervisorService over `cwd` + `dbUrl=join(cwd, DEFAULT_DATABASE_URL)` (apps/server/src/context.ts:326–334, 354–360) [S].
- Board web: `GlobalAgentBar` (stub, no dispatch) — apps/web/src/components/GlobalAgentBar.tsx:36–39; `ProjectSwitcher` GET `/api/projects` + POST start — apps/web/src/components/ProjectSwitcher.tsx:24–80; Inbox/Teams shells — apps/web/src/modules/inbox/InboxShell.tsx, modules/teams/TeamsShell.tsx [S].
- Plugins/agents/hooks: `plugins/sp/commands/*` select inline execution or a subprocess executor through the skill-level `--agent <inline|auto|name>` contract (e.g. plugins/sp/commands/dev-arch.md:4,18) — plugin dispatch routes through the SAME closed role vocabulary and `--agent` selector; subagent fan-outs inherit `SPUR_ROLE` (agent-service.ts:1721) [S].

### 2.4 cwd / DB isolation

- CLI: `createCliContext` materializes `cwd = resolve(options.cwd ?? process.cwd())` and a cwd-rooted `FileSystem`; db URL = explicit `dbUrl` ?? `DATABASE_URL` ?? `join(cwd, '.spur/spur.db')` (apps/cli/src/context.ts:158–204, 244–250) [S].
- Server: cwd from `serve --cwd` (or process.cwd()), DB `join(cwd, .spur/spur.db)`; a per-project DB per registered serve (apps/server/src/context.ts:326–334) [S].
- Team workspace ≠ project cwd: a team `work_dir` may point anywhere; member specs carry `spec.workspace` drained runs execute the coding agent in cwd resolved by the runner, while message-DB identity is the SERVING project's DB — cross-workspace teams share one inbox DB but not one filesystem [N; unmet invariant in Handoff].
- Ports/registry are host-global, not project-scoped; `healStale` resets ports of dead listeners (project-registry.ts:407–445) [S].

### 2.5 Role propagation & vocabulary

- Config layer SSOT `agent.roles`, validated to the closed vocabulary at load; fallback `DEFAULT_AGENT_ROLES` (packages/config/src/index.ts:148–196). `orchestrator` fails config validation (enum at index.ts:379–382) — adding it requires a later production role-table change [S].
- Role-only dispatch paths merge config roles at the CLI boundary (`resolveAgentRoles`, apps/cli/src/context.ts:50–96) [S].
- Child propagation: `RolePropagatingProcessExecutor` injects `SPUR_ROLE` into every spawned subprocess env (agent-service.ts:372–388); inheritance read back from `ctx.env.SPUR_ROLE` (agent-service.ts:2165–2170) [S].

### 2.6 Mailbox identity

- Message rows: `inbox_messages(id uuid, from_id, to_id, body, status queued|injected|delivered, in_reply_to, inject_attempts, delivered_at)` — ts-db 0.4.62 `InboxMessageDao` (node_modules/@gobing-ai/ts-db/dist/inbox-message-dao.d.ts:59–75) [S].
- Addressing is syntactic-only (`validateAgentId`); recipient existence NOT required; composition `teamId-memberId` (team-service.ts:316–345) [S].
- Lifecycle events `message.enqueued/injected/delivered/failed` are DAO events; the `system_events` ledger tap records only `message.sent|replied` metadata (team-service.ts:316–345, 55–110) [S]. **The CLI probe has no event bus, so it proves absence only on that path** (probe 6); server-wired `message.sent/replied` events remain observable (`packages/app/src/services/team-service.ts:915`).

### 2.7 Occupant replacement

- Occupant pin persisted per spec-addressed run: `CoordinationRunDao` row `specId+runId+generation`, `generation = maxGeneration(specId)+1` — monotonic per spec (agent-service.ts:1088–1105) [S].
- Identity carriers into children: `SPUR_SPEC_ID`/`SPUR_TEAM_ID`/`SPUR_RUN_ID` (supervisor) + `--spec <id>` flag → `spec-id` flag → `drainIntoPrompt` before `svc.run` (apps/cli/src/commands/agent.ts:491–505, 543–600) [S].
- Wait contract: `OccupantPin{specId,runId,generation}` snapshot-then-follow over `system_events` via `followSystemEventsAfter` (packages/app/src/services/occupant-wait.ts:229–276, 63; system-event-follow.ts:46–63): fails `run_replaced` on runId change or `generation` bump, `occupant_gone` on vanish, then stall/timeout (occupant-wait.ts:247–261) [S|T probe 5].

## 3. Fault probes (R2)

Common isolation statement: all probes run with explicit fake dependencies (`runner.runPromptCommand` fakes — no external executor reachable, zero real spawns asserted by the fake transport), in-memory SQLite via existing test seams, `createCliContext` with a task-owned tmp cwd + `:memory:` dbUrl (apps/cli/tests/commands/agent-team.test.ts:13–20). Probes live in clearly marked **G6 characterization (0828)** blocks:
apps/cli/tests/commands/agent-team.test.ts:611–819 (five probes) and packages/app/tests/services/occupant-wait.test.ts:283–325 (probe 5). Command: `cd apps/cli && bun test tests/commands/agent-team.test.ts`; `cd packages/app && bun test tests/services/occupant-wait.test.ts`.

| # | Category | Setup / fault injected | Observed behavior | Target invariant |
| --- | --- | --- | --- | --- |
| 1 | Drain-before-spawn | Seed 1 queued msg; `runAgentRun --drain` with fake runner recording `countPending` at invocation entry | Invocation runs the drained body; pending = 0 already inside the invocation — rows flipped `queued→injected` BEFORE spawn (agent.ts:543–600 called ahead of `svc.run`, agent.ts:491–495) | UNMET: delivery finalized before invocation is verifiable; a spawn failure commits consumption first [T] |
| 2 | Nonzero/throwing invocation | Fake runner throws or returns exit 7 (`agent-service.ts:1273–1297` catch) → `svc.run` returns exitCode 2 → `runAgentLoop` discards it (agent.ts:736); loop iterates on | Loop resolves 0, batched stderr only; row stays `injected`; re-drain empty. No requeue/failed-marking seam | UNMET: no durable recovery path; loss is silent to long-lived loops [T] |
| 3 | Duplicate submission | Two identical bodies enqueued via `InboxMessageDao.enqueue` (ts-db 0.4.62, per-send `crypto.randomUUID`, inbox-message-dao.js:21–43) | 2 distinct msgIds, both queued, both deliver in one drain | UNMET: no idempotency/dedup key — a retried send duplicates the payload [T] |
| 4 | Competing consumers | Two `TeamService` instances over one shared adapter; concurrent `drainPending` | At-most-once per row: disjoint claim sets, `injectAttempts==1` (conditional `UPDATE … WHERE status='queued' … RETURNING`, single statement) | MET on the SQLite seam; residual: statement-atomicity only, no cross-process lease/leader primitive [T] |
| 5 | Stale-generation wait | Waiter pins run R gen 1; occupant replaced by run S gen 2 afterwards | Typed failure `run_replaced` (`generation 1 → 2`, occupant-wait.ts:247–261); successor observable via `getOccupant` | UNMET: failure carries no successor link or retarget primitive; caller must blind-re-snapshot [T] |
| 6 | Completion-without-notification | Successful `--drain` run; notification sink suppressed by inspection (none exists) | Message stuck `injected` forever (`markDelivered` never called); zero queried DAO delivery-event rows in this CLI probe; no completion message to sender; nothing in `system_events` connects the runId to any message id | ABSENT (seam named): `AgentService.executeRun` persists result + occupant exit pin (agent-service.ts:1434–1444) but has no completion-notification sink into `InboxMessageDao`; no durable run↔message association exists [T] |

Duplicate submission (3) and duplicate consumption (4) are asserted separately, per the probe contract. No receipt table was manufactured.

## 4. Migration matrix (R3) — preserve / convert / retire

Dispositions are **inventory facts + constraints, not cutover policy**; cutover window belongs to Robin (deferred in task Q&A). Related records resolved via Spur (`feature show <id> --json`; filePaths used, no folder search): G4 "Inter-agent control plane" (verifying, docs/features/G4_inter-agent-control-plane.md), M3 "Teams board continuous UX fine-tune" (verifying, docs/features/M3_…), M6 "Workspace Overview removal and Inbox/Teams supervisor-label split" (backlog, docs/features/M6_…), K1 "Project switcher" (done, docs/features/K1_…), K2 "Project runtime robustness: port-probe error classification and bind-free test seams" (done, docs/features/K2_…), A7 "Spur Board layout optimization and global orchestrator agent interface" (done, docs/features/A7_…).

| Existing surface / identity | Current owner & callers | Target owner | Disposition | Conflict / rollback note |
| --- | --- | --- | --- | --- |
| Team config (`agent.team.<id>`, members by role/executor, work_dir, autostart) | config layer + `TeamService.materializeTeam` (687–757), `resolveAutostartSet` (team-service.ts:1000–1024) | G6 project-scoped fleet (0830) | **Convert** — schema is role+executor+workspace; carries to projects; keep SSOT semantics | Rollback = keep config block valid under current schema; conversion must not rename keys before the new surface exists [S] |
| Generated specs (`spur:generated`, `<team>-<role>-<n>`) | TeamService upsert/prune (745–790, 1090–1116); supervisor `loadSpecs`; loops address them by spec id | V1 fleet instances | **Convert with stable-ID preservation** — spec id IS the mailbox identity (`teamId-memberId`) and occupant address; breaking it orphans inbox rows + coordination rows | IDs must be preserved verbatim; a rename must ship a mailbox alias or a migration. Rollback: purged generated specs are re-materializable from config (reversible) [S] |
| Manual specs (`reporter`, `__untethered__` group, no team tag) | TeamService lists/stops them; supervisor can start them | Keep as external/ephemeral instances | **Preserve** manual, **retire** the synthetic `__untethered__` display group only after a new identity surface exists | `teardownTeam` never deletes non-generated specs; hand-authored specs must survive any purge [S] |
| Orphan specs (team tag without config entry) | `listTeams` synthetic orphans (612–640) | Fleet migration must resolve vs config | **Convert** (re-link) or **retire** if config no longer declares the team | Conflict: spec tag present + `agent.team.<id>` absent; rollback constraint: no deletion without the new project config being authoritative [S] |
| Duplicate roles in a team (e.g. two coders) | frozen-index `memberLocalId` `<role>-<n>` (745–748) | G6 role-instance fleet | **Convert** — `n` suffix derivation must remain deterministic over roster order | Reordering roster re-allocates ids ⇒ identity-rewrite hazard; rollback impossible after ids change without alias table — hence preserve-current-spec-IDs rule for V1 [S] |
| Conflicting worktree paths (team work_dir ≠ project path; spec.workspace disagreement) | `resolveWorkspaceDir`/`commonWorkspace` (994–1013, team-service.ts:612–666) | project-registered worktrees | **Convert**: project entries become the sole workspace source; **retire** free-form spec workspaces | Conflict condition unchanged: work_dir mismatch silently imports foreign code into a run; rollback: registry upsert is additive [S] |
| Legacy CLI surface `--agent <spec-id>` (warn-once shim) | `agent run/loop` (agent.ts:560–624, `agent-flag-spec-id`) | `--spec <id>` canonical | **Retire** after no usage in `.spur/workflows/`/plugins | Shim removal is reversible only by restoring both call sites; verify plugin commands first [S] |
| Legacy HTTP routes | `/api/team/*`, `/api/messages*` (apps/server/src/modules) + board callsites | new control-plane routes (0829/0830) | **Preserve** during V1; **convert** board callsites; **retire** unused ones after | Rollback = keep both route families served from the same service methods (they already share TeamService/SupervisorService) [S] |
| Workspace schema consumers (`inbox_messages`, `coordination_runs`, `system_events` via ts-db 0.4.62 embedded migrations) | TeamService + AgentService + occupant-wait/Board SSE | same DB, new fleet tables | **Preserve** schema; additively extend | No destructive migration before cutover; rollback = additive-only migrations [S] |
| Unfinished related work: G4 (verifying) delivery/wait primitives; M3 (verifying) Teams UX; M6 (backlog) Overview removal; A7 stub bar (GlobalAgentBar.tsx:36–39) | feature owners | absorbed by G6 prototypes | **Preserve** task records; do not re-status | Matrix treats them as inventory facts — cutover policy unchosen [S] |

## 5. Handoff (R4)

### 5.1 Existing primitives (evidence)

| Primitive | Evidence |
| --- | --- |
| Durable inbox queue with at-most-once claim, attempts counter, reply threading | ts-db 0.4.62 `InboxMessageDao.enqueue/drainPending/markDelivered/markFailed` [S]; probe 4 [T] |
| Identity-pinned wait with typed failures + shared ledger follow | occupant-wait.ts:136–276; system-event-follow.ts:1–63; occupant-wait.test.ts [T] |
| Occupant registry per specId with monotonic generation | agent-service.ts:1088–1105, 2222–2244 [S] |
| Process supervision, restart backoff, ring buffer, identity stamps | supervisor-service.ts [S] |
| Role ladder/executor resolution shared by `--agent` and team members | agent-service.ts:316–352; team-service.ts:745–790 [S] |
| Project registry + detached serve launch + port heal | project-registry.ts / project-start.ts / health module [S] |

### 5.2 Absent primitives (probes, delivery/identity/wakeup limits for 0829)

1. **No durable completion→message association** — notifying any consumer of a completed run from the run itself (probe 6). Any 0829 waking/resting design needing "run finished → message X" must add that seam or work from `system_events` only.
2. **No redelivery/recovery on failed invocation** — `markFailed` exists in the DAO but no code path calls it from the drain/run path (probe 2) [N + T].
3. **No commit-after-confirm delivery** — drain finalizes before spawn (probe 1).
4. **No idempotent/dedup message identity** (probe 3).
5. **No per-process lease/leader or shared generation across supervisor restarts** — generation is per-spec monotonic in one DB but a restarted supervisor mints a fresh `SPUR_RUN_ID` per child generation without linking to the previous child's run (supervisor-service.ts:212–216 `SPUR_RUN_ID: crypto.randomUUID()`) [S]. Shared-generation refinement explicitly deferred (agent-service.ts:1080–1084).
6. **No orchestrator role value** (closed vocabulary, index.ts:153) — prototypes must bind orchestrator explicitly to a planner-role instance; a real role value is a later production change.
7. **No cross-project message plane** — inbox identity lives in one project's DB; the host-global registry carries no agent identity (2.4) [N].

### 5.3 Proposed extensions (ownership + reverse-cutover constraints)

| Proposal | Owning package | Constraint |
| --- | --- | --- |
| Completion-receipt linking (runId ↔ msgId column or receipt row) | `@gobing-ai/ts-db` (additive) + `packages/app` sink at executeRun exit | additive schema; rollback = sink behind a config flag defaulting off |
| Delivery confirm-after-run (move queued→injected after accepted invocation; markDelivered on success / markFailed on failure) | `apps/cli` drain path (agent.ts) — no ts-db change |
| Waiter retarget/resubscribe on `run_replaced` (carry successor runId in the error) | `packages/app` occupant-wait.ts | tolerant: old callers ignore the extra field |
| Explicit orchestrator binding (planner-role instance with `purpose: 'orchestrator'`) | prototypes (0829/0830) only — zero production surface change |
| Idempotency key on send (caller-supplied id) | `@gobing-ai/ts-db` | additive; no dedup semantics change by default |

Deferred decisions (owner: Robin / later production design): breaking cutover window for spec-id renaming, role-value production change, any destructive schema migration. Preserved-spec-ID rule holds through V1.

### 5.4 0830 input — observable state meanings & retained-controls mapping

| Observable | Meaning today |
| --- | --- |
| `inbox_messages.status` | `queued` = reachable; `injected` = consumed by a drain (run may or may not have succeeded — NOT "delivered"); `delivered` = `markDelivered` (unused today); `delivered_at`/`inject_attempts` informational |
| `coordination_runs` rows | per-run occupant pin; latest row per specId = current occupant; `generation` is monotonic per spec, NOT shared across supervisor children |
| `agent.invoke.start/exit` | occupancy projection: latest start = `working`; latest exit ⇒ `idle` iff `countPending==0`, else `unknown`; `blocked` has no first-class signal (occupant-wait.ts:18–79) |
| `team.member.started/stopped` vs `process.*` | member events are the Board Activity filter surface; both are produced by SupervisorService and bridged from TeamOrchestrator (team-service.ts:980–1000); dedup only vs explicit stop() |
| Projects registry `port` | 0 = stopped/unknown; >0 = last-known listener port (self-healing on staleness) |
| GlobalAgentBar notice | honest stub; 0830 models dispatch only in an isolated prototype (GlobalAgentBar.tsx:36–39) |
| Retained controls mapping for 0830 | Board routes keep `/api/messages*`, `/api/team/*`, `/api/projects*` (server modules above); CLI verbs `agent run/loop/wait`, `message send/inbox/reply/watch`, `team up/down/start/stop/assign`, `projects add/list/start/stop` are the retained controls the prototypes must not silently rewire |


## Verification corrections — 2026-09-12

The invocation probes now assert exactly one fake runner call; the failure probe covers both a throw and a returned nonzero exit. Duplicate submission asserts both distinct IDs and consumption of both queued rows. Competing consumers remain a shared-adapter characterization, not a cross-process lease test. The notification probe has no sink to disable and no event bus; it does not disprove server message events. Plugin `--agent` is a skill execution selector, not a literal `spur agent --agent` command.
