---
schema_version: 1
name: Serve the run progress projection and run list filters
status: todo
template: feature-impl
created_at: 2026-10-04T02:46:12.527Z
updated_at: "2026-10-04T03:05:40.242Z"
feature_id: E72
priority: P2
tags:
  - observability
  - server
  - contracts
estimate_hours: 3

---

## 1069. Serve the run progress projection and run list filters

### Background

Implements feature E72 R5, "The Board and the CLI read one progress projection". This is the server half of the Trace tab's read plane. It also adds the server-side run-list filters that the tab's list needs; the list UI itself is task 1071, AC2. Design satellite: `docs/design/run-record-contract.md` § "Feature E72 — Trace tab (proposed, 2026-10-03)".

Verified current state (2026-10-03, main @ 1beec8795):

- `spur workflow progress <run-id>` is `apps/cli/src/commands/workflow.ts:1727-1757`. It calls `projectWorkflowProgress(runId, { db: await context.getDb(), projectRoot: context.cwd })`. An `orphan-row` diagnostic means the run id is unknown, and the CLI maps that to `NOT_FOUND` with exit 1.
- The projection is `packages/app/src/workflow/progress-projection.ts`:
  - `projectWorkflowProgress` is at :169; the interfaces sit above it.
  - It is exported from `@gobing-ai/spur-app` (`packages/app/src/index.ts:944`; the type at :950).
  - For an unknown run (:183) it returns `workflow:'unknown'`, `status:'unknown'` and `states:[]`, with an `orphan-row` diagnostic.
- The runs server module is `apps/server/src/modules/runs/index.ts`:
  - `GET /api/runs` at :26 (status, limit, cursor; a bad cursor is a 400 with `code: MALFORMED_CURSOR`).
  - `GET /api/runs/by-wbs/:wbs` at :49.
  - `GET /api/runs/:runId` at :63, which returns 404 `{error, code, runId}`.
  - The module comment table at :13-17 lists the routes.
- The server context (`apps/server/src/context.ts`) exposes `getDb(): Promise<DbAdapter>` (:166/:429), `cwd` (:140) and `runStoreService()` (:731). `RunStoreServiceContext` (`packages/app/src/services/run-store-service.ts:21`) carries only `getDb` and `secretValues`, with no project root.
- `RunStoreListQuery {status?, limit?, cursor?}` is at `run-store-service.ts:85`. `list()` (:257) calls `new RunDao(db).traceRows({ status, before, limit: limit + 1 })`.
- **`RunDao.traceRows` already supports `workflow` and `since`** (`packages/domain/src/dao/run-dao.ts:70-108`):
  - SQL: `(?1 IS NULL OR workflow_name = ?1)` and `(?3 IS NULL OR started_at >= ?3)`.
  - Ordering is the keyset `started_at DESC, id DESC`.
  - This task makes no DAO or SQL change. It only plumbs the two values through.
- There is no runs contract in `packages/contracts/src` (files: board, feature, fleet, history, index, observability, planning-event, shared, task).
  - The established pattern for a Hono-served route that should appear in the generated OpenAPI is a **contract-only** `oc.route`. Example: `packages/contracts/src/fleet.ts:161`, `fleetContract.snapshot`, path `/project/fleet`, served by `apps/server/src/modules/health/index.ts:100` as `/api/project/fleet`.
  - The test for it is `apps/server/tests/openapi.test.ts:22`.
  - The contract is composed in `packages/contracts/src/index.ts:22`, with `export *` lines from :46.
  - Contract paths omit `/api`, because `apps/server/src/openapi.ts` sets `servers: /api`.

### Requirements

