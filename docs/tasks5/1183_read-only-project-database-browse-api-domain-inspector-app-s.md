---
schema_version: 1
name: Read-only project database browse API (domain inspector, app service, contracts, server routes)
status: done
template: feature-impl
created_at: 2026-10-12T05:49:58.428Z
updated_at: "2026-10-13T03:46:07.982Z"
feature_id: G631
priority: P2
tags:
  - board
  - projects
  - database
  - server
estimate_hours: 4

ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1183-verdict.json
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

- [x] AC1 — The server lists every user table of the project database in sorted order and excludes internal tables (covers: R2 — The user picks any table of the project database and the choice survives reload)
- [x] AC2 — The server returns the selected table's columns in declaration order with name, declared type, nullability and primary-key flag, plus its exact row count (covers: R3 — The selected table shows its schema and exact row count)
- [x] AC3 — The server returns one page of rows with a bounded page size, the total row count and the current range (covers: R4 — Rows are paginated on the server with a bounded page size)
- [x] AC4 — The server honours a single-column sort and a single-column contains filter and reports the filtered total (covers: R5 — The user sorts by one column and filters one column by a contains match)
- [x] AC5 — The server projects long text, NULL and BLOB cells as JSON-safe values, cutting long text with a truncation marker and giving BLOBs a byte length (covers: R6 — Long, null and binary cell values stay readable)
- [x] AC6 — Data access is read-only and refuses names outside the live schema (covers: R7 — Data access is read-only and refuses names outside the live schema)

