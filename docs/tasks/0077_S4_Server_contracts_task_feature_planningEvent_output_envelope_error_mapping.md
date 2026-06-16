---
name: "S4: Server contracts (task + feature + planningEvent) + output envelope + error mapping"
description: "S4: Server contracts (task + feature + planningEvent) + output envelope + error mapping"
status: Done
created_at: 2026-06-15T16:56:10.090Z
updated_at: 2026-06-16T16:49:05.893Z
folder: docs/tasks
type: task
feature-id: S4
priority: P1
estimated_hours: 12
tags: ["server-side-adjustment","wave-S1","group-S"]
impl_progress:
  planning: completed
  design: completed
  implementation: completed
  review: completed
  testing: completed
---

## 0077. "S4: Server contracts (task + feature + planningEvent) + output envelope + error mapping"

### Background

The type seam (ADR-005). Server handlers bind via implement(contract); the web client consumes via OpenAPILink; contract<->handler drift is a compile error. Contracts are TRANSPORT DTOs ONLY (ADR-005) — domain types stay in packages/domain and are NEVER re-declared (enums like TASK_STATUSES/PRIORITIES are REUSED from @gobing-ai/spur-domain). The planningEventContract ships NOW (contract only) so the polling hook is authored against the eventual SSE types; the SSE handler (S6) and client hook (W6) are deferred (invariant #10). Ships as a per-module vertical slice with S3 (Q6). Anchors: design §2.5, §2.6, §2.9.2.


### Requirements

- [x] **R1** taskContract (list/show/create/transition) + DTOs reusing TASK_STATUSES/PRIORITIES → **MET** | `packages/contracts/src/task.ts:8-122` (taskSummary/Show/Create/Transition schemas + 4 routes); tests `contract.test.ts:101-188`
- [x] **R2** featureContract (list/show/create/transition/refresh) over FeatureService shape → **MET** | `packages/contracts/src/feature.ts:78-133` (5 routes + DTOs); tests `contract.test.ts:192-263`
- [x] **R3** planningEventContract.stream (SSE) + envelope DTO, CONTRACT ONLY no handler → **MET** | `packages/contracts/src/planning-event.ts:11-37`; TODO(S6) at :7-9 flags oRPC event-iterator confirmation; tests `contract.test.ts:267-321` (incl. "builds without an SSE handler")
- [x] **R4** api-response envelope + pagination/cursor types → **MET** | `packages/contracts/src/shared.ts:23-60` (apiSuccessSchema/apiErrorSchema/paginationMetaSchema/paginatedResponseSchema); tests `contract.test.ts:36-97`
- [x] **R5** composition merges health + task + feature + planningEvent → **MET** | `packages/contracts/src/index.ts:19-31`; tests `contract.test.ts:313-346`
- [x] **R6** every JSON response uses ts-utils api-response shape → **MET (contract layer)** | every route `.output` is `{ ok:literal(true), data }`; error envelope `shared.ts:31`. Runtime emission is server-handler scope (0078).
- [~] **R7** error-mapping table → HTTP + requestId → **PARTIAL (by design)** | Transport vocabulary `API_ERROR_CODES` shipped: `shared.ts:7-17` (NOT_FOUND/VALIDATION_FAILED/GUARD_DENIED/LOCK_TIMEOUT/CONFLICT/INTERNAL_ERROR). `apps/server/src/middleware/error-handler.ts:24-40` carries requestId + suppresses stack in prod, but the granular domain-error→code mapping (NotFoundError→404, GuardDeniedError→409, …) is **deferred to the handler task (0078)** that binds the contract — per design §2.6 ("centralized in the oRPC handler onError"). Not a 0077 defect.
- [x] **R8** NO domain type re-declared in packages/contracts; enums REUSED → **MET** | grep confirms zero `const TASK_STATUSES|PRIORITIES|FEATURE_STATUSES|FEATURE_ID_PATTERN =` in contracts; imported from `@gobing-ai/spur-domain/schema`; purity tests `contract.test.ts:351-414`
- [x] **R9** drift-is-tsc-error + envelope + planningEvent ships w/o S6 handler; coverage ≥90% → **MET** | `implement(contract)` drift is compile-checked once handlers bind (0078); 45/45 contract tests; all 5 src files 100% line/func coverage


### Q&A



### Design

Authority: design §2.5 (contracts — per-module vertical slice), §2.6 (output envelope + error mapping),
§2.9.2 (planningEventContract). ADR-005 (oRPC type seam; domain types never in contracts). Invariant #2
(one transport), #3 (contract<->handler drift is a compile error), #10 (SSE contract ships before
handler).

