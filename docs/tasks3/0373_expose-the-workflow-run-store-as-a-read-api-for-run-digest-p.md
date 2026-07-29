---
template: feature-impl
schema_version: 1
name: "Expose the workflow run store as a read API for run digest, phase progress, and action log"
description: ""
status: done
type: task
profile: standard
feature_id: J3
parent_wbs: null
priority: P0
tags: ["observability", "api", "run-store", "data-plane"]
dependencies: []
created_at: "2026-07-29T00:14:03.040Z"
updated_at: "2026-07-29T04:51:00.045Z"
---

## 0373. Expose the workflow run store as a read API for run digest, phase progress, and action log

### Background

The real record of what a task's pipeline did lives in the run store — `runs` (390 rows), `phase_runs`, `transition_runs`, `action_runs` (501 rows, each with node, kind, status, duration_ms, ok, result_json), and `task_run_links` (412 rows joining WBS to run id). This data is durable, correlated, and already written by CLI-driven runs, unlike the event ledger. It has no HTTP surface at all, and the Board consumes none of it: the server exposes only /api/jobs/stats, /api/observability/*, /api/team/*, /api/events/*, and the task/feature modules. The operator asked for a task digest with progress and log; this run store is the only source that actually has it, and the 2026-07-28 decision selected it as the primary backing for the J4 Tasks tabview.

### Requirements
- [x] R1. Add a runs list endpoint returning run id, workflow name, status, mode, agent, started-at, and completed-at, with paging and status filtering.
- [x] R2. Add a run detail endpoint returning the run's ordered phases with status, its transitions with from/to/trigger, and its actions with node, kind, status, duration, ok, and a trace-safe result summary.
- [x] R3. Add a WBS lookup returning every linked run with its link kind, and an empty list — not an error — for a WBS with no links.
- [x] R4. Return a clean not-found with a reason for an unknown run id; never a partial or fabricated run object.
- [x] R5. Keep the transport thin: query logic belongs in the domain DAOs and the application layer per ADR-021, and apps/server must not import ts-db.
- [x] R6. Apply the same redaction discipline as the event path to any `result_json` content crossing the wire.
- [x] R7. Document the new surface in docs/04_DESIGN.md in the same commit as the code, per the T3 same-commit rule.
### Acceptance Criteria
```gherkin
Scenario: R22 — Runs are listable with their status and workflow
Scenario: R23 — A run's phases, transitions, and actions are readable as one detail view
Scenario: R24 — A task's runs are reachable by WBS
Scenario: R25 — Run detail for an unknown run id is a clean not-found
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach.** Thin HTTP module over a new application `RunStoreService` that composes existing domain DAOs (`RunDao`, `PhaseRunDao`, `TransitionRunDao`, `ActionRunDao`, `TaskRunLinkDao`). No new tables; no `ts-db` import in `apps/server` (ADR-021 / R5).

**Surfaces.**
- `GET /api/runs` — list with `status`, `limit` (default 50 / max 200), opaque keyset `cursor` on `(started_at DESC, id DESC)`.
- `GET /api/runs/:runId` — digest + ordered phases / transitions / actions; unknown id → 404 `{ error, code: RUN_NOT_FOUND, runId }`.
- `GET /api/runs/by-wbs/:wbs` — every `task_run_links` row with link kind + run digest; empty list (not error) when none.

**Redaction (R6).** `result_json` never crosses the wire raw. `summarizeActionResult` applies the same SECRET_PATTERN + sensitive-key blanking + field length bound as the event-path normalizer, projecting a `resultSummary` on each action.

**Invariants.**
- Unknown run id never yields a partial or fabricated object.
- Malformed list cursor → 400, never silent page-1 fallback.
- DAO SQL stays in domain; redaction + composition in app; HTTP mapping only in server.

**Impacted.** `packages/domain` (RunDao agent + keyset), `packages/app` (RunStoreService), `apps/server` (runs module + context wiring), `docs/04_DESIGN.md` (T3).
### Plan
1. Extend `RunDao.traceRows` / `traceRowById` with `agent` and exclusive keyset `before`.
2. Add `RunStoreService` (list / getDetail / listByWbs + cursor + result redaction) and export from `@gobing-ai/spur-app`.
3. Add `runsModule` (`GET /api/runs`, `/api/runs/by-wbs/:wbs`, `/api/runs/:runId`), wire `runStoreService()` on `ServerContext`, register in builtins.
4. Tests: domain keyset/agent, app service AC R1–R6, server HTTP 200/400/404.
5. Document the surface in `docs/04_DESIGN.md` (T3 same-commit).
6. Write `## Solution` change-map.
### Solution
**Change map**

