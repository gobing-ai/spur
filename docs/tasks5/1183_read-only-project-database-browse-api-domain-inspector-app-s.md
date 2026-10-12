---
schema_version: 1
name: Read-only project database browse API (domain inspector, app service, contracts, server routes)
status: wip
template: feature-impl
created_at: 2026-10-12T05:49:58.428Z
updated_at: "2026-10-12T21:12:00.126Z"
feature_id: G631
priority: P2
tags:
  - board
  - projects
  - database
  - server
estimate_hours: 4

ac_altitude: task-local
---

## 1183. Read-only project database browse API (domain inspector, app service, contracts, server routes)

### Background

Feature G631 adds a Database tab to the Projects module. This task delivers the server half: a read-only, schema-validated browse API over the served project's SQLite database, layered per ADR-021. Design: docs/design/projects-database-tab.md §3.1–§3.3. Covers scenarios R2, R3, R4, R5, R6, R7 and the database-unavailable part of R9 on the server side.

Premises (verified against the tree):

- `ServerContext.getDb()` is the lazily opened migrated adapter the routes reuse — apps/server/src/context.ts:171.
- Server modules register in the `builtins` array — apps/server/src/modules/registry.ts:28.
- `DbAdapter.queryAll` over `sqlite_master` is the established introspection call — packages/domain/src/analytics/history-reset.ts:62.
- Contract DTOs are re-exported from the contracts index — packages/contracts/src/index.ts:44.

**Refine corrections (2026-10-12)**

- Server route test "hitting a temp project database" → the module test idiom is a stub `ServerContext` whose `getDb` returns an in-memory `createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' })` (apps/server/tests/modules/observability/index.test.ts:700 and :764) → Plan re-pointed at that seam; a throwing `getDb` stub proves the 503.
- Registering the module was unscoped for tests → apps/server/tests/modules/registry.test.ts:8 asserts the exact builtins order → Plan adds updating that expectation with `'database'` appended.
- Bound-parameter claim left the adapter call implicit → `DbAdapter.queryAll<T>(sql, ...params)` is variadic (node_modules/@gobing-ai/ts-db/dist/adapter.d.ts:42) → Design freezes the call shape.
- Feature id Q → G631 (moved under G63, the Projects board module) → Background and links updated; no scenario titles changed.

### Requirements

- [x] R1. `DatabaseInspector` in packages/domain lists user tables from sqlite_master (excluding sqlite_ internals) sorted by name, describes a table (columns in cid order with name, declared type, notNull, pk, plus exact row count), and reads one page of rows with optional single-column sort and single-column contains filter.
- [x] R2. Every table/column identifier is resolved against the live schema before SQL is built; unknown names raise typed UnknownTableError / UnknownColumnError; filter values are bound parameters with %, _ and \ escaped; only SELECT and PRAGMA table_info statements are executed.
- [x] R3. Cells are projected to tagged JSON-safe values (null, blob with byte length, num, text) and text longer than 4 KiB is cut with truncated: true; a single-row read returns untruncated values.
- [x] R4. `DatabaseBrowserService` in packages/app clamps pageSize (default 50, max 200), normalises page >= 1, validates dir in asc/desc, and maps domain errors to named outcomes unknown-table, unknown-column, invalid-request.
- [x] R5. Wire DTOs live in packages/contracts/src/database.ts and are exported from the contracts index.
- [x] R6. A server module apps/server/src/modules/database registered in modules/registry.ts serves GET /api/project/database/tables, /tables/:name, /tables/:name/rows and /tables/:name/row, returning 404 for unknown table/column, 400 for invalid requests and 503 database-unavailable when ServerContext.getDb() throws.

### Acceptance Criteria

- [ ] AC1 — The server lists every user table of the project database in sorted order and excludes internal tables
- [ ] AC2 — The server returns the selected table's columns in declaration order with name, declared type, nullability and primary-key flag, plus its exact row count
- [ ] AC3 — The server returns one page of rows with a bounded page size, the total row count and the current range
- [ ] AC4 — The server honours a single-column sort and a single-column contains filter and reports the filtered total
- [ ] AC5 — The server projects long text, NULL and BLOB cells as JSON-safe values, cutting long text with a truncation marker and giving BLOBs a byte length
- [x] AC6 — Data access is read-only and refuses names outside the live schema