**Ground-truth (verified):** `packages/contracts` is the SSOT for transport DTOs; the server binds via
`implement(contract)`. Domain enums to REUSE (never re-declare): `TASK_STATUSES` =
`['backlog','todo','wip','testing','blocked','done','cancelled']` and `PRIORITIES` =
`['P0','P1','P2','P3']`, both exported from `@gobing-ai/spur-domain` (via `planning/schema`).
`oc` from `@orpc/contract`, `z` from `zod`. The existing `healthContract` + `packages/contracts/src/index.ts`
`contract` composition is the pattern to extend.

**taskContract (R1 — design §2.5):** `packages/contracts/src/task.ts`
- DTOs: `taskSummarySchema` (`wbs` regex `^\d{4}$`, `name`, `status: z.enum(TASK_STATUSES)`,
  `priority: z.enum(PRIORITIES).optional()`, `featureId/parentWbs nullable optional`, `filePath`);
  `taskListResponseSchema` (`{ ok: literal(true), data: array(taskSummary) }`); `taskShowResponseSchema`
  (`{ ok, data: { wbs, name, status, frontmatter: record, content: string, filePath } }`);
  `taskCreateInputSchema` (`title min 1`, `featureId?`, `parentWbs?`, `folder?`);
  `taskCreateResponseSchema` (`{ ok, data: { wbs, filePath } }`); `taskTransitionInputSchema`
  (`{ wbs, toStatus: z.enum(TASK_STATUSES), actor? }`).
- Routes: `list` GET /tasks; `show` GET /tasks/{wbs}; `create` POST /tasks; `transition` PATCH
  /tasks/{wbs}/status. Each `.route({ method, path, summary, tags:['task'] })` + `.input`/`.output`.

**featureContract (R2):** `packages/contracts/src/feature.ts` — same pattern: `list` GET /features,
`show` GET /features/{id}, `create` POST /features, `transition` PATCH /features/{id}/status, `refresh`
POST /features/refresh. DTOs `featureSummarySchema`/`featureShowResponseSchema`/etc. Feature `id` is the
single-letter / letter+digit form (`^[A-Z][0-9]*$`-ish — confirm against the feature schema regex).

