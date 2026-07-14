---
template: standard
schema_version: 1
name: "Team API surface: oRPC contracts vs raw Hono/SSE for start/stop/stdin/stream/messages"
description: ""
status: done
type: task
profile: standard
feature_id: M
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-14T04:29:12.104Z"
updated_at: "2026-07-14T22:06:44.301Z"
---

## 0256. Team API surface: oRPC contracts vs raw Hono/SSE for start/stop/stdin/stream/messages

### Background
**Implementation ticket** (feature M) — refined for delegation.

**Decided:** team routes follow the **board convention — raw Hono handlers + web consumes via raw
`fetch` + `EventSource`** (like observability 0243 / messages), NOT oRPC. oRPC stays the planning-CRUD
convention; the live board/streaming surface is raw + SSE (which oRPC can't express anyway). This
ticket stabilizes + extends the team/message API so 0255 (terminal) and 0254 (board) consume a fixed
contract. The backend spine (0250 schema, 0251 identity, 0252 materialize, 0253 lifecycle) is
designed; this exposes it over HTTP.

**Existing raw routes (keep, document):**
- `apps/server/src/modules/team/index.ts` — `GET /api/team/processes`, `POST /api/team/agents/:id/start|stop`, `POST /api/team/processes/:id/stdin`, `GET /api/team/processes/:id/stream` (SSE).
- `apps/server/src/modules/messages/index.ts` — `GET /api/messages/inbox?agent=`, `GET /api/messages`, `POST /api/messages`, `POST /api/messages/:id/reply`.

**New needs from the spine:** team-grouped roster/status (0252 R4), `team up/down` over HTTP (0252),
member `errored` status (0253), a server-reachability probe + server-side batch start (the two LOW
items 0252/0253 surfaced).
### Requirements
R1. Document the existing team + message routes as the board contract (request/response shapes) in `docs/04_DESIGN.md` (T3 same-commit). No behaviour change to start/stop/stdin/stream.
R2. `GET /api/team/teams` — teams → members → status, grouped by the `team:<id>` tag + `agent.team.*` config (0252 R4); each member `{id, type, status: running|stopped|errored|exited, pid?}`; specs with no team tag under an `__untethered__` group.
R3. `POST /api/team/:team/up` — materialize generated specs (0252) + best-effort start of autostart members; `?check=true` returns the add/change/orphan diff and writes nothing. `POST /api/team/:team/down` — stop members; `?purge=true` deletes `spur:generated` specs only.
R4. `GET /api/team/health` — cheap liveness probe for the CLI `team up` best-effort start and the web module's reachability check (the 0252/0253 LOW item).
R5. Server-side batch start: `POST /api/team/:team/up` loops the existing per-agent start over autostart members and returns per-member results — no per-member round-trips from the client (the 0253 batch-start LOW item).
R6. Response envelopes match the existing board routes (`{ data…, count }` + error shape) so the web fetch layer stays uniform. All new routes gated on Bun via the existing `ServerContext` (parity with the current team module); degrade cleanly on Cloudflare Workers.
### Acceptance Criteria
Testable checklist (the implementing agent's "done"; my later review traces to these):

- **AC1** `GET /api/team/teams` on a seeded 2-team config + `team:<id>`-tagged specs returns both teams with members grouped, each carrying `{id,type,status,pid?}`; untethered specs appear under `__untethered__`.
- **AC2** `POST /api/team/alpha/up` materializes `spur:generated` specs, starts autostart members when the supervisor is up, and returns `{materialized:{add,change,orphan}, started:[{id,ok,pid?}]}`. `?check=true` returns the same diff but writes/starts nothing (assert no file writes).
- **AC3** `POST /api/team/alpha/down` stops running members; with `?purge=true` it deletes only `spur:generated` specs (a `ref:`/hand-authored spec survives); returns `{stopped, purged}`.
- **AC4** `GET /api/team/health` returns 200 `{ok:true}` when live; the CLI `team up` uses it to decide best-effort start (assert start skipped when health fails).
- **AC5** `GET /api/team/processes/:id/stream` (SSE) and `POST …/stdin` are unchanged and covered by a regression test (0255 depends on them).
- **AC6** New routes return a not-supported response on the Workers `ServerContext` path (parity with existing team gating); Bun path active.
- **AC7** `docs/04_DESIGN.md` carries the full team/message route table (same commit).
- **AC8** `bun run lint` + `bun run test` (+ `test-cf` for the server) green; new handlers covered.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Convention:** extend the existing raw Hono module `apps/server/src/modules/team/index.ts`; handlers
delegate to app-layer services. No oRPC contracts. Web consumes via `fetchWithTimeout` + `resolveApiUrl`
(`apps/web/src/lib/rpc-client.ts`) and native `EventSource` for the stream.

**App-layer service methods** (`TeamService.listTeams` / `materializeTeam` / `teardownTeam`) are built in
**0258** (backend runtime) per ADR-021 (logic in `packages/app`, apps thin). This ticket adds **thin Hono
routes** that call them — NO materialization/grouping logic lives here. Reachability = a trivial handler.

**Routes (raw Hono):** `GET /api/team/teams`, `POST /api/team/:team/up`, `POST /api/team/:team/down`,
`GET /api/team/health` — added beside the existing start/stop/stdin/stream. Envelope + error shape mirror
`modules/messages/index.ts`.

**Grounding:** existing raw routes at `apps/server/src/modules/team/index.ts` + `modules/messages/index.ts`;
web fetch helpers at `apps/web/src/lib/rpc-client.ts`; materialize/teardown logic specified in 0252 `### Design`.

**Confidence:** route pattern **HIGH** (mirrors existing raw team/messages/observability routes); the
`listTeams`/`materializeTeam`/`teardownTeam` methods this wraps are owned + tested in **0258**.

**Files:** `apps/server/src/modules/team/index.ts`, `packages/app/src/services/team-service.ts`,
`docs/04_DESIGN.md`, + tests under `apps/server/tests/` and `packages/app/tests/`.
### Plan
1. Inventory the existing team + message routes; write the contract table into `docs/04_DESIGN.md`.
2. `GET /api/team/teams` handler wrapping `TeamService.listTeams` (built in 0258) + server test.
3. `POST /api/team/:team/up|down` handlers (`?check` / `?purge`) wrapping `materializeTeam`/`teardownTeam` (0258) + server tests.
4. `GET /api/team/health` handler + test; expose a small client helper for reachability (used by CLI `team up` and the web module).
5. Confirm Workers gating parity; `bun run lint && bun run test && bun run test-cf`.
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/agent.ts:303` |
| `apps/server/src/modules/team/index.ts:192` |
| `packages/app/src/index.ts:172` |
| `packages/app/src/index.ts:177` |
| `packages/app/src/index.ts:182` |
| `packages/app/src/index.ts:184` |
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
**Verify verdict: PASS** (`.spur/run/0256-verdict.json`) — re-verified 2026-07-14 after the operator-approved fix of two deviations (the first re-verify was PARTIAL; the delegated verdict was PASS with `acceptanceCriteria: []`).

All **6 requirements** and **8 AC** MET.

| R | Status | AC | Status |
|---|--------|----|--------|
| R1 docs table | MET | AC1 teams + untethered | MET |
| R2 GET /teams (+untethered) | MET (fixed) | AC2 up materialize+start | MET |
| R3 up/down | MET (fixed) | AC3 down stop+purge | MET |
| R4 GET /health | MET | AC4 health 200 | MET |
| R5 server-side batch start | MET (fixed) | AC5 stream/stdin regression | MET |
| R6 envelope + Bun gate | MET | AC6 Workers 503 | MET · AC7 docs · AC8 suites |

**Fixes this pass:**
- **R2/AC1** — `listTeams` now surfaces specs with no `team:` tag under an `__untethered__` group (+ app test).
- **R3/R5** — `POST /up` starts **autostart members only** (filters via `listAgentSpecs`), not all upserted — aligning the impl with R3/R5, the docs table, and the CLI `team up` (+ stub `listAgentSpecs` + an autostart-skip test).

**Verification:** app+server+cli suites green **except** the pre-existing sandbox `ps` EPERM test (`context.test.ts`, task 0243, untouched). app+server typecheck clean; biome clean. Fix uncommitted in the working tree.
### Review
**Re-review after fix, 2026-07-14.** First re-verify found 2 deviations under a rubber-stamped PASS (`acceptanceCriteria: []`); both resolved on operator request.

| Priority | Finding | Disposition |
| P2 | R2/AC1 — `listTeams` dropped specs with no team tag (no `__untethered__` group). | **FIXED** — untethered group added + test. |
| P2 | R3/R5 — `POST /up` started ALL `materialized.upserted` members, not autostart-only — contradicts R3/R5, the docs table ("best-effort start (R3/R5)"), and the CLI `team up` (which filters autostart). Would start an `autoStart=false` member on explicit `up`. | **FIXED** — filters to autostart members via `listAgentSpecs`; stub + autostart-skip test added. |
| P3 | Delegated self-verify rubber-stamped PASS with empty AC. | Recorded — independent verify is the guard (same pattern as 0258). |

**Residual:** one sandbox-only failure (`ps` EPERM), unrelated. Fix uncommitted in the working tree.
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-14T17:18:57.550Z todo → wip (system)
- 2026-07-14T17:25:00.048Z wip → testing (system)
- 2026-07-14T17:25:05.342Z testing → done (system)
- 2026-07-14T22:01:20.382Z done → wip (system)
- 2026-07-14T22:06:41.790Z wip → testing (system)
- 2026-07-14T22:06:44.301Z testing → done (system)