Task-local altitude (`ac_altitude: task-local`): each row states the server obligation THIS task proves, with `(covers: <feature scenario>)` naming the G631 scenario whose server half it delivers. The client halves — URL persistence, schema strip and grid rendering, sort/filter controls, cell markers and the row-detail modal — are delivered by task 1184 and are not ship criteria of this task.

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
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/src/dao/database-inspector.ts:134` listTables reads sqlite_master excluding sqlite internals; `packages/domain/src/dao/database-inspector.ts:142` describe returns cid-ordered columns plus exact COUNT at `packages/domain/src/dao/database-inspector.ts:146`; `packages/domain/src/dao/database-inspector.ts:155` readRows pages with one sort and one contains filter. Fresh: domain database-inspector suite 16 pass / 0 fail (`packages/domain/tests/dao/database-inspector.test.ts:86`, `:97`, `:121`) |
| R2 | MET | resolveTableName `packages/domain/src/dao/database-inspector.ts:202`, readColumns `:210`, resolveColumnName `:223` resolve every identifier against the live schema; UnknownTableError `:58`, UnknownColumnError `:69`; quoteIdentifier `:85`; escapeLike `:90`; bound LIKE with ESCAPE at `:234`. Only SELECT and PRAGMA issued: `packages/domain/tests/dao/database-inspector.test.ts:287`; SQL-looking names refused `packages/domain/tests/dao/database-inspector.test.ts:271` |
| R3 | MET | projectCell `packages/domain/src/dao/database-inspector.ts:104` emits null/num/text/blob; truncateUtf8 `:95` cuts at DATABASE_TEXT_CELL_MAX_BYTES `:7` with truncated true; readRow `:184` reads untruncated. Tests `packages/domain/tests/dao/database-inspector.test.ts:198`, `:223`, `:240` |
| R4 | MET | `packages/app/src/database/database-browser-service.ts:14` MAX_DATABASE_PAGE_SIZE 200, normalizePageSize `:75`, normalizePage `:66` bounded by MAX_DATABASE_PAGE `:24` (1186), normalizeRowQuery `:88`, mapDomainFailure `:123`. Fresh: app tests/database 13 pass / 0 fail (`packages/app/tests/database/database-browser-service.test.ts:38`, `:51`, `:83`, `:162`) |
| R5 | MET | Wire schemas in `packages/contracts/src/database.ts:12` (cell union with truncated flag) re-exported at `packages/contracts/src/index.ts:47`. Fresh: contracts suite 89 pass / 0 fail |
| R6 | MET | Four GET routes `apps/server/src/modules/database/index.ts:92-95`; getDb failure maps to 503 at `apps/server/src/modules/database/index.ts:33`; resultResponse `:44` maps invalid-request to 400 and unknown names to 404; registered at `apps/server/src/modules/registry.ts:42`, asserted `apps/server/tests/modules/registry.test.ts:21`. Fresh: server database + registry 14 pass / 0 fail |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R2 — The user picks any table of the project database and the choice survives reload | MET | test | Server half: the tables route lists every user table, `apps/server/tests/modules/database/index.test.ts:41`; domain list `packages/domain/tests/dao/database-inspector.test.ts:86` |
| Scenario: R3 — The selected table shows its schema and exact row count | MET | test | `apps/server/tests/modules/database/index.test.ts:49` schema plus exact rowCount; `packages/domain/tests/dao/database-inspector.test.ts:97` |
| Scenario: R4 — Rows are paginated on the server with a bounded page size | MET | test | `apps/server/tests/modules/database/index.test.ts:95` clamps pageSize; `apps/server/tests/modules/database/index.test.ts:152` unrepresentable page returns 400; `packages/domain/tests/dao/database-inspector.test.ts:121`, `:137` |
| Scenario: R5 — The user sorts by one column and filters one column by a contains match | MET | test | `apps/server/tests/modules/database/index.test.ts:95` sort and filter; `packages/domain/tests/dao/database-inspector.test.ts:147`, `:158`, `:170` LIKE escape |
| Scenario: R6 — Long, null and binary cell values stay readable | MET | test | `apps/server/tests/modules/database/index.test.ts:66` cell projection; `apps/server/tests/modules/database/index.test.ts:112` untruncated row read; `packages/domain/tests/dao/database-inspector.test.ts:198`, `:223` |
| Scenario: R7 — Data access is read-only and refuses names outside the live schema | MET | test | `packages/domain/tests/dao/database-inspector.test.ts:287` only SELECT and PRAGMA; `packages/domain/tests/dao/database-inspector.test.ts:259`, `:271`; `apps/server/tests/modules/database/index.test.ts:125` 404, `:137` 400 |
| Scenario: R9 — Empty, unknown and unavailable states are named, never blank | MET | test | Server half: `apps/server/tests/modules/database/index.test.ts:164` 503 database-unavailable, `apps/server/tests/modules/database/index.test.ts:125` 404 unknown-table; live E2E .spur/run/g631-e2e.sh got unknown-table for a missing table |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1183

**Scope:** task 1183 change set at commit `c56652073` — 15 files: domain `DatabaseInspector` + DAO index, app `DatabaseBrowserService` + app index, `packages/contracts/src/database.ts` + contracts index, the server `database` module + `registry.ts` + its tests, three new suites, two mechanical plugin-bundle regenerations, and the task record. Plus the change this re-certification pass exists for: the uncommitted re-anchor of the task's `## Acceptance Criteria` (HEAD carries the un-bound wording, the working tree carries the `(covers: R<n> — …)` bindings — `git diff -- docs/tasks5/1183_...md`). Read with explicit paths (`git show c56652073 -- <path>`); never a bare `git diff`. Foreign uncommitted changes (`apps/web/tests/modules/features/components.test.tsx`, `packages/app/tests/services/feature-transition.test.ts`, `docs/tasks5/1179..1182*.md`) were never read into evidence, staged, or commented on. Re-derived from the tree; the prior PASS and its advisories were not carried forward, and each of its five items is re-confirmed or refuted below with its own probe.

**Dimensions:** functional traceability, security, correctness, efficiency, usability, architecture

**Verdict:** PASS

**Confidence:** HIGH

##### Re-certification of the change under review (the AC re-anchor)

Only the task file's `## Acceptance Criteria` section changed since the previous PASS; no source or test file of this task changed — verified: `git diff --quiet c56652073 HEAD -- <path>` is clean for all eleven code/test paths of the change set, and the only later difference in `packages/app/src/index.ts` is an unrelated `feature-verification-run` export block added by another task (`git diff c56652073 HEAD -- packages/app/src/index.ts`). Each row's binding was checked against the feature's own scenario list, character for character:

- AC1→`covers: R2` = `docs/features/G631_...md:53` "The user picks any table of the project database and the choice survives reload" — exact.
- AC2→R3 (`:60`), AC3→R4 (`:67`), AC4→R5 (`:74`), AC5→R6 (`:81`), AC6→R7 (`:88`) — all exact, one-to-one, no gap and no off-by-one in the G631 scenario numbering (R1 is the tab, R8/R9 the client shell states, correctly unbound).
- The `task-local` altitude claim holds: every AC row states a server obligation with a test at `apps/server/tests/modules/database/index.test.ts` (AC1 `:41`, AC2 `:49`, AC3 `:95`, AC4 `:95`, AC5 `:112`, AC6 `:125`/`:137`).