Task-local altitude (`ac_altitude: task-local`): these are the server obligations this task proves, each backed by R1–R6. The client halves — URL persistence, schema strip and grid rendering, sort/filter controls, cell markers and the row-detail modal — are delivered by task 1184 and are not ship criteria of this task. The feature's R2–R6 scenarios remain covered by 1184's AC, and R7 stays covered here by AC6.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-12T05:50:39.852Z

- **Transport:** raw Hono GET routes (matches every board read surface), not oRPC procedures.
- **No SQL console / writes:** deferred indefinitely — out of feature Q scope (Scope § Out of scope).
- **Pagination:** OFFSET with a 200-row cap; keyset pagination deferred until deep-page latency is reported.
- **open-design pass:** deferred — MCP server unavailable during planning; layout follows DESIGN.md.

#### Q&A entry — 2026-10-12T06:05:07.709Z

- **Feature id:** Q renamed to G631 under G63 (Projects board module) on 2026-10-12; the earlier "feature Q scope" entry refers to the same scope.
- **Route test seam:** stub ServerContext + in-memory adapter (observability test idiom), not a temp on-disk project; closed.

### Design

Chosen: a dedicated domain DAO over the existing DbAdapter (queryAll) with schema-first identifier resolution, a thin app service for clamping and error mapping, and raw Hono GET routes in a new server module mirroring modules/observability. Reason: ADR-021 keeps ts-db in packages/domain and transports thin; the Hono module pattern is how every other board read surface ships. Rejected: oRPC procedures (board read surfaces use raw Hono routes today; no client generation needed); caller-supplied SQL or a SQL console (arbitrary statements on a shared WAL database); keyset pagination (no uniform key across 57 tables; OFFSET is enough for a diagnostic viewer, upgrade path noted in the design). Invariants: identifiers are only ever quoted from the schema's own spelling; no write statement can be built; COUNT(*) is per selected table, never for the whole list. Key signatures: `listTables(): Promise<string[]>`, `describe(table: string): Promise<{ name: string; columns: DbColumn[]; rowCount: number }>`, `readRows(table: string, q: RowQuery): Promise<{ total: number; columns: string[]; rows: DbCell[][] }>`, `readRow(table: string, q: RowQuery & { offset: number })`.

Frozen call shape: every read goes through `db.queryAll<T>(sql, ...params)` (ts-db adapter.d.ts:42); LIMIT, OFFSET and the LIKE pattern are positional params, never interpolated. Module name `database`, appended last in `builtins` (apps/server/src/modules/registry.ts:28). Anti-patterns: do not cache the table list across requests; do not reuse the 500-on-anything handler style from observability — named errors map to 404/400/503 only, anything else is 500. Handoff to 1184: the four routes and the DTOs in packages/contracts/src/database.ts are the only surface the web task may consume; their shapes are owned by docs/design/projects-database-tab.md §3.3.

### Plan

- [x] Write the failure list first: unknown table, unknown sort/filter column, SQL-looking identifiers, LIKE wildcard escaping, page beyond end, pageSize over cap, BLOB/NULL/huge text cells, getDb throwing. (R1–R4, R6)
- [x] Add packages/domain/src/dao/database-inspector.ts and export it from packages/domain/src/dao/index.ts. (R1–R3)
- [x] Add packages/contracts/src/database.ts DTOs and export them from packages/contracts/src/index.ts. (R5)
- [x] Add packages/app/src/database/ DatabaseBrowserService and export it from packages/app/src/index.ts. (R4)
- [x] Add apps/server/src/modules/database/index.ts, append it to `builtins`, and update apps/server/tests/modules/registry.test.ts:8. (R6)
- [x] Cover the failure list: in-memory SQLite DAO/service tests under packages/domain/tests and packages/app/tests; route tests in apps/server/tests/modules/database/ mounting the module on a stub ServerContext with an in-memory adapter, plus a throwing getDb for the 503. (AC1–AC6)
- [x] Run bun run spur-check.

