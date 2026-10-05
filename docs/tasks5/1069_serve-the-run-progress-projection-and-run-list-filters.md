---
schema_version: 1
name: Serve the run progress projection and run list filters
status: done
template: feature-impl
created_at: 2026-10-04T02:46:12.527Z
updated_at: "2026-10-05T03:18:32.907Z"
feature_id: E72
priority: P2
tags: ["observability", "server", "contracts", "fleet:auto"]
estimate_hours: 3

done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/spur-new-runall-e72-4191/.spur/memory/evidence/1069-verdict.json
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

- [x] R1. `GET /api/runs/:runId/progress` in `apps/server/src/modules/runs/index.ts` returns `c.json(await projectWorkflowProgress(runId, { db: await ctx.getDb(), projectRoot: ctx.cwd }))`. This is the exact call `apps/cli/src/commands/workflow.ts:1738-1741` makes, so there is no second projection path and no new service method.
- [x] R2. If the projection carries an `orphan-row` diagnostic, the route returns 404 `{ error: 'run not found: <runId>', code: 'RUN_NOT_FOUND', runId }` and does not return the projection body. Every other projection, including a running run or one with `definition-unavailable`, returns 200.
- [x] R3. A new file `packages/contracts/src/runs.ts` exports:
  - `workflowProgressProjectionSchema`, a zod object that mirrors `WorkflowProgressProjection` field for field: `schemaVersion: z.literal(1)`, the status/effect/eligibility enums, and `version: z.string().nullable().optional()`.
  - Its inferred type `WorkflowProgressProjectionDto`.
  - `runsContract = { progress: oc.route({ method: 'GET', path: '/runs/{runId}/progress', summary, tags: ['runs'] }).input(z.object({ runId: z.string() })).output(workflowProgressProjectionSchema) }`, commented "CONTRACT ONLY, served by the Hono runs module".
  - `packages/contracts/src/index.ts` adds `runs: { ...runsContract }` to `contract` and `export * from './runs'`.
- [x] R4. `GET /api/runs` accepts optional `workflow` (exact `workflow_name`) and `since` (ISO lower bound on `started_at`, inclusive).
  - `RunStoreListQuery` gains `workflow?: string; since?: string`, and `list()` passes both to `traceRows`.
  - Empty or absent params keep today's behaviour.
  - The server normalizes `since` with `new Date(since).toISOString()`. A value that does not parse (`Number.isNaN(Date.parse(since))`) returns 400 `{ error, code: 'MALFORMED_SINCE' }` before the service is called.
  - A cursor stays valid only with the same filters. The client resends them, which keeps the keyset and filters consistent.
- [x] R5. A type-drift guard: `apps/server/tests/modules/runs/index.test.ts` asserts assignability in both directions between `WorkflowProgressProjection` (spur-app) and `WorkflowProgressProjectionDto` (contracts). `bun run typecheck` then fails if either side gains or changes a field.
- [x] R6. Docs:
  - The runs module comment table lists the new route and params.
  - The Feature E72 section of `docs/design/run-record-contract.md` names `runsContract.progress` (contract-only) and `MALFORMED_SINCE`.
  - `docs/04_DESIGN.md:81` already says "Feature E72 Trace tab + run progress route — proposed", so it needs no change unless the wording drifts.
  - `docs/design/cli-contracts.md` is unchanged, because there is no CLI change.

### Acceptance Criteria

- [x] AC1 — The Board and the CLI read one progress projection

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

- [x] 1. `packages/contracts/src/runs.ts`: add the schema, DTO type and `runsContract.progress`. Wire them into `src/index.ts` (`runs: { ...runsContract }` and `export * from './runs'`).
- [x] 2. Add a contract test, `packages/contracts/tests/runs-contract.test.ts`, covering:
  - The schema accepts a full projection fixture and the unknown-run shape (`states: []`, `orphan-row`).
  - It rejects `schemaVersion: 2` and a bad `status`.
  - `contract.runs.progress` exists.
