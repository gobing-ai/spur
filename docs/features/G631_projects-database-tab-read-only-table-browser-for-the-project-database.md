---
schema_version: 1
id: "G631"
name: "Projects Database tab: read-only table browser for the project database"
status: active
priority: P2
tags: []
created_at: "2026-10-12T05:47:05.086Z"
updated_at: "2026-10-12T20:53:46.383Z"
---

# G631: Projects Database tab: read-only table browser for the project database

## Goal

Let board users understand the project's data by browsing any table of the served project's SQLite database from a read-only **Database** tab in the Projects module — schema, row counts, and paginated rows — without writing SQL or leaving the board.

## Scope

**In scope**

- A `Database` tab in the Projects module (`PROJECT_TABS`, deep link `/board/projects/database`).
- Table picker over every user table in the served project database, with the selected table persisted in the URL.
- Schema panel for the selected table: column name, declared type, nullability, primary-key flag, and an exact row count.
- Server-paginated row grid (bounded page size), single-column sort, and a single-column "contains" filter.
- Truncated cells with a row-detail view exposing full values; NULL and BLOB rendered as distinct markers.
- Read-only data access: identifiers validated against the live schema, values bound as parameters, no caller-supplied SQL.
- Named states for loading, empty table, unknown table, and database-unavailable (e.g. the Cloudflare Worker path).
- Layering per ADR-021: domain introspection, app service, contract DTOs, thin server module, web tab; design satellite under `docs/design/`.

**Out of scope**

- Free-form SQL console, query builder, or saved queries.
- Any insert, update, delete, or schema change.
- Curated per-domain views (Observability and History own those).
- New third-party grid/table dependency.
- Export/download of table data.
- Databases other than the served project's Spur database.

## Acceptance Criteria

```gherkin
Feature: Projects Database tab

  @core
  Scenario: R1 — The Projects module shows a Database tab with a deep link
    # covers: I1
    Given the board is served for a project
    When the user opens the Projects module and selects the Database tab, or navigates directly to /board/projects/database
    Then the Database tab is active, keyboard arrow navigation still cycles Fleet, Inbox and Database, and the existing Fleet and Inbox tabs are unchanged

  @core
  Scenario: R2 — The user picks any table of the project database and the choice survives reload
    # covers: I2
    Given the served project database contains user tables
    When the Database tab loads and the user chooses a table from the picker
    Then the picker lists every user table name from the live schema in sorted order, internal sqlite_ tables are excluded, and the chosen table is kept in the URL so a reload reopens it

  @core
  Scenario: R3 — The selected table shows its schema and exact row count
    # covers: I3, I4
    Given a selected table
    When its schema panel renders
    Then every column shows its name, declared type, nullability and primary-key flag in declaration order, and the panel shows the exact row count of the table

  @core
  Scenario: R4 — Rows are paginated on the server with a bounded page size
    # covers: I3, I5
    Given a selected table with more rows than one page
    When the user moves to the next, previous or a specific page
    Then the server returns only that page, the page size defaults to 50 and is capped at 200, and the grid shows the current range and total row count

  @core
  Scenario: R5 — The user sorts by one column and filters one column by a contains match
    # covers: I4, I5
    Given a selected table
    When the user sorts by a column ascending or descending and enters a contains filter on one column
    Then the returned rows honour the sort and filter, the total count reflects the filter, the page resets to the first page, and sort and filter are kept in the URL

  @core
  Scenario: R6 — Long, null and binary cell values stay readable
    # covers: I4
    Given rows containing long text, NULL values and BLOB values
    When the grid renders them and the user opens a row detail
    Then long text is truncated to one line in the grid, NULL and BLOB render as distinct muted markers with BLOB showing its byte length, and the row detail shows every column with its full value and pretty-printed JSON when the text parses as JSON

  @core
  Scenario: R7 — Data access is read-only and refuses names outside the live schema
    # covers: I5
    Given a request naming a table, sort column or filter column
    When the name is not present in the live schema or the request carries any SQL text
    Then the server refuses it with a named not-found or invalid-request error, identifiers are only quoted from the validated schema, filter values are bound parameters, and no statement other than SELECT and PRAGMA table_info is ever executed

  @core
  Scenario: R8 — The tab reuses the board table idiom without a new grid dependency
    # covers: I6
    Given the web workspace dependencies before this feature
    When the Database tab ships
    Then it renders with the shared ui primitives and the dense diagnostic table idiom, and the web package adds no new table or grid dependency

  @edge
  Scenario: R9 — Empty, unknown and unavailable states are named, never blank
    # covers: I3
    Given a table with zero rows, a URL naming a table that no longer exists, or a server with no database
    When the Database tab renders
    Then it shows a named empty-table state, a named unknown-table state with the picker still usable, or a named database-unavailable state respectively
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1183 | Read-only project database browse API (domain inspector, app service, contracts, server routes) | testing |
| 1184 | Projects Database tab UI (table picker, schema strip, paginated grid, row detail) | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-10-12T05:59:48.111Z moved Q → G631 (system)
- 2026-10-12T20:53:46.383Z backlog → active (system)