Result: the re-anchored rows now name the obligations this task proves, and AC1–AC6 trace to G631 R2–R7 with exact scenario titles. Two traceability residues of the re-anchor remain (findings 4 and 5) — both advisory.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | `page` and `offset` are bounded only from below, so an integer-valued but unrepresentable value reaches SQL as an OFFSET the driver rejects. Reproduced on the mounted module: `?page=1e21` → 500 `{"error":"datatype mismatch"}` and `?offset=1e21` → 500 (same for `1e300`), where `?page=9999999999999999` answers 200 with an empty page and `?pageSize=1e21` is clamped to 200 correctly. `Number.isInteger(1e21)` is true, so `normalizePage` (`packages/app/src/database/database-browser-service.ts:52-56`) passes it and the offset validator (`:159-167`) does the same; the product is bound as OFFSET at `packages/domain/src/dao/database-inspector.ts:167`. No requirement or AC commits the routes to a behaviour for an unbounded page (R4 bounds `pageSize` only), it is unreachable from the documented client (the design's pager drives `?page=` from integer URL state, `docs/design/projects-database-tab.md:90-91`), and there is no data loss or exposure — a hardening gap, not a requirement breach. | `packages/app/src/database/database-browser-service.ts:52-56`, `:159-167` | FIXED(task 1186, commit 45465ed47: page/offset above MAX_SAFE_INTEGER answer 400 invalid-request; apps/server/tests/modules/database/index.test.ts:152) |
| 2 | P4 (advisory) | usability | Any non-domain throw is answered with the raw message: `c.json({ error: message }, 500)` at `:39` emits a body no contract shape covers — `databaseErrorResponseSchema` (`packages/contracts/src/database.ts:75-77`) enumerates only the four named outcomes, so a client that schema-validates error bodies rejects the 500 case and the driver string reaches the wire (confirmed by probe: `{"error":"datatype mismatch"}`, not one of the four). The server is the local, host-guarded runtime, so this is hygiene rather than exposure; a fixed internal-error body would close it. | `apps/server/src/modules/database/index.ts:35-40` | ACCEPTED |
| 3 | P4 (advisory) | functional | The header comment claims the DTOs are documented "so the generated OpenAPI covers them". Measured on this tree, `generateOpenApiSpec()` emits 31 paths and none matches `/database` (nor `/observability`), because the document is generated from the oRPC `contract` and that contract carries no Hono route (`apps/server/src/openapi.ts:13-20`, served at `apps/server/src/worker-app.ts:60`). The same claim appears in `packages/contracts/src/index.ts:45-46`. R5 still holds — the DTOs exist, are re-exported, and every success/400/404/503 body validates against them. Either drop the claim or register the four paths with the generator. | `packages/contracts/src/database.ts:3-8` | FIXED(comments now say the DTOs type clients only and are absent from the generated OpenAPI; packages/contracts/src/database.ts:3-9, packages/contracts/src/index.ts:45) |
| 4 | P4 (advisory) | functional | The `## Testing` AC table (lines 136–141) is keyed to the pre-rewrite feature-scenario titles with status `N/A` while `## Acceptance Criteria` (lines 51–56) now declares the task-local server obligations — same ids, different titles, so AC1–AC5 carry no evidence row under their current identities, and their boxes are still open while AC6 is checked. Unchecked boxes are blocking for `scanResiduals` (`plugins/sp/scripts/residual-scan.mjs:123-126`, `:128-137` — `unchecked-box` is never P4 and never deferrable) though not for this review gate (`:232-238` builds the gate artifact from findings and contract violations only). The behaviours themselves are delivered and tested. This run's verify/record must key AC1–AC5 as `MET` for `record` to flip the boxes; otherwise `done` fails on open boxes. | `docs/tasks5/1183_read-only-project-database-browse-api-domain-inspector-app-s.md:51-56`, `:136-141` | FIXED(verify re-keyed AC rows by feature scenario title and record flipped every box; spur task check 1183 clean) |
| 5 | P4 (advisory) | functional | The Background claims coverage of "the database-unavailable part of R9" (`:24`) but no AC row binds R9 — AC1–AC6 bind R2–R7 only, so R9's server half (named unknown/unavailable states → 404/503) has no AC anchor even though the 503 path is tested (`apps/server/tests/modules/database/index.test.ts:137-163`). The re-anchor either wanted a seventh binding row or should drop the R9 claim from Background; coverage itself is real. | `docs/tasks5/1183_read-only-project-database-browse-api-domain-inspector-app-s.md:24`, `:51-56` | FIXED(verify adds the R9 feature-scenario row bound to the 503 route test apps/server/tests/modules/database/index.test.ts:164) |
| 6 | P4 (advisory) | architecture | The module comment explains the named 503 as "the Worker's 503", but the Worker never mounts server modules: `apps/server/src/worker-app.ts:62-69` answers every unmatched `/api/*` with `{ error: 'This endpoint requires the local Bun server runtime.' }`, and the only 503 with the body `{ error: 'database-unavailable' }` is produced by this module itself at `:33` when the Bun root's `getDb()` rejects (`apps/server/src/context.ts:453-461`). The wording matches its design owner (`docs/design/projects-database-tab.md:34` "on the Cloudflare Worker path it throws `D1NotConfiguredError`", `:79` "when `getDb()` throws (Worker path)"), so the comment is faithful to the design and the underlying "Worker path" premise belongs to the design doc, not to this diff; R6 is met where it is asserted and the route tests pin exactly that seam. No change required here. | `apps/server/src/modules/database/index.ts:17-18` | REFUTED(matches design owner `docs/design/projects-database-tab.md:34`, `:79`; the named 503 is the module's own response at `:33`, and the design's Worker premise is out of this diff) |
| 7 | P4 (advisory) | architecture | `type QueryContext = Context` adds no members and names no domain concept, so every handler signature reads as if it depended on a Spur type that does not exist; Hono's `Context` can be named directly, as the `mount` signature at `:78` already does. | `apps/server/src/modules/database/index.ts:21` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/domain/src/dao/database-inspector.ts:134` `listTables` (`sqlite_master`, `sqlite\_%` excluded via `ESCAPE '\'`, `ORDER BY name`); `:142` `describe` (`PRAGMA table_info` in `cid` order + exact `COUNT(*)`); `:155` `readRows` (single sort column + single contains filter, `LIMIT`/`OFFSET` bound). Fresh: `(cd packages/domain && bun test tests/dao/database-inspector.test.ts)` → 16 pass / 0 fail |
| R2 | MET | `:202` `resolveTableName` / `:223` `resolveColumnName` resolve against the live schema before any SQL string is built (`:85` `quoteIdentifier` doubles `"` from the schema's own spelling; `:90` `escapeLike` escapes `%`, `_`, `\`); `:229-232` binds `li%` pattern via `LIKE ? ESCAPE '\'`. Independent statement log through the mounted module: every issued statement began with `SELECT` or `PRAGMA table_info`, a stub adapter whose `run`/`exec`/`batch` throw was never asked to write, injection-shaped table/sort names → 404, `sqlite_sequence` → 404, `filter=%` / `_` / `\` each matched only the row holding that literal character, and table list plus row counts were unchanged afterwards |
| R3 | MET | `:104` `projectCell` (null; `Uint8Array` → `{t:'blob',bytes}`; finite number → `{t:'num'}`; non-finite → text; string → `{t:'text'}`); `:95` `truncateUtf8` cuts at 4096 bytes on a code-point boundary with `truncated: true`; `:184-197` `readRow` projects with truncation off. Probe: a 4097-byte cell paged back at 4096 bytes with `truncated: true` and no U+FFFD, and the same row's detail read returned the full value. Tests: `packages/domain/tests/dao/database-inspector.test.ts:197`, `:239` |
| R4 | MET | `packages/app/src/database/database-browser-service.ts:14` cap 200; `:58-64` default 50 + `Math.min` clamp (malformed → default); `:52-56` page normalises to ≥ 1; `:72-97` `dir` case-insensitive else `invalid-request`; `:99-104` domain errors → `unknown-table`/`unknown-column`, others rethrown; `:159-167` offset must be a non-negative integer. Fresh: `(cd packages/app && bun test tests/database/database-browser-service.test.ts)` → 10 pass / 0 fail; probe: `pageSize=0` → 50, `page=-1` → 1 |
| R5 | MET | `packages/contracts/src/database.ts:10` cell union, `:22` column, `:36` tables, `:44` table, `:54` rows, `:66` row, `:75` error enum; re-exported at `packages/contracts/src/index.ts:47`. Probe: the four success bodies plus the 400/404/503 bodies validate against those schemas (the 500 body does not — finding 2) |
| R6 | MET | `apps/server/src/modules/database/index.ts:92-95` — the four GET routes under `/api/project/database`; `:30-34` `getDb()` rejection → 503 `database-unavailable`; `:44-47` → 404 `unknown-table`/`unknown-column`, 400 `invalid-request`; registered LAST in `builtins` at `apps/server/src/modules/registry.ts:42` with the order assertion at `apps/server/tests/modules/registry.test.ts:12-26`. Fresh: `(cd apps/server && bun test tests/modules/database tests/modules/registry.test.ts)` → 13 pass / 0 fail |
| AC1 (server half) | MET | Probe `GET /api/project/database/tables` → `{"tables":["people"]}` for the fixture, `sqlite_sequence` absent in the DAO suite's AUTOINCREMENT fixture; served at `apps/server/src/modules/database/index.ts:92` from `packages/domain/src/dao/database-inspector.ts:134`; test `apps/server/tests/modules/database/index.test.ts:41` |
| AC2 (server half) | MET | Probe `/tables/PEOPLE` (different case) → `{"name":"people","columns":[{"name":"id","type":"INTEGER","notNull":false,"pk":true},…],"rowCount":1}` — declaration order, declared type, nullability, pk, exact count; from `packages/domain/src/dao/database-inspector.ts:142-148`; test `apps/server/tests/modules/database/index.test.ts:49` |
| AC3 (server half) | MET | Probe `/rows?pageSize=0&page=-1` → `{"page":1,"pageSize":50,"total":1,…}`; the range is conveyed as `page`+`pageSize`+`total` (the design's footer derives `1–50 of N` in the web layer, `docs/design/projects-database-tab.md:90`) — the AC's "current range" is satisfied by those three fields, no separate range field is promised by the design; test `apps/server/tests/modules/database/index.test.ts:95` |
| AC4 (server half) | MET | Probe `/rows?sort=name&dir=desc&filterColumn=name&filter=b` → filtered `total` + ordered rows; SQL `packages/domain/src/dao/database-inspector.ts:234`, `:239-243`; test `apps/server/tests/modules/database/index.test.ts:95` |
| AC5 (server half) | MET | Probe: long text cut with `truncated: true`, BLOB → `{"t":"blob","bytes":2}`, NULL → `{"t":"null"}`, and `/row?offset=1` returned the full 5000-char text; tests `apps/server/tests/modules/database/index.test.ts:66`, `:112` |
| AC6 | MET | Read-only and schema-bounded by construction: only `SELECT`/`PRAGMA table_info` are issued (statement log + write-method stub, `packages/domain/tests/dao/database-inspector.test.ts:272-302`), and names outside the live schema answer 404 (`apps/server/src/modules/database/index.ts:44`); tests `apps/server/tests/modules/database/index.test.ts:125`, `:137` |

##### Verification evidence

- `(cd packages/domain && bun test tests/dao/database-inspector.test.ts)` → 16 pass / 0 fail
- `(cd packages/app && bun test tests/database/database-browser-service.test.ts)` → 10 pass / 0 fail
- `(cd apps/server && bun test tests/modules/database/index.test.ts tests/modules/registry.test.ts)` → 13 pass / 0 fail
- Mounted-module probe (this run, in-memory adapter): AC1–AC6 bodies above; `page=1e21` / `offset=1e21` → 500 `{"error":"datatype mismatch"}`, `page=9007199254740993` → 200 with an empty page, `pageSize=1e21` → 200 `pageSize:200`, `/tables/` → generic 404, `/tables/%20` → 404 `unknown-table`
- OpenAPI probe (this run): `generateOpenApiSpec()` → 31 paths, none matching `/database` or `/observability` (finding 3)
- Design conformance: `docs/design/projects-database-tab.md` §3.1–§3.3 routes, params and DTO shapes match the implementation field for field; the only deviations are the wording items in findings 3 and 6, and the diff carries no silent scope change
- Not run by instruction: `bun run spur-check` (running in parallel on this tree). No file was staged; no source, test, config or doc file was edited by this review

**Next:** none. Verify keyed the AC rows by feature scenario title so record flipped every box (finding 4), bound R9 to the 503 route test (finding 5), and the page/offset bound landed in 1186 (finding 1).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-12T05:59:48.111Z feature_id Q → G631 (system)
- 2026-10-12T06:24:22.086Z todo → wip (system)
- 2026-10-12T07:16:59.194Z wip → testing (system)
- 2026-10-12T20:57:28.810Z testing → wip (system)
- 2026-10-12T21:33:47.499Z wip → testing (system)
- 2026-10-12T21:34:06.726Z testing → done (system)