- [x] 3. `run-store-service.ts`: add `workflow?`/`since?` to `RunStoreListQuery` (:85) and pass them in `list()` (:257) to `traceRows`. In `packages/app/tests/services/run-store-service.test.ts`, seed three runs across two workflows and two dates, then assert:
  - the filter results;
  - a filtered two-page cursor walk returns all matches exactly once.
- [x] 4. In `apps/server/src/modules/runs/index.ts`:
  - parse `workflow` and `since` in the list handler and add the `MALFORMED_SINCE` 400;
  - add the progress route before :63;
  - import `projectWorkflowProgress` from `@gobing-ai/spur-app`;
  - update the comment table at :13-17.
- [x] 5. In `apps/server/tests/modules/runs/index.test.ts`:
  - **filters**: the mocked service asserts that `q.workflow` and the normalized `q.since` are forwarded;
  - **bad since**: 400, and the service is not called;
  - **progress happy path**: build a ctx `{ getDb: async () => db, cwd: <repo root> } as unknown as ServerContext`. Create db with `createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' })` and `applyCliMigrations`, then seed with the SQL from `packages/app/tests/workflow/progress-projection.test.ts:63-77`. Assert schema-parse and deep-equal with the direct call, dropping `projectedAt`;
  - **unknown id**: 404 `RUN_NOT_FOUND`;
  - **the R5 assignability guard**.
- [x] 6. In `apps/server/tests/openapi.test.ts`, assert that `spec.paths['/runs/{runId}/progress'].get` exists.
- [x] 7. Docs: in the run-record-contract Feature E72 section, add contract-only `runsContract.progress` and `MALFORMED_SINCE`.
- [x] 8. Gates:
  - `(cd packages/contracts && bun test tests/runs-contract.test.ts)`
  - `(cd packages/app && bun test tests/services/run-store-service.test.ts)`
  - `(cd apps/server && bun test tests/modules/runs/index.test.ts tests/openapi.test.ts)`
  - `bun run spur-check`

### Solution

Change map (file:line, paths from repo root):

- `packages/contracts/src/runs.ts:74` — new `workflowProgressProjectionSchema` zod mirror of `WorkflowProgressProjection` (schemaVersion literal 1, status/effect/eligibility/diagnostic enums, `version` nullable-optional); DTO type at `packages/contracts/src/runs.ts:91`; contract-only `runsContract.progress` (`GET /runs/{runId}/progress`, "CONTRACT ONLY, served by the Hono runs module") at `packages/contracts/src/runs.ts:94-104`.
- `packages/contracts/src/index.ts:38` — `runs: { ...runsContract }` composed into `contract`; re-export at `packages/contracts/src/index.ts:53`.
- `packages/contracts/tests/runs-contract.test.ts:53` — schema accepts full fixture + unknown-run shape, rejects `schemaVersion: 2` / bad status / bad diagnostic code, asserts `contract.runs.progress` route.
- `packages/app/src/services/run-store-service.ts:95,100` — `RunStoreListQuery` gains `workflow?`/`since?`; `list()` passes both into the existing `traceRows` binds at `packages/app/src/services/run-store-service.ts:275-276`. No DAO/SQL change.
- `packages/app/tests/services/run-store-service.test.ts:338` — filter results across two workflows/dates; `:374` — filtered two-page cursor walk returns all matches exactly once.
- `apps/server/src/modules/runs/index.ts:42-52` — list handler parses `workflow`/`since`; unparseable `since` returns 400 `MALFORMED_SINCE` before the service is called, otherwise normalized via `new Date(since).toISOString()`; forwarded at `:57`. Progress route `GET /api/runs/:runId/progress` at `:84-95` calls `projectWorkflowProgress(runId, { db: await ctx.getDb(), projectRoot: ctx.cwd })` — the exact CLI call shape; `orphan-row` diagnostic → 404 `{error, code: 'RUN_NOT_FOUND', runId}` (`:90-92`). Comment table updated at `:20-23`.
- `apps/server/tests/modules/runs/index.test.ts:215` — filters forwarded (mock asserts `q.workflow` + normalized `q.since`); `:234` — `since=garbage` → 400, service unreachable; `:252-311` — seeded in-memory progress route: 200, body parses with `workflowProgressProjectionSchema`, deep-equals direct `projectWorkflowProgress` modulo `projectedAt`; unknown id → 404 `RUN_NOT_FOUND`; R5 bidirectional assignability guard at `:313`.
- `apps/server/tests/openapi.test.ts:46` — generated OpenAPI documents `GET /runs/{runId}/progress`.

