-- 0833: completion-receipt columns + idx_coordination_runs_task on legacy
-- coordination_runs tables (the exit sink in AgentService.executeRun writes
-- them on every invocation). CREATE TABLE IF NOT EXISTS never adds columns to
-- an existing table, so every run exit on a pre-0833 database failed with
-- `SQLiteError: table coordination_runs has no column named message_ids_json`.
-- addColumnIfMissing guards with `message_ids_json`; table-absent DBs skip via
-- the 0041 precedent (this folder ships no 0010 step). Byte-compatible with
-- COORDINATION_RUNS_RECEIPT_COLUMNS_SCHEMA_SQL in packages/domain/src/migrations.ts.
ALTER TABLE coordination_runs ADD COLUMN message_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE coordination_runs ADD COLUMN task_id TEXT;
ALTER TABLE coordination_runs ADD COLUMN outcome TEXT NOT NULL DEFAULT 'run-exit-only';
CREATE INDEX IF NOT EXISTS idx_coordination_runs_task ON coordination_runs (task_id);
