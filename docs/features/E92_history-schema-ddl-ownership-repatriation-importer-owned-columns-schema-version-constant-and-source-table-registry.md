---
schema_version: 1
id: "E92"
name: "History schema DDL ownership repatriation: importer-owned columns, schema version constant, and source table registry"
status: done
priority: P2
tags: []
created_at: "2026-09-03T16:09:43.570Z"
updated_at: "2026-09-03T18:44:39.961Z"
---

# E92: History schema DDL ownership repatriation: importer-owned columns, schema version constant, and source table registry

## Goal

Repatriate every `history_*` schema element to the owner the three-axis ownership rule (ADR-105)
assigns it, and give Spur a mechanism to detect upstream schema drift instead of discovering it as a
production failure.

The `history_skill_call` incident (ADR-103/D1) was not a one-off: `@gobing-ai/ts-llm-jsonl-importer`
exports no schema version, so an installed package older than the lockfile applies an older
`CREATE TABLE IF NOT EXISTS` set and Spur cannot tell. This feature closes that class.

Feature E91 depends on this feature only for the exported schema version constant; the two are
otherwise independent and E91's incremental ETL work does not block on the repatriation itself.

## Scope

### In scope

**Upstream (`@gobing-ai/ts-llm-jsonl-importer`):**

- Move three misplaced columns into the package's own schema: `history_import_checkpoint.source_size`
  and `.source_mtime_ms` (Spur migrations 0024/0025 — the migration comments state outright they back
  the importer's incremental short-circuit) and `history_message.duration_source` (Spur migration
  0026 — a property of the fact row that only the importer can populate at write time).
- Export `HISTORY_IMPORT_SCHEMA_VERSION`, bumped on every change to `src/schema-sql.ts`.
- Export the source-definition registry so consumers can enumerate `history_etl_*` target tables
  instead of hardcoding them.

**Downstream (Spur):**

- Apply the importer schema as a versioned migration step that records the applied
  `HISTORY_IMPORT_SCHEMA_VERSION` in the migration ledger (ADR-104).
- Fail a check, not a refresh, when the recorded version differs from the installed package's.
- Replace the hardcoded `history_etl_*` list in `packages/domain/src/analytics/history-reset.ts`
  with the upstream registry.
- Retire the redundant `request_id` ALTER path (migration 0018 duplicates a column already inline in
  the upstream `CREATE`).

### Out of scope

- **Relocating tables between packages.** The table-level boundary is already correct: the importer
  owns the raw landing tables and the three core fact tables; Spur owns the marts. Verified — ts-libs
  contains zero `history_board_*` references.
- **A third package** (`@gobing-ai/ts-llm-history-etl` or similar). It would hold nothing: board
  tables are Spur-shaped and Spur-only, and `history_etl_*` is raw landing the importer itself
  creates and writes.
- **Moving Spur's board-query indexes upstream.** Under ADR-105 an index is owned by the query's
  consumer; migrations 0009, 0020, 0022, 0029, 0030 are correctly Spur's.
- **Rewriting applied migrations.** Already-applied migrations remain in the ledger as guarded
  no-ops; repatriation adds upstream definitions rather than editing history.
- E91's incremental rollup ETL, new mart tables, and `tool_name_alias` work.

## Acceptance Criteria

```gherkin
Feature: History schema DDL ownership repatriation

  @core
  Scenario: R1 — Importer checkpoint identity columns are defined by the importer
    Given the file-identity columns source_size and source_mtime_ms that back the importer's incremental short-circuit
    When the importer schema is applied to an empty database
    Then history_import_checkpoint carries both columns without any Spur migration running
    And the incremental short-circuit works against a database built from the importer schema alone.

  @core
  Scenario: R2 — Assistant duration provenance is written at import, not derived at read time
    Given assistant steps whose duration is either provider-reported or computed as a timestamp delta
    When the corpus is imported
    Then history_message.duration_source is populated by the importer at write time
    And no read path recomputes duration provenance
    And a derived duration is never reported as provider-measured.

  @core
  Scenario: R3 — The importer exports a schema version that changes with its schema
    Given the importer package's static schema SQL
    When the schema SQL is modified
    Then the exported HISTORY_IMPORT_SCHEMA_VERSION differs from its previous value
    And a test fails if the schema SQL changes without the version changing.

  @core
  Scenario: R4 — Applying the importer schema records its version in the Spur migration ledger
    Given a database at a prior schema state
    When the history schema is applied
    Then the importer schema SQL runs as a versioned migration step
    And the applied HISTORY_IMPORT_SCHEMA_VERSION is recorded in the migration ledger
    And no history table structure is created as an implicit side effect of running an import.

  @core
  Scenario: R5 — A schema version mismatch fails a check rather than a refresh
    Given a database whose recorded importer schema version differs from the installed package's version
    When the project check runs
    Then the check fails naming the recorded version and the installed version
    And the failure occurs before any rollup refresh or import is attempted.

  @core
  Scenario: R6 — Raw landing table names come from the importer, not a hardcoded list
    Given the importer's source definitions determining every history_etl_* target table
    When Spur enumerates raw landing tables for reset
    Then the table names are read from the importer's exported registry
    And adding a new source upstream requires no change to Spur's reset code
    And a reset covers every table the importer can create.

  @core
  Scenario: R7 — Repatriation does not rewrite applied migration history
    Given migrations 0018, 0024, 0025, and 0026 already applied to production databases
    When the repatriated schema is applied to those databases
    Then every previously applied migration remains in the ledger
    And each becomes a guarded no-op rather than being edited or removed
    And no column is dropped, duplicated, or re-typed.

  @core
  Scenario: R8 — Ownership is enforced, not merely documented
    Given the three-axis ownership rule assigning table DDL, fact columns, and indexes to owners
    When a Spur migration adds a column to an importer-owned table
    Then a check fails identifying the table, the column, and the owner the rule assigns
    And index creation on importer-owned tables is permitted without failing that check.

  @edge
  Scenario: R9 — A database created by an older importer version is detected, not silently degraded
    Given a database created by an importer version predating a table or column the current version defines
    When the schema version check runs
    Then the drift is reported naming the missing structure
    And the failure names the remediation rather than surfacing as a missing-table query error.

  @edge
  Scenario: R10 — Upstream and downstream schemas converge to the same shape
    Given a database built by applying the importer schema alone
    And a database built by applying the importer schema plus the full Spur migration set
    When the resolved table structures for the importer-owned tables are compared
    Then both carry the same columns with the same types
    And any difference is limited to consumer-owned indexes.
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0747 | Repatriate importer-owned columns to the importer schema without rewriting applied migrations | done |
| 0748 | Importer schema version: exported constant, ledger record, and mismatch check | done |
| 0749 | Source-to-table registry replacing hardcoded table lists, with an ownership conformance test | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-09-03T18:44:39.103Z backlog → active (system)
- 2026-09-03T18:44:39.585Z active → verifying (system)
- 2026-09-03T18:44:39.961Z verifying → done (system)
