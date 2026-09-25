-- 0937 (R1): nullable `terminal_reason` on `runs` — every closed run row carries one
-- classified reason from the closed enum (packages/app/src/workflow/terminal-reason.ts).
-- The engine's schema (ts-dual-workflow-engine 0.5.6 schema-sql.ts) creates the column
-- for new databases; this ALTER covers databases created before that.
-- Byte-compatible with CLI_RUNS_TERMINAL_REASON_SCHEMA_SQL in
-- packages/domain/src/migrations.ts.
ALTER TABLE runs ADD COLUMN terminal_reason TEXT;