Rationale: one projection implementation shared by CLI and Board (no second path); contract-only `oc.route` mirrors `fleetContract.snapshot` so the Hono route lands in the generated OpenAPI without an oRPC router; list filters reuse the existing `traceRows` binds (empty/absent params keep byte-identical behaviour); the R5 guard makes `bun run typecheck` fail on any field drift between the app interface and the wire schema.

Docs (R6): `docs/design/run-record-contract.md:62` (Feature E72 section) already names contract-only `runsContract.progress` and `MALFORMED_SINCE`; `docs/04_DESIGN.md:81` wording intact; `docs/design/cli-contracts.md` untouched (no CLI change).


Follow-up from this run's review (P3 dispositions, both fixed before record):

- `apps/server/tests/modules/runs/index.test.ts:313-336` — new test pins the 200 path for a non-orphan projection (`definition-unavailable`), so a regression to `diagnostics.length > 0` can no longer 404 a real run.
- `docs/design/observability-contracts.md:325-337` — run-store route/query table now lists the `workflow`/`since` filters, `MALFORMED_SINCE`, and `GET /api/runs/:runId/progress` with its non-orphan 200 rule (T3 satellite sync).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/server/src/modules/runs/index.ts:81-94` — the `GET /api/runs/:runId/progress` handler awaits `projectWorkflowProgress(runId, { db: await ctx.getDb(), projectRoot: ctx.cwd })`, the identical call shape the CLI makes at `apps/cli/src/commands/workflow.ts:1738-1741`; no `progress` member on `RunStoreService` (`packages/app/src/services/run-store-service.ts:264-292` gained only the two query fields and binds). Re-run this pass: `apps/server/tests/modules/runs/index.test.ts` + `apps/server/tests/openapi.test.ts` — 19 pass / 0 fail. |
| R2 | MET | `apps/server/src/modules/runs/index.ts:90-92` returns 404 `{ error, code: 'RUN_NOT_FOUND', runId }` only when a diagnostic code is `orphan-row`; the projection body is returned otherwise. Re-run this pass: the unknown-id and non-orphan-200 tests in `apps/server/tests/modules/runs/index.test.ts` pass (19 pass / 0 fail file receipt above). |
| R3 | MET | `packages/contracts/src/runs.ts:81-92` — `workflowProgressProjectionSchema` mirrors `WorkflowProgressProjection` field for field (`schemaVersion: z.literal(1)`, status/effect/eligibility/diagnostic enums, `version` nullable-optional); DTO at `packages/contracts/src/runs.ts:95`; contract-only `runsContract.progress` (`GET /runs/{runId}/progress`, "CONTRACT ONLY, served by the Hono runs module") at `packages/contracts/src/runs.ts:98`. Wired as `runs: { ...runsContract }` at `packages/contracts/src/index.ts:38`, re-exported at `packages/contracts/src/index.ts:54`. No `runs` key in the oRPC router (`apps/server/src/router.ts` — grep confirmed absent this pass). Re-run this pass: `packages/contracts/tests/runs-contract.test.ts` — 4 pass / 0 fail. |
| R4 | MET | `packages/app/src/services/run-store-service.ts:94-100` — `RunStoreListQuery` gains `workflow?`/`since?`; `:274-280` forwards both into the pre-existing `traceRows` binds (no DAO/SQL change; binds pre-exist at `packages/domain/src/dao/run-dao.ts:70-108`). `apps/server/src/modules/runs/index.ts:42-53` parses both params, returns 400 `{ code: 'MALFORMED_SINCE' }` before the service is called, normalizes via `new Date(sinceRaw).toISOString()`, forwards at `:57`. Re-run this pass: `packages/app/tests/services/run-store-service.test.ts` — 17 pass / 0 fail (filter results + filtered two-page cursor walk). |
| R5 | MET | `apps/server/tests/modules/runs/index.test.ts:338-345` declares bidirectional assignability between `WorkflowProgressProjection` and `WorkflowProgressProjectionDto`; `apps/server/tsconfig.json` includes `tests`, so the guard is compiled by typecheck. Re-run this pass: `bunx tsc --noEmit` exits 0 in packages/contracts, packages/app and apps/server. Known blind spot (additive optional field passes) recorded as SECUA finding 1 — wide of the R5 wording, not a defect. |
| R6 | MET | `apps/server/src/modules/runs/index.ts:20-22` — comment-table rows for the list filters + 400 `MALFORMED_SINCE` and the progress route + 404 `RUN_NOT_FOUND`. `docs/design/run-record-contract.md:62` names the shared projection, `runsContract.progress` (contract-only) and `MALFORMED_SINCE`; `docs/design/observability-contracts.md:328,340` lists the filters, the 400 and the progress route. `docs/04_DESIGN.md:81` wording intact; `docs/design/cli-contracts.md` untouched (no CLI change). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The Board and the CLI read one progress projection | MET | test | `apps/server/tests/modules/runs/index.test.ts:275-295` — 200 for a seeded run, body parses with `workflowProgressProjectionSchema` and deep-equals a direct projection call apart from `projectedAt`; `:297-311` unknown id returns 404 `RUN_NOT_FOUND`; `:313-336` a non-orphan diagnostic still returns 200. `apps/server/tests/openapi.test.ts:46-53` documents `GET /runs/{runId}/progress`. Re-run this pass: 19 pass / 0 fail (server), 4 pass / 0 fail (contracts), 17 pass / 0 fail (app). The Board consumer is task 1071, out of scope here. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1069 (feature E72, pass 2)

**Scope:** the task's implementation on the current tree (`sp/runall-e72-4191` @ `dbc95f3db`). Git-tag scope discovery now resolves exactly one `(1069)`-tagged commit — `dbc95f3db` (test + docs only: `apps/server/tests/modules/runs/index.test.ts`, `docs/design/observability-contracts.md`); the product implementation is the untagged `37c11116c`, so the task's `### Solution` change map remains the scope authority. Nine paths re-read at their cited lines this run: `packages/contracts/src/runs.ts`, `packages/contracts/src/index.ts`, `packages/contracts/tests/runs-contract.test.ts`, `packages/app/src/services/run-store-service.ts`, `packages/app/tests/services/run-store-service.test.ts`, `apps/server/src/modules/runs/index.ts`, `apps/server/tests/modules/runs/index.test.ts`, `apps/server/tests/openapi.test.ts`, `docs/design/observability-contracts.md`. No staged files; the only working-tree modification is the task file itself (pipeline section writes).
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Pass-1 P3 dispositions (both re-checked this run)