- [ ] R1. `GET /api/runs/:runId/progress` in `apps/server/src/modules/runs/index.ts` returns `c.json(await projectWorkflowProgress(runId, { db: await ctx.getDb(), projectRoot: ctx.cwd }))`. This is the exact call `apps/cli/src/commands/workflow.ts:1738-1741` makes, so there is no second projection path and no new service method.
- [ ] R2. If the projection carries an `orphan-row` diagnostic, the route returns 404 `{ error: 'run not found: <runId>', code: 'RUN_NOT_FOUND', runId }` and does not return the projection body. Every other projection, including a running run or one with `definition-unavailable`, returns 200.
- [ ] R3. A new file `packages/contracts/src/runs.ts` exports:
  - `workflowProgressProjectionSchema`, a zod object that mirrors `WorkflowProgressProjection` field for field: `schemaVersion: z.literal(1)`, the status/effect/eligibility enums, and `version: z.string().nullable().optional()`.
  - Its inferred type `WorkflowProgressProjectionDto`.
  - `runsContract = { progress: oc.route({ method: 'GET', path: '/runs/{runId}/progress', summary, tags: ['runs'] }).input(z.object({ runId: z.string() })).output(workflowProgressProjectionSchema) }`, commented "CONTRACT ONLY, served by the Hono runs module".
  - `packages/contracts/src/index.ts` adds `runs: { ...runsContract }` to `contract` and `export * from './runs'`.
- [ ] R4. `GET /api/runs` accepts optional `workflow` (exact `workflow_name`) and `since` (ISO lower bound on `started_at`, inclusive).
  - `RunStoreListQuery` gains `workflow?: string; since?: string`, and `list()` passes both to `traceRows`.
  - Empty or absent params keep today's behaviour.
  - The server normalizes `since` with `new Date(since).toISOString()`. A value that does not parse (`Number.isNaN(Date.parse(since))`) returns 400 `{ error, code: 'MALFORMED_SINCE' }` before the service is called.
  - A cursor stays valid only with the same filters. The client resends them, which keeps the keyset and filters consistent.
- [ ] R5. A type-drift guard: `apps/server/tests/modules/runs/index.test.ts` asserts assignability in both directions between `WorkflowProgressProjection` (spur-app) and `WorkflowProgressProjectionDto` (contracts). `bun run typecheck` then fails if either side gains or changes a field.
- [ ] R6. Docs:
  - The runs module comment table lists the new route and params.
  - The Feature E72 section of `docs/design/run-record-contract.md` names `runsContract.progress` (contract-only) and `MALFORMED_SINCE`.
  - `docs/04_DESIGN.md:81` already says "Feature E72 Trace tab + run progress route — proposed", so it needs no change unless the wording drifts.
  - `docs/design/cli-contracts.md` is unchanged, because there is no CLI change.

### Acceptance Criteria

- [ ] AC1 — The Board and the CLI read one progress projection

Task-local verification:

- For a seeded in-memory run, `GET /api/runs/r1/progress` returns 200. The body parses with `workflowProgressProjectionSchema` and equals `projectWorkflowProgress('r1', { db, projectRoot })` called directly, apart from `projectedAt`.
- `GET /api/runs/nope/progress` returns 404 `{ code: 'RUN_NOT_FOUND', runId: 'nope' }`.
- `GET /api/runs?workflow=task-pipeline&since=2026-09-01T00:00:00Z` forwards `{ workflow: 'task-pipeline', since: '2026-09-01T00:00:00.000Z' }` to `RunStoreService.list`. `since=garbage` returns 400 `MALFORMED_SINCE`, and the service is not called.
- `RunStoreService.list({ workflow, since })` against an in-memory DB returns only matching rows. Cursor paging under a filter returns no duplicates and does not skip rows.
- The generated OpenAPI documents `GET /runs/{runId}/progress`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-04T03:01:09.378Z

