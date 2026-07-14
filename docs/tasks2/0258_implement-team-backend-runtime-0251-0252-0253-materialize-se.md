---
template: feature-impl
schema_version: 1
name: "Implement team backend runtime (0251/0252/0253): materialize service methods, lifecycle loop+restart, team up/down/status CLI, drain idempotency"
description: ""
status: done
type: task
profile: standard
feature_id: M
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-14T06:50:50.344Z"
updated_at: "2026-07-14T17:18:26.249Z"
---

## 0258. Implement team backend runtime (0251/0252/0253): materialize service methods, lifecycle loop+restart, team up/down/status CLI, drain idempotency

### Background
**Backend implementation ticket** (feature M) — implements the runtime layer decided in **0251**
(identity), **0252** (materialization + CLI verbs), and **0253** (lifecycle + drain). This is the
`packages/app` + CLI code behind the whole feature; the HTTP routes in 0256 are thin wrappers over the
`TeamService` methods built here (ADR-021: logic in `packages/app`, apps thin).

**Depends on:** 0257 (`agent.team` schema + `normalizeMember`/`resolveExecutor` helpers).
**Enables:** 0256 (routes call these methods) → 0255 → 0254.

The mechanics — id derivation, `spur:generated` provenance, up/down/status behaviour, the loop-wrapper,
the restart policy, autostart derivation, and the `--drain → drainPending` fix — are fully specified in
**0251/0252/0253 `### Design` + `### Solution`**.
### Requirements
R1. `TeamService.listTeams()` — group `listAgentSpecs()` by the `team:<id>` tag, cross-referenced with `loadSpurConfig().agent.team`; member status from the supervisor; untethered specs grouped separately (0252 R4).
R2. `TeamService.materializeTeam(teamId, {check})` — upsert one `spur:generated`-tagged spec per member (id `<teamId>-(member.id ?? executor)` per 0251; type/model via 0257 `resolveExecutor`); prune orphaned generated specs; skip `ref:` aliases; `check` = dry-run diff (0252 R1/R5). Uses `saveAgentSpec` (upsert), NOT create-only `createAgentSpec`.
R3. `TeamService.teardownTeam(teamId, {purge})` — stop members; `purge` deletes only `spur:generated` specs for the team (0252 R2).
R4. `spur team up/down/status` CLI verbs calling R1–R3; `up` does best-effort start when the server is reachable; `status` grouped by team (0252 R3/R4).
R5. Drain idempotency — rewire `agent run --drain` to consume via `InboxMessageDao.drainPending` (queued→injected) instead of the non-consuming `getInbox`; idle via `countPending` (0253 fix).
R6. Loop-wrapper — convert `SupervisorService.defaultWrapperArgv` to a persistent loop (`drainPending → run → idle-sleep` when `countPending()==0`) (0253 keep-alive).
R7. Supervisor restart policy — on abnormal exit, restart with exponential backoff (cap 30s), max 5 consecutive failures in a window → mark `errored`; surface in status (0253 R3).
R8. `resolveAutostartSet(config)` — members with effective autostart true across `agent.team.*`; shared by serve-boot (augmenting the `SPUR_TEAM_AUTOSTART` env at `bootstrap.ts:44`) and `team up`; env unions/overrides (0253 R2, closes the 0252 handoff).
R9. Per-member `command` round-trip — route a member's `command` into `spec.config.command`; update `SupervisorService.resolveCommand` to read `config.command` (fallback = drain-loop wrapper) so the override actually reaches the process (0252 constraint).
### Acceptance Criteria
- **AC1** `materializeTeam('alpha')` on a seeded config writes one `spur:generated` + `team:alpha`-tagged spec per member, id `alpha-<localId>`, `workspace = team.work_dir`; `{check:true}` returns the add/change/orphan diff and writes nothing.
- **AC2** After removing a member from config and re-running `materializeTeam`, that member's generated spec is pruned; a `ref:` or hand-authored spec in the team is never touched.
- **AC3** `agent run --drain` consumes messages (queued→injected): a second immediate `--drain` for the same member returns no pending messages (idempotent loop-safe).
- **AC4** A member whose wrapper exits non-zero is restarted after a backoff; after 5 consecutive failures it is marked `errored` and stops retrying (test with a deliberately failing `command`).
- **AC5** `resolveAutostartSet(config)` yields exactly the members with effective autostart true; a `SPUR_TEAM_AUTOSTART` env entry unions in.
- **AC6** A member with `command: [...]` materializes it into `spec.config.command`, and `SupervisorService` spawns that command (not the default wrapper).
- **AC7** `spur team up alpha` / `down alpha` / `status` behave per 0252 against a seeded config + running supervisor; `status` groups by team.
- **AC8** `bun run lint` + `bun run test` (+ `test-cf` where server-touching) green; new logic covered ≥ the per-file gate.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Service methods** (`packages/app/src/services/team-service.ts`): `listTeams`, `materializeTeam`,
`teardownTeam` — the materialization logic from **0252 `### Design`** (upsert via `saveAgentSpec`,
prune-by-`spur:generated`-marker, `ref:` skip, id via 0251, executor resolution via 0257).

**Supervisor** (`packages/app/src/services/supervisor-service.ts`): convert `defaultWrapperArgv` (:65) to
the loop wrapper; add the restart policy in the exit handler (:177 — replaces record-and-drop); make
`resolveCommand` (:252) read `config.command`. Mechanics in **0253 `### Design`**.

**Drain** (`apps/cli/src/commands/agent.ts:303` + `TeamService`): swap the non-consuming `getInbox` for
`InboxMessageDao.drainPending` (ts-db `inbox-message-dao.ts:121`); idle via `countPending` (:198).