**planningEventContract (R3 — design §2.9.2; CONTRACT ONLY, NO handler — invariant #10):**
`packages/contracts/src/planning-event.ts`
- `planningEventEnvelopeSchema` = `{ ok: literal(true), data: { eventName: string, occurredAt:
  z.string().datetime(), actor: string nullable optional, payload: z.record(string, unknown) } }`.
- `planningEventContract.stream` = `oc.route({ method:'GET', path:'/events/planning', summary, tags:
  ['events'] }).output(planningEventEnvelopeSchema)`. The `.output` types ONE SSE frame (per-yield), NOT
  a terminal object (design §2.9.2 note). **Confirm the exact oRPC event-iterator output form against the
  installed @orpc/server version when S6 implements** — the per-frame DTO is stable either way.

**shared (R4):** `packages/contracts/src/shared.ts` — `apiSuccess`/`apiError` envelope schemas
(`{ ok:true, data }` / `{ ok:false, error:{ code, message, details? } }`), pagination/cursor types from
`ts-utils` cursor.

**Composition (R5):** `packages/contracts/src/index.ts` merges `health` + `...taskContract` +
`...featureContract` + `planningEventContract` into the exported `contract`.

**Output envelope (R6) + error mapping (R7 — design §2.6):** every JSON response uses the ts-utils
api-response shape (same as CLI `--json`). Domain-error -> HTTP table:
| Domain error | HTTP | code |
|---|---|---|
| NotFoundError | 404 | NOT_FOUND |
| Zod ValidationError | 422 | VALIDATION_FAILED |
| GuardDeniedError (lifecycle) | 409 | GUARD_DENIED |
| LockTimeoutError | 503 | LOCK_TIMEOUT |
| ConflictError | 409 | CONFLICT |
| unhandled | 500 | INTERNAL_ERROR (no stack in prod) |
Every error carries `requestId` (from 0072). The mapping is centralized in the oRPC handler `onError`
and/or the `errorHandler` middleware (0072) — confirm which domain error types packages/app actually
throws (grep PlanningWriteService/lifecycle for the error classes; reuse ts-utils errors if present —
do NOT invent a parallel error hierarchy).

**Domain-type purity (R8 — ADR-005):** NO domain type re-declared in packages/contracts; enums REUSED
from spur-domain; the full task/feature domain shapes stay in packages/domain.

**Ships as a per-module vertical slice WITH S3 (0078)** (Q6) — but the CONTRACTS land here so 0078's
handlers bind against them and drift is a compile error.

**Out of scope:** SSE handler (S6), SSE client hook (W6), domain modules' handlers (0078 binds them).


### Solution

Shipped the oRPC transport-contract layer for the planning domain as a per-module vertical slice
(transport DTOs only — ADR-005; domain types/enums reused, never re-declared — R8).

**Files:**
- `packages/contracts/src/task.ts` — `taskContract` (list/show/create/transition) + DTOs
  (`taskSummary`/`taskShow`/`taskCreate`/`taskTransition`), reusing `TASK_STATUSES`/`PRIORITIES`.
- `packages/contracts/src/feature.ts` — `featureContract` (list/show/create/transition/refresh) +
  DTOs, reusing `FEATURE_STATUSES`/`FEATURE_ID_PATTERN`/`PRIORITIES`.
- `packages/contracts/src/planning-event.ts` — `planningEventEnvelopeSchema` +
  `planningEventContract.stream` (GET /events/planning, SSE). CONTRACT ONLY, no handler (invariant
  #10); `TODO(S6)` flags the oRPC event-iterator output-form confirmation.
- `packages/contracts/src/shared.ts` — `apiSuccessSchema`/`apiErrorSchema` envelopes,
  `API_ERROR_CODES` transport vocabulary (R7), `paginationMetaSchema`/`paginatedResponseSchema`.
- `packages/contracts/src/index.ts` — composes `health` + `task` + `feature` + `planningEvent`.

**Enum-import purity fix (verification finding P1):** importing the enums from the
`@gobing-ai/spur-domain` barrel transitively pulled `bun:sqlite` (via `./dao`/`./db`) into the
web/Workers bundle, breaking `apps/web` build and `test-cf`. Added a sqlite-free subpath export
`"./schema": "./src/planning/schema.ts"` to `packages/domain/package.json` and repointed the two
contract imports to `@gobing-ai/spur-domain/schema`. Preserves R8 (reuse, don't redeclare).

**R7 boundary:** the string error-code vocabulary ships here; the runtime domain-error → HTTP-status
mapping is centralized in the server error handler and lands with the binding handlers (0078) per
design §2.6 — partial-by-design at the contract layer, not a defect.

**Verification:** lint + typecheck clean (7 workspaces); contracts 45/45 tests, all 5 src files
100% line/func coverage (R9 ≥90%); full suite 1546 pass / 0 fail; test-cf pass; build (cli+server+web)
pass.


### Plan

- [x] `packages/contracts/src/task.ts`: DTO schemas (reuse `TASK_STATUSES`/`PRIORITIES` from @gobing-ai/spur-domain/schema) + `taskContract` (list/show/create/transition routes).
- [x] `packages/contracts/src/feature.ts`: `featureContract` (list/show/create/transition/refresh) + DTOs; feature-id regex `FEATURE_ID_PATTERN` (`^[A-Z][1-9]*$`) reused from schema.
- [x] `packages/contracts/src/planning-event.ts`: `planningEventEnvelopeSchema` + `planningEventContract.stream` (GET /events/planning, output = one frame). CONTRACT ONLY — no handler. `TODO(S6)` references the oRPC event-iterator confirmation.
- [x] `packages/contracts/src/shared.ts`: api-response envelope schemas + cursor/pagination types.
- [x] `packages/contracts/src/index.ts`: merge health + task + feature + planningEvent into `contract`.
- [x] Error mapping: `API_ERROR_CODES` transport vocabulary shipped (shared.ts); server `globalErrorHandler` carries requestId + suppresses stack in prod. Granular domain-error→code mapping deferred to handler task 0078 (design §2.6).
- [x] Tests: 45/45 — route metadata, envelope shapes, planningEvent exported & builds without S6 handler, domain-type purity (no enum redeclared). `implement(contract)` drift is tsc-checked once 0078 binds.
- [x] Gate: `bun run lint` + `test` + `test-cf` + `build` all green; coverage 100% (≥90%).
- [x] Ships with 0078 (per-module vertical slice). GATE CHECK: S2 (0075) module-system pattern landed.


### Review — 2026-06-16

**Status:** 1 P1 finding (fixed) + 1 P3 (fixed) + 1 P4 (kept by design)
**Scope:** packages/contracts/src/{task,feature,planning-event,shared,index}.ts + tests
**Mode:** verify (Phase 7 SECU + Phase 8 traceability)
**Channel:** inline
**Gate:** `bun run lint` ✅ · `test` (45/45 contracts, 1546 total) ✅ · `test-cf` ✅ · `build` (cli+server+web) ✅
**Coverage:** task/feature/planning-event/shared/index.ts all 100% func / 100% line (R9 ≥90% ✅)

### P1 — Blockers
| # | Title | Dimension | Location | Recommendation | Status |
|---|-------|-----------|----------|----------------|--------|
| 1 | Contract barrel-import drags `bun:sqlite` into web/Workers bundle | Correctness | task.ts:1, feature.ts:1 | Import enums from sqlite-free subpath `@gobing-ai/spur-domain/schema`, not the `.` barrel (which re-exports dao/db → ts-runtime `bun:sqlite`). | **FIXED** |

### P2 — Warnings
_None._

### P3 — Info
| # | Title | Dimension | Location | Recommendation | Status |
|---|-------|-----------|----------|----------------|--------|
| 2 | shared.ts comment "Mirrors the ts-utils ApiErrorCode vocabulary" was imprecise | Usability | shared.ts:9 | ts-utils `ApiErrorCode` is numeric (404/422/…) and lacks GUARD_DENIED/LOCK_TIMEOUT. Reworded to "transport error-code vocabulary aligned with the R7 mapping table". | **FIXED** |

### P4 — Suggestions
| # | Title | Dimension | Location | Recommendation | Status |
|---|-------|-----------|----------|----------------|--------|
| 3 | `paginatedResponseSchema`/`paginationMetaSchema`/`apiSuccessSchema` exported but unused by any route yet | Efficiency | shared.ts:23,41,51 | Kept — documented R4 envelope/cursor primitives for downstream handlers (0078) + future paginated lists. Revisit if still unused after the W-series client work. | **KEPT (by design)** |

**Root-cause note (Finding #1):** `packages/contracts` is bundled into `apps/web` (Vite/esbuild) and `apps/server` test-cf (Workers) — neither has `bun:sqlite`. The barrel `@gobing-ai/spur-domain` re-exports `./dao`, `./db`, `./planning/locks`, pulling `@gobing-ai/ts-runtime`'s `bun:sqlite` re-export. `planning/schema.ts` (the enum source) is itself zod-only. **Fix:** added `"./schema": "./src/planning/schema.ts"` subpath export to `packages/domain/package.json`; repointed the two contract imports; `bun install --force` to re-link. Pre-fix web build + test-cf FAILED; post-fix both PASS. Preserves R8 (reuse, don't redeclare).

**Fix-pass 2026-06-16:** 2 fixed (P1 #1, P3 #2), 0 failed, 1 intentionally skipped (P4 #3). Gate re-run green: lint ✅ · contracts 45/45 ✅ · test-cf ✅ · build cli+server+web ✅ · full suite 1546 pass / 0 fail.


### Testing

Suite: `packages/contracts/tests/contract.test.ts` (45 tests, `bun:test`).

- **Shared envelopes** — apiSuccess/apiError accept/reject, pagination meta, paginated wrapper.
- **Task contract** — 4 route metadata assertions + DTO parse/reject (wbs 4-digit regex, required title, invalid status reject).
- **Feature contract** — 5 route metadata + DTO parse, feature-id `^[A-Z][1-9]*$` accept/reject.
- **Planning event** — envelope accepts valid frame / null actor / missing actor; stream route defined; composed into `contract.stream`; builds without an SSE handler (invariant #10).
- **Composition** — health preserved; task/feature namespaces expose all routes.
- **Domain-type purity (R8)** — all TASK_STATUSES/PRIORITIES/FEATURE_STATUSES values valid; feature-id pattern honored; grep confirms zero enum redeclaration in contracts.

Result: **45 pass / 0 fail**. Coverage: all 5 src files **100% line / 100% func** (target ≥90%).
Full repo suite after the domain subpath fix: **1546 pass / 0 fail**; `test-cf` pass; `build` (cli+server+web) pass.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| Source | packages/contracts/src/task.ts | claude | 2026-06-16 |
| Source | packages/contracts/src/feature.ts | claude | 2026-06-16 |
| Source | packages/contracts/src/planning-event.ts | claude | 2026-06-16 |
| Source | packages/contracts/src/shared.ts | claude | 2026-06-16 |
| Source | packages/contracts/src/index.ts (composition) | claude | 2026-06-16 |
| Test | packages/contracts/tests/contract.test.ts | claude | 2026-06-16 |
| Fix | packages/domain/package.json (./schema subpath export) | claude | 2026-06-16 |


### References