| File:line | What / why |
| --- | --- |
| `packages/domain/src/dao/run-dao.ts:38` | `traceRows` / `traceRowById` project `agent` and accept exclusive keyset `before` (`started_at DESC, id DESC`) for list paging. |
| `packages/app/src/services/run-store-service.ts:258` | New `RunStoreService`: `list`, `getDetail`, `listByWbs`; cursor encode/decode; `summarizeActionResult` applies event-path SECRET_PATTERN + sensitive-key blanking (R6). |
| `packages/app/src/index.ts` | Public exports for the service, types, and cursor helpers. |
| `apps/server/src/modules/runs/index.ts:19` | Thin Hono `runsModule`: `GET /api/runs`, `/api/runs/by-wbs/:wbs`, `/api/runs/:runId` — transport only, no SQL / no ts-db (R5). |
| `apps/server/src/context.ts:492` | Lazy `runStoreService()` on `ServerContext`. |
| `apps/server/src/modules/registry.ts` | Register `runs` in builtins. |
| `docs/04_DESIGN.md:1133` | Document the run-store read API (T3 same-commit). |
| Tests | `packages/domain/tests/dao/run-dao.test.ts`, `packages/app/tests/services/run-store-service.test.ts`, `apps/server/tests/modules/runs/index.test.ts`, registry name list. |

**Rationale.** The run store is the only durable pipeline digest; the Board had no HTTP path to it. Layering follows ADR-021: DAOs own SQL, the app service owns composition + redaction, the server module maps HTTP only. Keyset paging mirrors the 0372 events/history pattern.
### Testing
**Forced verifyall result: PASS**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/domain/src/dao/run-dao.ts:38-77`; `packages/app/tests/services/run-store-service.test.ts:136`; `packages/domain/tests/dao/run-dao.test.ts:173` |
| R2 | MET | `packages/app/src/services/run-store-service.ts:289-328`; `packages/app/tests/services/run-store-service.test.ts:185-234` |
| R3 | MET | `packages/app/src/services/run-store-service.ts:333-356`; `packages/app/tests/services/run-store-service.test.ts:251-295` |
| R4 | MET | `apps/server/src/modules/runs/index.ts:62-78`; `apps/server/tests/modules/runs/index.test.ts:114-132` |
| R5 | MET | thin server module and application-service composition at `packages/app/src/services/run-store-service.ts:246-253` |
| R6 | MET | `packages/app/src/services/run-store-service.ts:191-222,322`; `packages/app/tests/services/run-store-service.test.ts:46-101,185-234` |
| R7 | MET | `docs/04_DESIGN.md:1143-1171` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R22 — Runs are listable with their status and workflow | MET | test | `packages/app/tests/services/run-store-service.test.ts:136-183`; `packages/domain/tests/dao/run-dao.test.ts:173-201` |
| R23 — A run's phases, transitions, and actions are readable as one detail view | MET | test | `packages/app/tests/services/run-store-service.test.ts:185-234` |
| R24 — A task's runs are reachable by WBS | MET | test | `packages/app/tests/services/run-store-service.test.ts:251-295`; `apps/server/tests/modules/runs/index.test.ts:134-161` |
| R25 — Run detail for an unknown run id is a clean not-found | MET | test | `packages/app/tests/services/run-store-service.test.ts:237-249`; `apps/server/tests/modules/runs/index.test.ts:114-132` |

**Fresh command:** `bun run test` → 3,878 pass, 0 fail, 11,951 assertions; exit 0.

**Coverage:** root per-file line/function ≥90% gate passed.

**SECUA:** no blocker/major after fix. `resultSummary` receives configured secret values and recursively redacts/bounds every string; bounded WBS N+1 remains advisory.

**Fix-pass disclosure:** `packages/app/src/services/run-store-service.ts:191-222,322`, `apps/server/src/context.ts:492-497`, regression tests, `docs/04_DESIGN.md:1143-1171`, and `.spur/run/0373-verdict.json:1-80` were regenerated/re-verified.
### Review
**Disposition:** APPROVE · Functional PASS · SECUA no blocker/major · architecture advisory only.

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | E | `packages/app/src/services/run-store-service.ts:348-356` | `listByWbs` does sequential `traceRowById` per link (N+1). Acceptable under default limit 50 / max 200; batch-by-id if WBS fan-out becomes hot. |
| P4 | A | `run-store-service.ts:17-23` vs `event-names.ts:251-264` | SECRET_PATTERN / sensitive-key set re-declared vs event path — same discipline today; extract shared wire-redact helper if either path evolves. |
| P4 | S | `run-store-service.ts:195-228` + `runs/index.ts:62-74` | `result_json` never raw on wire; SECRET_PATTERN + sensitive-key blanking + 256 bound; unknown id → clean 404 `RUN_NOT_FOUND` (no partial object). |
| P4 | C | `run-store-service.ts:141-174` + `runs/index.ts:40-44` | Malformed list cursor → 400 `MALFORMED_CURSOR`, never silent page-1 fallback. |
| P4 | tests-pass | task surfaces | `bun test` domain+app+server: 42 pass / 0 fail (2026-07-28 verify run). |

**Functional:** R1–R7 MET · AC R22–R25 MET. **Design:** DONE (thin Hono + RunStoreService + DAO keyset + DESIGN.md). **Gate:** clear approve; residual risks non-blocking.
### References

J3

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-29T04:01:00.719Z todo → wip (system)
- 2026-07-29T04:05:47.569Z wip → testing (system)
- 2026-07-29T04:12:04.886Z testing → done (system)