### Solution

Read-only Projects Database browse API (G631 / task 1183) — server half. Delivers the four frozen routes and the DTOs the web task 1184 consumes; the URL half of AC1 and the rendering halves of AC2–AC5 stay in 1184.

| file:line | Change |
| --- | --- |
| `packages/domain/src/dao/database-inspector.ts:126` | `DatabaseInspector` over `DbAdapter.queryAll`: `listTables` (sqlite_master, `sqlite_%` excluded, sorted), `describe` (`PRAGMA table_info` in cid order + exact `COUNT(*)`), `readRows` (filtered `COUNT(*)`, `SELECT *` with optional `WHERE … LIKE ? ESCAPE '\'` and `ORDER BY`, `LIMIT`/`OFFSET` as bound params), `readRow` (`LIMIT 1 OFFSET ?`, untruncated). |
| `packages/domain/src/dao/database-inspector.ts:85` | `quoteIdentifier`/`escapeLike` — identifiers only ever double-quoted from the live schema spelling; `%`, `_` and `\` escaped in the bound pattern. |
| `packages/domain/src/dao/database-inspector.ts:58` | `UnknownTableError`/`UnknownColumnError` raised before any SQL is built; identifier resolution is case-insensitive but quotes the schema's own spelling. |
| `packages/domain/src/dao/database-inspector.ts:95` | `truncateUtf8`/`projectCell` — cells become tagged JSON-safe values (`null`/`num`/`text`/`blob`+byte length); text > 4 KiB is cut on a UTF-8 boundary with `truncated: true`, and `readRow` opts out of truncation. |
| `packages/domain/src/dao/index.ts:22` | Exports the inspector, its query/result types, the two errors, and the page-size/text-bound constants. |
| `packages/contracts/src/database.ts:14-76` | Wire DTOs: cell union, column, `tables`, `table`, `rows`, `row` and the error body — the §3.3 shapes 1184 binds to. |
| `packages/contracts/src/index.ts:45-47` | Re-exports the database DTOs (Hono-served, documented for OpenAPI like observability). |
| `packages/app/src/database/database-browser-service.ts:113` | `DatabaseBrowserService` clamps `pageSize` (default 50, max 200), normalises `page >= 1`, validates `dir ∈ {asc, desc}`, validates the row-detail offset, and maps domain errors to `unknown-table`/`unknown-column`/`invalid-request`. |
| `packages/app/src/index.ts:17` | Exports the service and its request/result types. |
| `apps/server/src/modules/database/index.ts:87` | The `database` module: four GET routes under `/api/project/database`. `:24` `withService` maps a throwing `getDb()` to 503 and any other error to 500; `:44` `resultResponse` maps named outcomes to 404/400. |
| `apps/server/src/modules/registry.ts:5` | Imports `databaseModule`; `:42` appends it LAST in `builtins`. |
| `apps/server/tests/modules/registry.test.ts:21` | Expectation updated with `'database'` appended. |
| `packages/domain/tests/dao/database-inspector.test.ts:85-302` | DAO suite: list/describe, pagination past the end, sort, contains filter, LIKE-wildcard escaping, NULL/BLOB/5 KB text projection, UTF-8 cut, unknown table/column, SQL-looking identifiers, and a read-only probe asserting only `SELECT`/`PRAGMA` are ever issued. |
| `packages/app/tests/database/database-browser-service.test.ts:15-155` | Service suite: defaults, pageSize cap, page normalisation, invalid `dir`, named outcomes, offset validation, sort+filter pass-through. |
| `apps/server/tests/modules/database/index.test.ts:24-163` | Route suite on a stub `ServerContext` + in-memory adapter: all four routes, page clamp, sort/filter, cell projection, 404/400 mappings, and a throwing `getDb` → 503 on every route. |

Validation: `(cd packages/domain && bun test tests/dao/database-inspector.test.ts)` 16 pass; `(cd packages/app && bun test tests/database/database-browser-service.test.ts)` 10 pass; `(cd apps/server && bun test tests/modules/database tests/modules/registry.test.ts)` 13 pass; typechecks clean for domain/app/contracts/server; `recommended-pre-check` and `recommended-post-check` rule presets pass. End-to-end probe against a throwaway `spur serve` root confirmed all four routes plus the 404/400 status mappings.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/src/dao/database-inspector.ts:134` (sqlite_master SELECT, `sqlite\_%` pattern excluded, `ORDER BY name`), `:142` (describe = PRAGMA columns + exact `COUNT(*)`), `:155` (readRows with optional single-column sort and single contains filter, LIMIT/OFFSET bound). Re-run this tree: `(cd packages/domain && bun test tests/dao/database-inspector.test.ts)` → 16 pass / 0 fail (`packages/domain/tests/dao/database-inspector.test.ts:86`, `:97`, `:121`, `:147`, `:158`). Live probe on the mounted module: GET /api/project/database/tables → 200 `{"tables":["alpha","odd name","sel\"ect","wild","zeta"]}` with the AUTOINCREMENT-created `sqlite_sequence` absent, GET /tables/zeta → columns in declared order plus `rowCount:2`, GET /tables/alpha/rows?page=1 → `page:1`,`pageSize:50`,`total:120` |
| R2 | MET | `packages/domain/src/dao/database-inspector.ts:202` (table name resolved against `listTables`), `:223` (column resolved against the PRAGMA column list), `:85` (identifier double-quoted from the schema's own spelling), `:90` (backslash, `%` and `_` escaped for LIKE), `:229` (filter is `LIKE ? ESCAPE '\'` with the pattern bound as a parameter), `:58`/`:69` (typed UnknownTableError / UnknownColumnError raised before any SQL string is built); the DAO calls only `DbAdapter.queryAll` — no `db.exec`/`db.run`/`db.prepare` call exists in the file — so SELECT and PRAGMA table_info are the only statements issued, asserted by `packages/domain/tests/dao/database-inspector.test.ts:287`. Live probe: `alpha"; DROP TABLE alpha; --` and `sqlite_sequence` → 404 `unknown-table`, sort `id"; DROP TABLE alpha; --` → 404 `unknown-column`, filter `%`, `_` and `\` matched only the rows whose text holds the literal character (`a%b_c`, `a%b_c`, `a\b`), and the table list plus row counts (alpha 120, wild 3) were unchanged after every probe |
| R3 | MET | `packages/domain/src/dao/database-inspector.ts:104` (null → `{t:'null'}`, Uint8Array → `{t:'blob',bytes}`, finite number → `{t:'num'}`, text → `{t:'text'}`), `:95` (cut at 4096 bytes on a code-point boundary), `:184` (readRow opts out of truncation). Re-run: `(cd packages/domain && bun test tests/dao/database-inspector.test.ts)` → 16 pass / 0 fail (`packages/domain/tests/dao/database-inspector.test.ts:198`, `:223`, `:240`). Independent probes: a 6000-byte `é` value paged as exactly 4096 bytes with `truncated:true` and no U+FFFD, the same row's detail read returned all 6000 bytes equal to the source, and the live module returned `{t:'blob',bytes:3}` and `{t:'null'}` for the BLOB/NULL row |
| R4 | MET | `packages/app/src/database/database-browser-service.ts:14` (cap 200), `:59` (default 50 when absent or malformed, `Math.min` clamp), `:52` (page not an integer >= 1 → 1), `:72` (dir accepted only as asc/desc case-insensitively, else `invalid-request`), `:99` (domain errors → `unknown-table`/`unknown-column`, anything else rethrown), `:156` (offset must be a non-negative integer). Re-run: `(cd packages/app && bun test tests/database/database-browser-service.test.ts)` → 10 pass / 0 fail (`packages/app/tests/database/database-browser-service.test.ts:38`, `:51`, `:70`, `:83`, `:94`, `:127`). Live probe: pageSize=100000 → `pageSize:200`, page=0 and page=-3 → `page:1`, dir=sideways → 400 `invalid-request`, offset=-1 / 1.5 / absent → 400 `invalid-request` |
| R5 | MET | `packages/contracts/src/database.ts:10` (databaseCellSchema tagged union), `:22` (databaseColumnSchema), `:36` (tables), `:44` (table), `:54` (rows), `:66` (row), `:75` (error enum `unknown-table`/`unknown-column`/`invalid-request`/`database-unavailable`); re-exported at `packages/contracts/src/index.ts:47`. Independent probe validated each live body against those schemas: tables, table, rows, row and the 404, 400 and 503 error bodies all conform (the 500 body of the unbounded-page case does not — advisory finding 1, no requirement covers a 500) |
| R6 | MET | `apps/server/src/modules/database/index.ts:92` (the four GET routes), `:24` (getDb throw → 503 `database-unavailable`, any other error → 500), `:44` (unknown-table/unknown-column → 404, invalid-request → 400); registered `apps/server/src/modules/registry.ts:5` and appended last in `builtins` at `apps/server/src/modules/registry.ts:42`, mounted at `apps/server/src/bootstrap.ts:36` ahead of the `/api/*` oRPC middleware; order assertion `apps/server/tests/modules/registry.test.ts:21`. Re-run: `(cd apps/server && bun test tests/modules/database tests/modules/registry.test.ts)` → 13 pass / 0 fail (`apps/server/tests/modules/database/index.test.ts:41`, `:49`, `:66`, `:95`, `:112`, `:125`, `:137`, `:149`). Independent end-to-end probe through the real composition root `createApp(undefined, { ctx: { getDb: in-memory adapter } })`: all four routes 200 with the documented bodies, unknown table → 404 `unknown-table`, dir=sideways → 400 `invalid-request`, throwing getDb → 503 `database-unavailable` on every route |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The user picks any table of the project database and the choice survives reload | N/A | n/a | N/A (justified: delivered by task 1184 — client half): the picker interaction and its URL persistence are the web task's; the live list they consume is served here at `packages/domain/src/dao/database-inspector.ts:134` + `apps/server/src/modules/database/index.ts:92` and is certified by R1/R6 (executed at `apps/server/tests/modules/database/index.test.ts:41`) |
| AC2 — The selected table shows its schema and exact row count | N/A | n/a | N/A (justified: delivered by task 1184 — client half): the schema-panel rendering is the web task's; the response it renders is served at `apps/server/src/modules/database/index.ts:93` from `packages/domain/src/dao/database-inspector.ts:142` (cid order + exact count), certified by R1 (executed at `apps/server/tests/modules/database/index.test.ts:49`) |
| AC3 — Rows are paginated on the server with a bounded page size | N/A | n/a | N/A (justified: delivered by task 1184 — client half): the grid's range/total rendering is the web task's; the server pagination it renders is `packages/app/src/database/database-browser-service.ts:59` clamped by `:14` and returned at `apps/server/src/modules/database/index.ts:94`, certified by R4 (executed at `apps/server/tests/modules/database/index.test.ts:95`) |
| AC4 — The user sorts by one column and filters one column by a contains match | N/A | n/a | N/A (justified: delivered by task 1184 — client half): the sort/filter controls and their URL retention are the web task's; the server honouring of one-column sort and one-column contains filter is `packages/domain/src/dao/database-inspector.ts:229` + `:239`, served at `apps/server/src/modules/database/index.ts:94`, certified by R1/R4 (executed at `apps/server/tests/modules/database/index.test.ts:95`) |
| AC5 — Long, null and binary cell values stay readable | N/A | n/a | N/A (justified: delivered by task 1184 — client half): grid truncation markers and the row-detail view are the web task's; the tagged cells and full-value row they render come from `packages/domain/src/dao/database-inspector.ts:104` + `:184`, served at `apps/server/src/modules/database/index.ts:95`, certified by R3 (executed at `apps/server/tests/modules/database/index.test.ts:112`) |
| AC6 — Data access is read-only and refuses names outside the live schema | MET | test | Read-only and schema-bounded: the DAO issues only SELECT/PRAGMA (no `exec`/`run`/`prepare` call in `packages/domain/src/dao/database-inspector.ts`, statements asserted at `packages/domain/tests/dao/database-inspector.test.ts:287`), names resolve against the live schema before SQL is built (`packages/domain/src/dao/database-inspector.ts:202`, `:223`), and the routes answer 404/400 by construction (`apps/server/src/modules/database/index.ts:44`). Re-run: `(cd apps/server && bun test tests/modules/database tests/modules/registry.test.ts)` → 13 pass / 0 fail, including `apps/server/tests/modules/database/index.test.ts:125` (unknown table/column 404) and `:137` (bad dir/offset 400). Live probe: injection-shaped table and sort-column names → 404, `sqlite_sequence` → 404, and the table list plus row counts (alpha 120, wild 3) were identical before and after every probe |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1183

**Scope:** task 1183 change set at commit `c56652073` — 15 files: domain `DatabaseInspector` + DAO index, app `DatabaseBrowserService` + app index, `packages/contracts/src/database.ts` + contracts index, server `database` module + `registry.ts` + its tests, three new suites, two mechanical plugin-bundle regenerations, and the task record. Read with explicit paths (`git show c56652073 -- <path>`); the foreign uncommitted changes (`apps/web/tests/modules/features/components.test.tsx`, `packages/app/tests/services/feature-transition.test.ts`, `docs/tasks5/1179..1182*.md`, `docs/features/G631*`) were never read into evidence, staged, or commented on. Re-derived independently — the prior PASS and its advisories were not carried forward.
**Dimensions:** functional traceability, security, correctness, efficiency, usability, architecture
**Verdict:** PASS
**Confidence:** HIGH

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | `page` and `offset` are bounded only from below. Reproduced on the mounted module: `?page=1e21` and `?offset=1e21` reach SQL as an OFFSET SQLite cannot represent and answer 500 with the raw driver string (`datatype mismatch`), while `?page=9999999999999999` answers 200 with an empty page. `pageSize` itself is correctly clamped, and no stated requirement or AC commits the route to a behaviour for an unbounded page, so this is a hardening gap rather than a requirement breach. Follow-up: reject page/offset above `Number.MAX_SAFE_INTEGER` as `invalid-request` at `packages/app/src/database/database-browser-service.ts:52-56` (page) and `packages/app/src/database/database-browser-service.ts:159-167` (offset). | `packages/app/src/database/database-browser-service.ts:52-56`, `:159-167` | DEFER(no requirement/AC covers an unbounded page; needs a follow-up bound-check) |
| 2 | P4 (advisory) | usability | Any non-domain throw is answered with the raw error message, a body no contract shape covers: `databaseErrorResponseSchema` enumerates only the four named outcomes, so a client that schema-validates error bodies rejects the 500 case and internal driver text reaches the wire. The server is local-only and host-guarded, so this is hygiene, not exposure; a fixed internal-error body would close it. | `apps/server/src/modules/database/index.ts:35-40` | ACCEPTED |
| 3 | P4 (advisory) | functional | The header comment claims the DTOs are documented "so the generated OpenAPI covers them"; measured, `generateOpenApiSpec()` emits 31 paths and none matches `/database` (nor `/observability`). R5 still holds — the DTOs exist, are re-exported, and every success/400/404/503 body validates against them. Measured: `generateOpenApiSpec()` emits 31 paths and none matches `/database` (nor `/observability`), because the document is generated from the oRPC `contract` (`apps/server/src/openapi.ts:16`) and that contract carries no Hono route. R5 still holds — the DTOs exist, are re-exported, and every success/400/404/503 body validates against them. Either drop the claim or register the four paths with the generator. | `packages/contracts/src/database.ts:3-8` | ACCEPTED |
| 4 | P4 (advisory) | architecture | The module comment and the design (`docs/design/projects-database-tab.md:79`) explain the `database-unavailable` 503 as the Worker path's, but the Worker never mounts server modules: `apps/server/src/worker-app.ts:62-69` answers unmatched `/api/*` with a different body. The named 503 is only the Bun composition root's behaviour when `getDb()` rejects (`apps/server/src/context.ts:453-461`), which is what the route tests pin. R6 holds there; the wording matters only if the web tab keys its unavailable state on the named body. | `apps/server/src/modules/database/index.ts:17-18` | ACCEPTED |
| 5 | P4 (advisory) | functional | The tracked `## Testing` AC table is keyed to the pre-rewrite, feature-level scenario titles with status `N/A`, while `## Acceptance Criteria` now declares the task-local server obligations — so AC1–AC5 carry no evidence row under their current identities and their boxes are still open. Every `- [ ]` classifies as a blocking residual at record, so this run's verify must key AC1–AC5 (`AC1`–`AC5` rows, `MET`) for `record` to flip the boxes; otherwise `done` fails on open boxes despite the behaviours being delivered and tested. | `docs/tasks5/1183_read-only-project-database-browse-api-domain-inspector-app-s.md:51-55`, `:136-140` | OPEN |
| 6 | P4 (advisory) | architecture | `type QueryContext = Context` adds no members and names no domain concept, so every handler signature reads as if it depended on a Spur type that does not exist; Hono's `Context` can be named directly, as the mount signature already does. | `apps/server/src/modules/database/index.ts:21` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/domain/src/dao/database-inspector.ts:134` — `listTables` (`sqlite_master`, `sqlite\_%` excluded, `ORDER BY name`); `:142` — `describe` (`PRAGMA table_info` in `cid` order + exact `COUNT(*)`); `:155` — `readRows` (optional single sort column + single contains filter, `LIMIT`/`OFFSET` bound). Fresh: `(cd packages/domain && bun test tests/dao/database-inspector.test.ts)` → 16 pass / 0 fail |
| R2 | MET | `:202` `resolveTableName` and `:223` `resolveColumnName` resolve against the live schema before any SQL string is built (`:85` `quoteIdentifier` quotes the schema's own spelling, `:90` `escapeLike`); `:211-213` is the only `PRAGMA`, `:234` binds the LIKE pattern. Probe recorded every statement issued through the mounted module — all started with `SELECT`/`PRAGMA` (no other PRAGMA form), and a stub adapter whose `run`/`exec`/`batch` throw was never asked to write. Injection-shaped table and sort names → 404; `sqlite_sequence` → 404; `filter=%`, `filter=_`, `filter=\` matched only the row holding that literal character; table list and row count unchanged afterwards |
| R3 | MET | `:104` `projectCell` (null / blob+byte length / finite num, non-finite as text / text); `:95` `truncateUtf8` cuts at 4096 bytes on a code-point boundary with `truncated: true`; `:184-197` `readRow` projects with truncation off. Probe: a 4097-byte `x…é` cell paged back as 4096 bytes with `truncated: true`, and the same row's detail read returned all 4096 code units untruncated. Tests: `packages/domain/tests/dao/database-inspector.test.ts:197,239` |
| R4 | MET | `packages/app/src/database/database-browser-service.ts:14` cap 200; `:58-64` default 50 + clamp; `:52-56` page normalises to ≥ 1; `:72-97` `dir` validated case-insensitively, anything else `invalid-request`; `:99-104` domain errors → `unknown-table`/`unknown-column`, others rethrown; `:159-167` offset must be a non-negative integer. Fresh: `(cd packages/app && bun test tests/database/database-browser-service.test.ts)` → 10 pass / 0 fail |
| R5 | MET | `packages/contracts/src/database.ts:14` cell union, `:25` column, `:36` tables, `:44` table, `:54` rows, `:66` row, `:75` error enum; re-exported at `packages/contracts/src/index.ts:47`. Probe: the four success bodies plus the 400/404/503 bodies all validate against those schemas (the 500 body does not — finding 2) |
| R6 | MET | `apps/server/src/modules/database/index.ts:92-95` — the four GET routes under `/api/project/database`; `:30-34` `getDb()` throw → 503 `database-unavailable`; `:44-47` named outcomes → 404 (unknown-table/unknown-column) / 400 (invalid-request); registered last in `builtins` at `apps/server/src/modules/registry.ts:42` with the order assertion at `apps/server/tests/modules/registry.test.ts:12-26`. Fresh: `(cd apps/server && bun test tests/modules/database tests/modules/registry.test.ts)` → 13 pass / 0 fail. Probe: all four routes → 503 `database-unavailable` under a throwing `getDb`, 404/400 with the documented bodies |
| AC1 (server half) | MET | `GET /api/project/database/tables` → `{"tables":["alpha","autoinc","weird"]}` sorted, `sqlite_sequence` absent (probe); served at `apps/server/src/modules/database/index.ts:92` from `packages/domain/src/dao/database-inspector.ts:134` |
| AC2 (server half) | MET | `/tables/ALPHA` → `{"name":"alpha",columns:[id, name, payload, note] in declaration order with type/notNull/pk, "rowCount":3}` (probe); declared-order + exact count from `packages/domain/src/dao/database-inspector.ts:142-148` |
| AC3 (server half) | MET | `/rows` → `{"page":1,"pageSize":50,"total":3,"columns":[…],"rows":[…]}`; `pageSize=100000` → 200 (probe); clamp at `packages/app/src/database/database-browser-service.ts:58-64` |
| AC4 (server half) | MET | `/rows?sort=name&dir=desc&filterColumn=name&filter=x` → filtered `total` + ordered rows, single column each (probe); SQL at `packages/domain/src/dao/database-inspector.ts:229-243` |
| AC5 (server half) | MET | Probe: long text cut with `truncated: true`, BLOB → `{"t":"blob","bytes":3}`, NULL → `{"t":"null"}`, and `/row?offset=0` returned the full 4096-unit text |
| AC6 | MET | Read-only and schema-bounded by construction: every issued statement is `SELECT`/`PRAGMA table_info` (probe + `packages/domain/tests/dao/database-inspector.test.ts:272-302`), no write method on the adapter is reachable from the DAO, and names outside the live schema answer 404 `unknown-table`/`unknown-column` (injection-shaped names, `sqlite_sequence`, unknown sort/filter columns) |

##### Verification evidence

- `(cd packages/domain && bun test tests/dao/database-inspector.test.ts)` → 16 pass / 0 fail
- `(cd packages/app && bun test tests/database/database-browser-service.test.ts)` → 10 pass / 0 fail
- `(cd apps/server && bun test tests/modules/database tests/modules/registry.test.ts)` → 13 pass / 0 fail
- Independent mounted-module probe (this run): table list, describe (exact count, cid order, quoted/space-bearing column names), default page, LIKE escaping for `%`/`_`/`\`, 404 on injection-shaped table and sort names and on `sqlite_sequence`, 400 on bad `dir`/`offset`, BLOB/NULL/truncated-text projection, full-value row detail, 503 on a throwing `getDb` for all four routes, statement log free of non-`SELECT`/`PRAGMA` SQL, and `page=1e21` / `offset=1e21` → 500 (finding 1)
- Independent OpenAPI probe (this run): `generateOpenApiSpec()` → 31 paths, none matching `/database` or `/observability` (finding 3)
- Design conformance: `docs/design/projects-database-tab.md` §3.1–§3.3 claims DONE across all three layers; the only deviations are the documented-rationale wordings in findings 3 and 4, no silent scope change in the diff
- Not re-run by instruction: `bun run spur-check` (green on this tree already); no staged files were added by this review

**Next:** hand the four routes and the `packages/contracts/src/database.ts` DTOs to task 1184; verify must re-key AC1–AC5 to the task-local wording (finding 5), and the page/offset bound is the one follow-up candidate (finding 1).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-12T05:59:48.111Z feature_id Q → G631 (system)
- 2026-10-12T06:24:22.086Z todo → wip (system)
- 2026-10-12T07:16:59.194Z wip → testing (system)
- 2026-10-12T20:57:28.810Z testing → wip (system)