| # | Pass-1 finding | Status | Evidence |
|---|----------------|--------|----------|
| a | The 404 discriminator was only tested positively — a regression to `diagnostics.length > 0` would keep the suite green | FIXED | `apps/server/tests/modules/runs/index.test.ts:313-336` seeds a run (`r2`, workflow `no-such-workflow`) whose projection carries `definition-unavailable`/`definition-digest-missing` but not `orphan-row`, and asserts `res.status === 200` plus `codes).toContain('definition-unavailable')` and `not.toContain('orphan-row')`. With a length-based check the request would 404 and `:329` would fail. Executed this run: `(pass) runs module progress route … a non-orphan diagnostic still serves the projection with 200 (R2)`. The fix is genuine and correctly targeted — no wrong or partial fix. |
| b | The owning T3 satellite was stale — `docs/design/observability-contracts.md` listed no `workflow`/`since`, no `MALFORMED_SINCE`, no progress route | FIXED | `docs/design/observability-contracts.md:327-328` (query filters + 400 `MALFORMED_SINCE` "rejected before the service is called") and `:340-341` (progress route, contract-only `runsContract.progress`, and the non-orphan → 200 rule); the rest of the table (`:325-339`) is unchanged, so the edit is additive-only and matches the module comment table at `apps/server/src/modules/runs/index.ts:20-22`. |