- **Q: Call the projection in the route or add `RunStoreService.progress()`?** A: Call it in the route. `RunStoreServiceContext` has no project root, which definition resolution needs. The CLI already calls the app function directly with `getDb` and `cwd`. Mirroring that keeps one call shape on both transports, and the server stays thin, since the logic stays in `packages/app` (ADR-021).
- **Q: Plain Hono, or an oRPC contract?** A: A contract-only `oc.route` plus a Hono handler, the same as `fleetContract.snapshot` (`packages/contracts/src/fleet.ts:161`). The route appears in the generated OpenAPI, and the web gets a shared zod schema. No oRPC router is added. This supersedes the batch-time note "oRPC stays limited to task/feature/history".
- **Q: Does the DAO need new SQL for the filters?** A: No. `RunDao.traceRows` already binds `workflow` and `since` (`packages/domain/src/dao/run-dao.ts:70-108`).
- **Q: Timestamp comparison?** A: `runs.started_at` is ISO TEXT, so the comparison is lexicographic. `since` is normalized to `toISOString()`, which has millisecond precision and a `Z` suffix. ponytail: a row stored without milliseconds in the same second as `since` sorts as later. That error is sub-second and acceptable for a time-range filter.
- **Q: Where does the type-drift guard live?** A: In the server test, because apps/server depends on both packages. `packages/contracts` depends only on spur-domain and cannot import spur-app.
- Deferred: provenance fields on attempts. Task 1070 extends both the interface and this schema additively.
- **Q: Does adding `runs` to `contract` force an oRPC handler?** A: No. `apps/server/src/router.ts:28` builds a partial router (health, task, feature, history, board, stream) and omits `fleet`/`processes`. `apps/server/src/bootstrap.ts:36` registers the Hono modules before the `/api/*` OpenAPIHandler, and an unmatched oRPC path falls through via `next()`. Do **not** add a `runs` key to `createRouter`.

### Design

- Chosen:
  - A Hono route in the existing runs module that calls `projectWorkflowProgress` exactly as the CLI does.
  - A contract-only `runsContract.progress` with `workflowProgressProjectionSchema` in a new `packages/contracts/src/runs.ts`.
  - The list filters plumbed through `RunStoreListQuery` into the existing `traceRows` binds.
- Rejected:
  - A second projection implementation in the server, which would drift from the CLI.
  - A `RunStoreService.progress` wrapper, which needs a project root in the service context for no gain.
  - An oRPC router for runs, a second transport style for one read.
  - Client-side filtering, which breaks cursor paging and row counts.
- Invariants:
  - Read-only, with no writes and no migration.
  - One projection implementation.
  - The 404 shape matches `GET /api/runs/:runId` (`{error, code, runId}`).
  - Absent filters return byte-identical list responses.
- Key signatures:
  - `RunStoreListQuery { status?; limit?; cursor?; workflow?; since? }`
  - `runsContract.progress: GET /runs/{runId}/progress → workflowProgressProjectionSchema`
  - `type WorkflowProgressProjectionDto = z.infer<typeof workflowProgressProjectionSchema>`
- Route order: register `/api/runs/:runId/progress` immediately before `/api/runs/:runId` (:63), after `by-wbs` (:49). Hono distinguishes them by segment count, but this order keeps the file's "specific before param" convention.
- Schema sketch, with nested objects mirroring the interfaces in `progress-projection.ts`:
  ```ts
  const attempt = z.object({ actionRunId: z.string(), status: z.string(), ok: z.boolean().nullable(),
      startedAt: z.string().nullable(), completedAt: z.string().nullable(), durationMs: z.number().nullable() });
  const action = z.object({ actionKey: z.string(), kind: z.string(),
      stateEffect: z.enum(['read','write','may-write']), evidenceEffect: z.enum(['none','write']),
      status: z.enum(['pending','running','passed','failed','skipped','ambiguous']), attempts: z.array(attempt) });
  const state = z.object({ state: z.string(), visit: z.number(),
      status: z.enum(['pending','running','passed','failed','skipped']), actions: z.array(action) });
  // transitions {from,to,trigger: string|null, at}, artifacts {kind,path},
  // nextTransitions {from,to,trigger|null, eligibility: eligible|blocked|unknown},
  // diagnostics {code: enum of the six codes, message}
  export const workflowProgressProjectionSchema = z.object({ schemaVersion: z.literal(1), runId: z.string(),
      workflow: z.string(), status: z.enum(['pending','running','completed','failed','cancelled','unknown']),
      definitionDigest: z.string().nullable(), version: z.string().nullable().optional(),
      currentState: z.string().nullable(), states: z.array(state), transitions: z.array(transition),
      artifacts: z.array(artifact), nextTransitions: z.array(next), diagnostics: z.array(diagnostic),
      projectedAt: z.string() });
  ```
