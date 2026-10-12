---
kind: design
title: Projects Database tab — read-only table browser over the project database
status: proposed
created_at: 2026-10-11
updated_at: 2026-10-11
related: [G631, ADR-021, G63]
tags: [board, projects, database, http, read-only]
---

# Projects Database tab — read-only table browser over the project database

## 1. Issue and scope

The served project's SQLite database (`.spur/spur.db`) holds 57 tables of history, run, queue,
decision and planning data, but the Board only exposes curated slices of it (Observability,
History). Anyone wanting to see what a table actually contains drops to `sqlite3`. Feature G631 adds a
**Database** tab to the Projects module: pick a table, see its schema and row count, page through
rows with one sort column and one "contains" filter, and open a row to see full values.

Out of scope: a SQL console, any write, export, curated per-domain views, and any database other
than the served project's Spur database.

## 2. Context and constraints

- **Size.** The largest tables are `history_import_ledger` (≈4.0M rows) and `history_message`
  (≈3.2M). Everything is server-paginated; the client never loads a whole table.
- **Shared WAL database.** The `self serve` daemon, history importers and CLI processes write the
  same file. The viewer must stay read-only and short-lived per request.
- **Layering (ADR-021).** `packages/domain` is the sole ts-db consumer; `packages/app` holds the
  service; `packages/contracts` holds the wire DTOs; `apps/server` mounts a thin Hono module; the
  web tab lives in `apps/web/src/modules/projects/`.
- **Existing seams.** `ServerContext.getDb()` (apps/server/src/context.ts:171) is the lazily opened,
  migrated adapter; on the Cloudflare Worker path it throws `D1NotConfiguredError`. The Projects
  tab registry is `PROJECT_TABS` (apps/web/src/modules/projects/tabs.tsx:17) and its URL mapping is
  `useProjectTab` (apps/web/src/modules/projects/useProjectTab.ts:13).
- **Local-only server.** Host-guard middleware confines the API to the local host; data is redacted
  at persistence time, so the viewer exposes nothing `sqlite3` would not.
- **UI idiom.** DESIGN.md's dense diagnostic table (System Events, Decisions) with `@/ui` primitives;
  no new table/grid library.

## 3. Solution

### 3.1 Domain — `DatabaseInspector` (`packages/domain/src/dao/database-inspector.ts`)

A small DAO over `DbAdapter` with three reads:

| Method | SQL | Notes |
| --- | --- | --- |
| `listTables()` | `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite\_%' ESCAPE '\' ORDER BY name` | Includes `__spur_cli_migrations`; excludes SQLite internals. |
| `describe(table)` | `PRAGMA table_info("<t>")` + `SELECT COUNT(*) FROM "<t>"` | Returns columns (`name`, `type`, `notNull`, `pk`) in `cid` order and exact `rowCount`. |
| `readRows(table, q)` | `SELECT * FROM "<t>" [WHERE "<c>" LIKE ? ESCAPE '\'] [ORDER BY "<c>" ASC|DESC] LIMIT ? OFFSET ?` + filtered `COUNT(*)` | `q = { page, pageSize, sort?, dir?, filterColumn?, filterValue? }`. |

**Identifier safety.** Every identifier is resolved against `listTables()` / `describe()` first and
only then double-quoted from the *schema's* spelling; an unknown name throws a typed
`UnknownTableError` / `UnknownColumnError` before any SQL is built. Filter values are bound
parameters with `%`, `_` and `\` escaped. The DAO issues only `SELECT` and `PRAGMA table_info`.

**Cell projection.** Rows map each value to a tagged cell so the wire shape is JSON-safe:
`{ t: 'null' }`, `{ t: 'blob', bytes }`, `{ t: 'num', v }`, `{ t: 'text', v }`. Text longer than
4 KiB is cut to 4 KiB with `truncated: true` (full text is fetched by the row-detail call, §3.3).

### 3.2 App — `DatabaseBrowserService` (`packages/app/src/database/`)

Clamps `pageSize` (default 50, max 200), normalises `page ≥ 1`, validates `dir ∈ {asc, desc}`, and
maps domain errors to named outcomes (`unknown-table`, `unknown-column`, `invalid-request`). No
caching: every request reads the live schema (cheap: `sqlite_master` and `PRAGMA` are in-memory).

### 3.3 Contracts and HTTP (`packages/contracts/src/database.ts`, `apps/server/src/modules/database`)

| Route | Response |
| --- | --- |
| `GET /api/project/database/tables` | `{ tables: string[] }` |
| `GET /api/project/database/tables/:name` | `{ name, columns: Column[], rowCount }` |
| `GET /api/project/database/tables/:name/rows?page=&pageSize=&sort=&dir=&filterColumn=&filter=` | `{ page, pageSize, total, columns: string[], rows: Cell[][] }` |
| `GET /api/project/database/tables/:name/row?offset=&sort=&dir=&filterColumn=&filter=` | `{ columns: string[], row: Cell[] }` — one row, untruncated |

Errors: `404 { error: 'unknown-table' | 'unknown-column' }`, `400 { error: 'invalid-request' }`,
`503 { error: 'database-unavailable' }` when `getDb()` throws (Worker path). The module registers in
`apps/server/src/modules/registry.ts` like `observability`; this file owns the HTTP shapes.

Row detail re-reads by `(sort, filter, offset)` rather than by rowid because `WITHOUT ROWID` tables
and views have none; the result is the same row the grid showed as long as the table did not change
between the two reads (acceptable for a diagnostic viewer).

### 3.4 Web — `DatabaseView` (`apps/web/src/modules/projects/DatabaseView.tsx`)

- `PROJECT_TABS` gains `{ id: 'database', label: 'Database', component: DatabaseView }`;
  `ProjectTabId` gains `'database'`. Keyboard cycling in `ProjectsShell` already iterates the array.
- Layout: left rail = searchable table list (filter-as-you-type over names); main = schema strip
  (collapsible) above the dense row grid; footer = range text `1–50 of 4,028,297` + pager.
- URL state: `?table=&page=&sort=&dir=&fcol=&f=` via `useSearchParams`, so reload and deep links
  restore the view; `selectTab` already preserves the query string.
- Cells: one-line truncation with a tooltip; `NULL` and `BLOB · N B` as muted `Badge`s; clicking a
  row opens a `Modal` with every column, full text, and pretty-printed JSON when `JSON.parse`
  succeeds.
- Named states: loading, empty table, unknown table (picker still usable), database unavailable,
  request failed — never a blank panel.

## 4. Contract and compatibility

- Additive only: new HTTP routes, a new tab id, new contract DTOs. Existing `fleet`/`inbox` tabs and
  their `processes`/`conversation` aliases are untouched.
- No new dependency in any workspace.
- No `spur` CLI noun/verb change (public-surface consent not needed).
- No migration: the feature reads the schema; it adds none.

## 5. Tradeoffs and open questions

- **OFFSET pagination.** Deep pages on multi-million-row tables cost a scan proportional to the
  offset, and sorting by an unindexed column sorts the whole table per request (seconds on
  `history_message`). Accepted for a diagnostic viewer; keyset pagination on the primary key is the
  upgrade path if it bites.
- **Exact `COUNT(*)`.** Same order of cost as a full scan on the biggest tables (sub-second to ~1s
  measured class); counts are fetched per selected table, never for the whole list.
- **No SQL console.** Rejected: it widens the surface to arbitrary statements on a shared WAL
  database. Revisit only behind an explicit read-only connection (`PRAGMA query_only`) if asked.
- **open-design.** The layout follows DESIGN.md's existing dense-table idiom; an open-design pass
  can refine the visual layout later without changing these contracts.