##### Verification Evidence (re-run this run, output pasted)

```
$ (cd packages/contracts && bun test tests/runs-contract.test.ts)
 4 pass / 0 fail / 10 expect() calls — Ran 4 tests across 1 file. [38.00ms]

$ (cd packages/app && bun test tests/services/run-store-service.test.ts)
 17 pass / 0 fail / 72 expect() calls — Ran 17 tests across 1 file. [206.00ms]

$ (cd apps/server && bun test tests/modules/runs/index.test.ts tests/openapi.test.ts)
 19 pass / 0 fail / 49 expect() calls — Ran 19 tests across 2 files. [319.00ms]
   incl. "GET /api/runs forwards workflow + normalized since filters (1069 R4)"
   incl. "GET /api/runs?since=garbage returns 400 MALFORMED_SINCE without calling the service (1069 R4)"
   incl. "GET /api/runs/:runId/progress returns 200 with the shared projection (R1)"
   incl. "GET /api/runs/:runId/progress returns 404 RUN_NOT_FOUND for an unknown id (R2)"
   incl. "a non-orphan diagnostic still serves the projection with 200 (R2)"        <-- pass-1 (a)
   incl. "WorkflowProgressProjection and WorkflowProgressProjectionDto stay assignable in both directions (R5)"
   incl. "documents the Hono-served run progress projection route (1069 / E72 R5)"

$ (cd apps/server && bun test tests)              # whole server surface after the fix commit
 503 pass / 0 fail / 1499 expect() calls — Ran 503 tests across 47 files. [5.58s]

$ bun run --filter '@gobing-ai/spur-server' --filter '@gobing-ai/spur-app' --filter '@gobing-ai/spur-contracts' typecheck
 @gobing-ai/spur-contracts typecheck: Exited with code 0
 @gobing-ai/spur-app typecheck: Exited with code 0
 @gobing-ai/spur-server typecheck: Exited with code 0        (server tsconfig includes tests/**/*.ts → the R5 guard is compiled)

$ (cd apps/web && bun run typecheck)               # the second consumer of the contract package
 exit 0

$ bun apps/cli/src/index.ts task check 1069 --json  →  pass: true
 4 × L4.anchor-subject-mismatch (warning), section "Solution" — anchor hygiene only (finding 5)

$ cat .spur/run/1069-check-receipt.json             # evidence chain re-run after dbc95f3db
 {"tier":"full","checks":[{"id":"test","cmd":"bun run spur-check","status":"PASS","durationMs":281099}],"status":"PASS"}
 (.spur/run/1069-test-gate.log: 9934 tests / 576 files; "All 2 rules passed — no violations found")
```

Three independent probes run outside the tree (`/tmp` scratch; nothing written into the repo):

