---
schema_version: 1
name: Read-only project database browse API (domain inspector, app service, contracts, server routes)
status: todo
template: feature-impl
created_at: 2026-10-12T05:49:58.428Z
updated_at: "2026-10-12T06:05:07.710Z"
feature_id: G631
priority: P2
tags:
  - board
  - projects
  - database
  - server
estimate_hours: 4

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

- [ ] R1. `DatabaseInspector` in packages/domain lists user tables from sqlite_master (excluding sqlite_ internals) sorted by name, describes a table (columns in cid order with name, declared type, notNull, pk, plus exact row count), and reads one page of rows with optional single-column sort and single-column contains filter.
- [ ] R2. Every table/column identifier is resolved against the live schema before SQL is built; unknown names raise typed UnknownTableError / UnknownColumnError; filter values are bound parameters with %, _ and \ escaped; only SELECT and PRAGMA table_info statements are executed.
- [ ] R3. Cells are projected to tagged JSON-safe values (null, blob with byte length, num, text) and text longer than 4 KiB is cut with truncated: true; a single-row read returns untruncated values.
- [ ] R4. `DatabaseBrowserService` in packages/app clamps pageSize (default 50, max 200), normalises page >= 1, validates dir in asc/desc, and maps domain errors to named outcomes unknown-table, unknown-column, invalid-request.
- [ ] R5. Wire DTOs live in packages/contracts/src/database.ts and are exported from the contracts index.
- [ ] R6. A server module apps/server/src/modules/database registered in modules/registry.ts serves GET /api/project/database/tables, /tables/:name, /tables/:name/rows and /tables/:name/row, returning 404 for unknown table/column, 400 for invalid requests and 503 database-unavailable when ServerContext.getDb() throws.

### Acceptance Criteria

- [ ] AC1 — The user picks any table of the project database and the choice survives reload
- [ ] AC2 — The selected table shows its schema and exact row count
- [ ] AC3 — Rows are paginated on the server with a bounded page size
- [ ] AC4 — The user sorts by one column and filters one column by a contains match
- [ ] AC5 — Long, null and binary cell values stay readable
- [ ] AC6 — Data access is read-only and refuses names outside the live schema

Task-local checks: the URL persistence half of AC1 and the rendering halves of AC2–AC5 are delivered by the web task; this task proves the server responses those halves consume.

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

- [ ] Write the failure list first: unknown table, unknown sort/filter column, SQL-looking identifiers, LIKE wildcard escaping, page beyond end, pageSize over cap, BLOB/NULL/huge text cells, getDb throwing. (R1–R4, R6)
- [ ] Add packages/domain/src/dao/database-inspector.ts and export it from packages/domain/src/dao/index.ts. (R1–R3)
- [ ] Add packages/contracts/src/database.ts DTOs and export them from packages/contracts/src/index.ts. (R5)
- [ ] Add packages/app/src/database/ DatabaseBrowserService and export it from packages/app/src/index.ts. (R4)
- [ ] Add apps/server/src/modules/database/index.ts, append it to `builtins`, and update apps/server/tests/modules/registry.test.ts:8. (R6)
- [ ] Cover the failure list: in-memory SQLite DAO/service tests under packages/domain/tests and packages/app/tests; route tests in apps/server/tests/modules/database/ mounting the module on a stub ServerContext with an in-memory adapter, plus a throwing getDb for the 503. (AC1–AC6)
- [ ] Run bun run spur-check.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-12T05:59:48.111Z feature_id Q → G631 (system)

