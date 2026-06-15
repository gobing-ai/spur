---
name: "S4: Server contracts (task + feature + planningEvent) + output envelope + error mapping"
description: "S4: Server contracts (task + feature + planningEvent) + output envelope + error mapping"
status: Backlog
created_at: 2026-06-15T16:56:10.090Z
updated_at: 2026-06-15T16:56:10.090Z
folder: docs/tasks
type: task
feature-id: S4
priority: P1
estimated_hours: 12
tags: ["server-side-adjustment","wave-S1","group-S"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0077. "S4: Server contracts (task + feature + planningEvent) + output envelope + error mapping"

### Background

The type seam (ADR-005). Server handlers bind via implement(contract); the web client consumes via OpenAPILink; contract<->handler drift is a compile error. Contracts are TRANSPORT DTOs ONLY (ADR-005) — domain types stay in packages/domain and are NEVER re-declared (enums like TASK_STATUSES/PRIORITIES are REUSED from @gobing-ai/spur-domain). The planningEventContract ships NOW (contract only) so the polling hook is authored against the eventual SSE types; the SSE handler (S6) and client hook (W6) are deferred (invariant #10). Ships as a per-module vertical slice with S3 (Q6). Anchors: design §2.5, §2.6, §2.9.2.


### Requirements

R1: packages/contracts/src/task.ts — taskContract (list GET /tasks, show GET /tasks/{wbs}, create POST /tasks, transition PATCH /tasks/{wbs}/status) with Zod input/output schemas; DTOs taskSummarySchema (reuses TASK_STATUSES + PRIORITIES enums from spur-domain), taskShowResponseSchema, taskCreateInputSchema/ResponseSchema, taskTransitionInputSchema. R2: packages/contracts/src/feature.ts — featureContract (list/show/create/transition/refresh) same pattern over FeatureService. R3: packages/contracts/src/planning-event.ts — planningEventContract.stream (GET /events/planning, SSE) + planningEventEnvelopeSchema frame DTO. CONTRACT ONLY — no handler this round (invariant #10). Confirm the oRPC event-iterator output form against the installed @orpc/server at impl time (design §2.9.2 note). R4: packages/contracts/src/shared.ts — api-response envelope ({ ok:true, data } / { ok:false, error:{code,message,details?} }), shared pagination/cursor types (from ts-utils cursor). R5: contract composition in packages/contracts/src/index.ts merges health + task + feature + planningEvent. R6: Output envelope: every JSON response uses the ts-utils api-response shape (same as CLI --json). R7: Error mapping table -> HTTP: NotFoundError 404 NOT_FOUND; Zod ValidationError 422 VALIDATION_FAILED; GuardDeniedError 409 GUARD_DENIED; LockTimeoutError 503 LOCK_TIMEOUT; ConflictError 409 CONFLICT; unhandled 500 INTERNAL_ERROR (never leaks stack in prod); every error carries requestId. R8: NO domain type re-declared in packages/contracts (assert by inspection). R9: Tests: contract<->handler drift is a tsc error (negative compile fixture or documented); envelope shape; planningEventContract exported and ships without the S6 handler. Coverage >=90%. GATED on S2 (module system pattern).


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



### Plan

- [ ] `packages/contracts/src/task.ts`: DTO schemas (reuse `TASK_STATUSES`/`PRIORITIES` from @gobing-ai/spur-domain) + `taskContract` (list/show/create/transition routes).
- [ ] `packages/contracts/src/feature.ts`: `featureContract` (list/show/create/transition/refresh) + DTOs; confirm the feature-id regex against the feature schema.
- [ ] `packages/contracts/src/planning-event.ts`: `planningEventEnvelopeSchema` + `planningEventContract.stream` (GET /events/planning, output = one frame). CONTRACT ONLY — no handler. Add a TODO referencing the S6 oRPC event-iterator confirmation.
- [ ] `packages/contracts/src/shared.ts`: api-response envelope schemas + cursor/pagination types from ts-utils.
- [ ] `packages/contracts/src/index.ts`: merge health + task + feature + planningEvent into `contract`.
- [ ] Error mapping: grep packages/app (PlanningWriteService, lifecycle adapters) for the actual thrown error classes; reuse ts-utils errors; centralize the domain-error -> HTTP/code mapping in the oRPC `onError` + the 0072 errorHandler. Confirm the table covers what's actually thrown.
- [ ] Tests: contract<->handler drift is a tsc error (a negative-compile fixture OR a documented `implement(contract)` mismatch check); every response uses `{ ok, data?/error? }`; `planningEventContract` is exported and the package builds WITHOUT any S6 handler; assert no domain type is duplicated in packages/contracts (inspection/grep).
- [ ] Gate: `bun run lint` + `test` + `test-cf` + `build`; coverage >=90%.
- [ ] Ships with 0078 (per-module vertical slice). GATE CHECK: S2 (0075) module-system pattern landed.


### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