```
probe C — full production wiring: createApp() registers the Hono modules before the /api/* oRPC
          OpenAPIHandler (apps/server/src/bootstrap.ts:36 vs :41); ctx.getDb → in-memory migrated
          DB holding one run whose workflow does not resolve. Nothing was mocked.
 GET /api/runs/r1/progress   -> 200  diagnostics: [definition-unavailable, definition-digest-missing]
 GET /api/runs/nope/progress -> 404  {"error":"run not found: nope","code":"RUN_NOT_FOUND","runId":"nope"}
 GET /api/runs?since=garbage -> 400  {"error":"malformed since: garbage","code":"MALFORMED_SINCE"}
 => R1/R2/R4 hold through the real bootstrap, and the contract-only route is NOT shadowed by the
    OpenAPIHandler even though `contract.runs` now exists without a router key (Q&A decision holds).

probe D — R5 guard power (strict tsconfig, workspace packages symlinked into /tmp/rev1069):
 REQUIRED field added on either side of the app/DTO boundary -> 2 errors, tsc exit 2   (caught)
 OPTIONAL field added on either side                        -> 0 errors, tsc exit 0   (blind)
 => finding 1.

probe E — `since` normalisation via `new Date(since).toISOString()`:
 'garbage'             -> NaN                       -> 400 MALFORMED_SINCE   (correct)
 '0'                   -> 2000-01-01T08:00:00.000Z  (accepted)
 '2026-02-30'          -> 2026-03-02T00:00:00.000Z  (accepted, rolls over)
 '2026-09-01T00:00:00' -> 2026-09-01T07:00:00.000Z  (offset-less input read as SERVER local time)
 '2026-09-01'          -> 2026-09-01T00:00:00.000Z  (UTC midnight)
 => finding 3.

probe F — generateOpenApiSpec(): paths['/runs/{runId}/progress'].get present, summary + tag 'runs',
 required path param `runId`, 200 response schema exposing all 14 projection properties,
 servers [{url:'/api'}] → the documented path is the served path.
```

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 (advisory) | architecture | The R5 guard's task wording ("`bun run typecheck` then fails if either side gains or changes a field") is wider than the guard delivers: bidirectional structural assignability catches added required fields, removed fields and type changes, but is blind to additive *optional* fields on either side (probe D: required drift → tsc exit 2; optional drift → tsc exit 0). That is exactly the class task 1070 introduces (provenance/estimated on attempts, "extends both the interface and this schema additively"). Practical risk stays low because a runtime `toEqual` between the parsed body and a direct `projectWorkflowProgress` call covers app→schema drift for the fields the seed produces, but schema-side or unseeded additive-optional drift is invisible to both mechanisms | `apps/server/tests/modules/runs/index.test.ts:338-345` |
| 2 | P4 (advisory) | usability | The progress route rebuilds the not-found envelope inline (`run not found: ${runId}` / `RUN_NOT_FOUND`) instead of reusing `RunStoreNotFoundError`, which already owns exactly that message, `code` and `runId` and is what the sibling detail route serializes. Two spellings of one wire contract drift silently if the message ever changes | `apps/server/src/modules/runs/index.ts:91` |
| 3 | P4 (advisory) | correctness | `since` validation is lenient and host-timezone-dependent: only `Number.isNaN(Date.parse(raw))` is rejected, so `since=0` → `2000-01-01T08:00:00.000Z` and `since=2026-02-30` → `2026-03-02T00:00:00.000Z` are accepted (probe E), and an offset-less value such as `since=2026-09-01T00:00:00` is read as *server local* time (`…T07:00:00.000Z` on this host), so the same query string means different instants per deployment. The Design Q&A only priced the sub-second millisecond-truncation error; a stricter ISO-8601-with-offset parse would remove both | `apps/server/src/modules/runs/index.ts:43-53` |
| 4 | P4 (advisory) | correctness | Cursor/filter coupling is a client contract only and is undocumented at the transport edge: the keyset cursor encodes `(started_at, id)` alone, so a client that changes `workflow`/`since` mid-walk silently skips or duplicates rows; the server cannot detect it. Identical to the pre-existing `status` behaviour and stated as a client responsibility in the task's Design section, so this is a note, not a defect | `packages/app/src/services/run-store-service.ts:266-284` |
| 5 | P4 (advisory) | correctness | Evidence-chain citation hygiene: (a) `spur task check 1069 --json` reports `pass: true` but still emits 4 × `L4.anchor-subject-mismatch` for `## Solution` — `run-store-service.ts:275-276` stops one line short of the `since` bind at `:277`, `runs-contract.test.ts:53` lands on the `describe` line (tests start at `:54`), `openapi.test.ts:46` lands on the declaration (assertion at `:52`), `run-store-service.test.ts:338` lands on a test title; (b) the on-disk verify answer (`.spur/run/1069-verify-answer.txt`, external form) still carries pre-fix anchors and cites `apps/server/tests/modules/runs/index.test.ts:313-320` for the R5 guard, but `:313` is now the pass-1 fix test — the guard moved to `:338-345` when `dbc95f3db` added 25 lines. Re-point both when `record` transcribes `## Testing`, or the recorded section will cite the wrong subject | `packages/app/src/services/run-store-service.ts:275-277` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — `GET /api/runs/:runId/progress` calls `projectWorkflowProgress` with the CLI's exact call shape | MET | `apps/server/src/modules/runs/index.ts:84-94` — `await projectWorkflowProgress(runId, { db: await ctx.getDb(), projectRoot: ctx.cwd })` at `:86-89` is the identical call shape to `apps/cli/src/commands/workflow.ts:1738-1741`; no second projection path in the module and no `progress` member on `RunStoreService` (`packages/app/src/services/run-store-service.ts:260-292` gains only the two query fields and two binds). Test: `apps/server/tests/modules/runs/index.test.ts:275-295` — HTTP 200, body parses with `workflowProgressProjectionSchema`, deep-equals the direct app call modulo `projectedAt`. Probe C re-confirmed 200 through `createApp()` (not just a bare `Hono`). |
| R2 — `orphan-row` → 404 `{error, code:'RUN_NOT_FOUND', runId}`; every other projection → 200 | MET | `apps/server/src/modules/runs/index.ts:90-92`; exact-body 404 test at `apps/server/tests/modules/runs/index.test.ts:297-311`; the non-orphan half is now locked by `:313-336` (200 + `definition-unavailable`, no `orphan-row`) — the pass-1 gap — and re-confirmed end-to-end by probe C through the real bootstrap. |
| R3 — `packages/contracts/src/runs.ts` exports the mirror schema, DTO and contract-only route; `index.ts` composes and re-exports | MET | `packages/contracts/src/runs.ts:74-88` (`schemaVersion: z.literal(1)`, status/effect/eligibility enums, six-code diagnostic enum, `version: z.string().nullable().optional()`), DTO at `:91`, `runsContract.progress` at `:94-104` (path `/runs/{runId}/progress` at `:98`, "CONTRACT ONLY, served by the Hono runs module"); composition `packages/contracts/src/index.ts:38`, re-export `:53`. Field parity re-read against `packages/app/src/workflow/progress-projection.ts:11-146` — 14/14 fields match. Tests `packages/contracts/tests/runs-contract.test.ts:54-95`; probe F confirms the route reaches the generated OpenAPI with the full 200 schema. |
| R4 — `GET /api/runs` accepts `workflow` + `since`; query type and `list()` plumbing; `MALFORMED_SINCE` 400 before the service | MET | `packages/app/src/services/run-store-service.ts:95,100` (query fields) and `:274-280` (`traceRows({ workflow, status, since, before, limit })`, `since` bind at `:277`); `apps/server/src/modules/runs/index.ts:42-53` (parse, `Number.isNaN(Date.parse())` → 400 before `ctx.runStoreService()` at `:56`, normalisation at `:52`), forward at `:57`; absent/empty params → `undefined` → `NULL` bind → SQL unchanged. Tests: `apps/server/tests/modules/runs/index.test.ts:215-232`, `:234-249` (service unreachable), `packages/app/tests/services/run-store-service.test.ts:338-372` (filter results + absent-filter behaviour), `:374-403` (filtered two-page walk returns all 3 matches exactly once, `run_other` excluded). DAO binds pre-existed (`packages/domain/src/dao/run-dao.ts:70-108`); no `packages/domain` file in the change set. |
| R5 — bidirectional assignability guard between the app interface and the wire DTO | MET (with finding 1) | `apps/server/tests/modules/runs/index.test.ts:338-345`; `apps/server/tsconfig.json` includes `tests/**/*.ts`, and this run's three-workspace typecheck exited 0, so the guard compiles. Strength is additive-optional-blind (finding 1, probe D). |
| R6 — docs: module comment table; E72 satellite names `runsContract.progress` + `MALFORMED_SINCE`; `04_DESIGN` wording intact; `cli-contracts.md` untouched | MET | `apps/server/src/modules/runs/index.ts:20-22` lists the filters + `MALFORMED_SINCE` and the progress route with its 404; `docs/design/run-record-contract.md:62` names the shared projection, `workflowProgressProjectionSchema`, contract-only `runsContract.progress` and 400 `MALFORMED_SINCE`; `docs/04_DESIGN.md:81` still reads "Feature E72 Trace tab + run progress route — proposed"; no `cli-contracts.md` change. The stale owning satellite from pass 1 is now updated (`docs/design/observability-contracts.md:327-328,340-341`). |
| AC1 — The Board and the CLI read one progress projection | MET | Server half proven this run: `apps/server/tests/modules/runs/index.test.ts:275-295` fetches `/api/runs/r1/progress`, parses with the shared schema and deep-equals a direct `projectWorkflowProgress('r1', …)` call — the same function `spur workflow progress` invokes at `apps/cli/src/commands/workflow.ts:1738`; unknown id → 404 rather than an empty projection (`:297-311`); `apps/server/tests/openapi.test.ts:46-53` + probe F confirm the route is documented. The Board consumer itself is task 1071, outside this task's scope. |

