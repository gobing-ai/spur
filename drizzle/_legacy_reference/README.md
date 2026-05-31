# Legacy Drizzle migrations — reference only

These migrations come from the **pre-refoundation** Spur codebase and describe the **old**
schema (including `history_raw_*` tables that the new history importer removes).

**They are not active.** Per ADR-006 (`docs/00_ADR.md`), the new foundation regenerates its
schema from package-owned SQL:

- CLI domain tables → `apps/cli/src/db/migrations.ts` (`CLI_SCHEMA_SQL`)
- History import schema → `@gobing-ai/ts-llm-jsonl-importer` (`HISTORY_IMPORT_SCHEMA_SQL`)
- Workflow engine schema → `@gobing-ai/ts-dual-workflow-engine` (`WORKFLOW_ENGINE_SCHEMA_SQL`)

The active migration is the single top-level `drizzle/0000_spur_cli_foundation.sql`. The CLI
migrator (`loadSqlMigrations`) only loads top-level files matching the `_spur_cli_` marker, so
nothing in this folder is ever applied.

Kept only as historical reference for schema archaeology. Safe to delete entirely.