- Filter parsing in the list handler (`index.ts:26`): `const workflow = c.req.query('workflow') || undefined; const sinceRaw = c.req.query('since') || undefined;`. If `sinceRaw` does not parse, return `c.json({ error: \`malformed since: ${sinceRaw}\`, code: 'MALFORMED_SINCE' }, 400)`. Otherwise call `service.list({ status, limit, cursor, workflow, since })`.

### Plan

- [ ] 1. `packages/contracts/src/runs.ts`: add the schema, DTO type and `runsContract.progress`. Wire them into `src/index.ts` (`runs: { ...runsContract }` and `export * from './runs'`).
- [ ] 2. Add a contract test, `packages/contracts/tests/runs-contract.test.ts`, covering:
  - The schema accepts a full projection fixture and the unknown-run shape (`states: []`, `orphan-row`).
  - It rejects `schemaVersion: 2` and a bad `status`.
  - `contract.runs.progress` exists.
- [ ] 3. `run-store-service.ts`: add `workflow?`/`since?` to `RunStoreListQuery` (:85) and pass them in `list()` (:257) to `traceRows`. In `packages/app/tests/services/run-store-service.test.ts`, seed three runs across two workflows and two dates, then assert:
  - the filter results;
  - a filtered two-page cursor walk returns all matches exactly once.
- [ ] 4. In `apps/server/src/modules/runs/index.ts`:
  - parse `workflow` and `since` in the list handler and add the `MALFORMED_SINCE` 400;
  - add the progress route before :63;
  - import `projectWorkflowProgress` from `@gobing-ai/spur-app`;
  - update the comment table at :13-17.
- [ ] 5. In `apps/server/tests/modules/runs/index.test.ts`:
  - **filters**: the mocked service asserts that `q.workflow` and the normalized `q.since` are forwarded;
  - **bad since**: 400, and the service is not called;
  - **progress happy path**: build a ctx `{ getDb: async () => db, cwd: <repo root> } as unknown as ServerContext`. Create db with `createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' })` and `applyCliMigrations`, then seed with the SQL from `packages/app/tests/workflow/progress-projection.test.ts:63-77`. Assert schema-parse and deep-equal with the direct call, dropping `projectedAt`;
  - **unknown id**: 404 `RUN_NOT_FOUND`;
  - **the R5 assignability guard**.
- [ ] 6. In `apps/server/tests/openapi.test.ts`, assert that `spec.paths['/runs/{runId}/progress'].get` exists.
- [ ] 7. Docs: in the run-record-contract Feature E72 section, add contract-only `runsContract.progress` and `MALFORMED_SINCE`.
- [ ] 8. Gates:
  - `(cd packages/contracts && bun test tests/runs-contract.test.ts)`
  - `(cd packages/app && bun test tests/services/run-store-service.test.ts)`
  - `(cd apps/server && bun test tests/modules/runs/index.test.ts tests/openapi.test.ts)`
  - `bun run spur-check`

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/O_observability-trace-tab-for-workflow-run-inspection.md`, R5.
- Design: `docs/design/run-record-contract.md` § Feature E72; `docs/design/cli-contracts.md:672` (progress payload contract).
- Projection: `packages/app/src/workflow/progress-projection.ts:169` (call), :183 (unknown run), interfaces at the top of the file.
- CLI caller to mirror: `apps/cli/src/commands/workflow.ts:1727-1757`.
- Runs module: `apps/server/src/modules/runs/index.ts:26` (list), :49 (by-wbs), :63 (detail and 404 shape).
- Service and DAO: `packages/app/src/services/run-store-service.ts:21,85,257`; `packages/domain/src/dao/run-dao.ts:70-108`.
- Server context: `apps/server/src/context.ts:140,166,429,731`.
- Contract-only pattern: `packages/contracts/src/fleet.ts:161`; `packages/contracts/src/index.ts:22,46`; `apps/server/tests/openapi.test.ts:22`.
- Test seeds: `packages/app/tests/workflow/progress-projection.test.ts:12-16,63-77`; mocked-service pattern: `apps/server/tests/modules/runs/index.test.ts:14-18`.
- Downstream: 1070 adds provenance fields to this schema; 1071 consumes the route and schema.

### History