##### Design conformance (spot-checked against the task's `### Design`)

Every approved choice is implemented as written: a Hono route in the existing module (no `RunStoreService.progress` wrapper — `run-store-service.ts` gained only the two query fields and the two binds), a contract-only `oc.route` mirroring `fleetContract.snapshot` with no `runs` key added to `createRouter` (`apps/server/src/router.ts:28-52` untouched), registration order `by-wbs` → `:runId/progress` → `:runId` (`apps/server/src/modules/runs/index.ts:68,84,97`), read-only with no migration, and the detail route's 404 shape preserved. Absent filters bind `NULL`, so unfiltered list responses are byte-unchanged (`packages/app/tests/services/run-store-service.test.ts:367-369`). Rejected alternatives (second projection, second transport) are absent from the diff. No scope creep: every changed hunk maps to R1–R6, and the only non-requirement change is the pass-1 P3 test/doc fix, which the task's `### Solution` documents.

**Next:** no blockers or majors — PASS on the current tree. Fold finding 1 into task 1070's plan (add an optional-safe drift guard, e.g. an `expectTypeOf`-style exact-shape assertion or a zod `strict()`/key-set comparison, when provenance fields land), optionally route the 404 through `RunStoreNotFoundError` and tighten the `since` parse to ISO-8601-with-offset (findings 2–3), and re-point the stale `## Solution` / verify-answer anchors (finding 5) before `record` transcribes `## Testing`.

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

- 2026-10-04T04:48:36.257Z todo → wip (system)
- 2026-10-04T18:12:27.246Z wip → testing (system)
- 2026-10-04T18:14:36.886Z testing → done (system)