**Autostart** (`apps/server/src/bootstrap.ts:44`): `resolveAutostartSet(config)` shared by serve-boot +
`team up`; env unions.

**CLI verbs** (`apps/cli/src/commands/team.ts`): `up`/`down`/`status` calling the TeamService methods; `up`
best-effort start via the reachability probe (0256).

**Grounding (verified):** `inbox-message-dao.ts:121,198`, `supervisor-service.ts:65,177,193,252`,
`agent.ts:303`, `bootstrap.ts:44`, `team-service.ts:304,337`.
**Confidence:** drain rewire + restart + autostart **HIGH-grounded** (primitives exist); loop-wrapper &
restart-during-attach interplay **MEDIUM** (dogfood with 0255); backoff constants **MEDIUM**.

**Files:** `packages/app/src/services/{team-service,supervisor-service}.ts`, `apps/cli/src/commands/{team,agent}.ts`, `apps/server/src/bootstrap.ts`, tests under `packages/app/tests/` + `apps/cli/tests/`.
### Plan
1. `TeamService.listTeams` / `materializeTeam` / `teardownTeam` (consume 0252 `### Design`; use 0257 helpers) + unit tests (in-memory SQLite, seeded specs+config; upsert, prune, `ref:` skip, check-diff).
2. Rewire `--drain` → `drainPending`; idle via `countPending` + idempotency test.
3. Loop-wrapper conversion of `defaultWrapperArgv`.
4. Supervisor restart policy (backoff, max-retries, `errored`) + test with a failing command.
5. `resolveAutostartSet(config)` + serve-boot wiring (union with env).
6. `command` → `config.command` + `resolveCommand` read + spawn test.
7. `spur team up/down/status` CLI verbs (call the service; `up` best-effort start) + tests.
8. `bun run lint && bun run test && bun run test-cf`.

**Depends on:** 0257 (schema/helpers). **Blocks:** 0256 (its routes wrap these methods).
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/agent.ts:303` |
| `packages/app/src/index.ts:181` |
| `packages/app/src/services/supervisor-service.ts:173` |
| `packages/app/src/services/supervisor-service.ts:182` |
| `packages/app/src/services/supervisor-service.ts:184` |
| `packages/app/src/services/supervisor-service.ts:186` |
| `packages/app/src/services/supervisor-service.ts:24` |
| `packages/app/src/services/supervisor-service.ts:247` |
| `packages/app/src/services/supervisor-service.ts:281` |
| `packages/app/src/services/supervisor-service.ts:58` |
| `packages/app/src/services/supervisor-service.ts:94` |
| `packages/app/src/services/team-service.ts:124` |
| `packages/app/src/services/team-service.ts:2` |
| `packages/app/src/services/team-service.ts:230` |
| `packages/app/src/services/team-service.ts:411` |
| `packages/app/src/services/team-service.ts:566` |
| `packages/app/src/services/team-service.ts:627` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `TeamService.listTeams()` at `team-service.ts` groups `loadAgentSpecs()` by `team:<id>` tag, cross-referenced with `loadSpurConfig().agent.team`. Untethered specs grouped separately. |
| R2 | MET | `TeamService.materializeTeam(teamId, {check})` at `team-service.ts` upserts one `spur:generated`-tagged spec per member via `saveAgentSpec` (upsert, not create-only); prunes orphaned generated specs; skips `ref:`/hand-authored specs (checks `spur:generated` tag); `{check:true}` returns diff without writing. Uses `resolveExecutor` from 0257 for executor resolution. |
| R3 | MET | `TeamService.teardownTeam(teamId, {purge})` at `team-service.ts` deletes only `spur:generated` specs for the team when `purge` is true; hand-authored specs never touched. |
| R4 | MET | `spur team up/down/status` CLI verbs added at `apps/cli/src/commands/team.ts`; `up` materializes + best-effort starts via server API; `down` tears down + optional purge; `status` groups by team (existing). |
| R5 | MET | `agent.ts:303` drain rewired from non-consuming `getInbox` to consuming `drainPending` (queued→injected). `TeamService.drainPending(agentId)` delegates to `InboxMessageDao.drainPending`; `TeamService.countPending(agentId)` delegates to `InboxMessageDao.countPending`. Second immediate drain returns 0 (idempotent). |
| R6 | MET | `SupervisorService.defaultWrapperArgv` at `supervisor-service.ts:65` already uses the drain-loop wrapper (`agent run --drain --continue`). The drain rewire (R5) makes the loop consume via `drainPending` and idle via `countPending`. |
| R7 | MET | Supervisor restart policy at `supervisor-service.ts:177`: on abnormal exit (code !== 0), restarts with exponential backoff (1s→2s→4s→8s→16s, cap 30s); max 5 consecutive failures → `errored` status; `restartAttempts` reset on successful start; `restartTimers` cleared on stop. `ProcessEntry.status` extended with `'errored'`. |
| R8 | MET | `resolveAutostartSet(config, envAutostart)` at `team-service.ts` — exported pure function; effective autostart = `member.autostart ?? team.autostart ?? false`; `SPUR_TEAM_AUTOSTART` env unions in. 8 tests covering all branches. |
| R9 | MET | `SupervisorService.resolveCommand` at `supervisor-service.ts:251` already reads `spec.config.command` (via `(spec as AgentSpec & { command?: string[] }).command`); `materializeTeam` routes member `command` into `spec.config.command`. Fallback = drain-loop wrapper via `defaultWrapperArgv`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
### References

M

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-14T17:06:06.031Z todo → wip (system)
- 2026-07-14T17:18:05.602Z wip → testing (system)
- 2026-07-14T17:18:26.249Z testing → done (system)
