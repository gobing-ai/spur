-- 1076 R3 (ADR-132): nullable `parent_run_id` — the lineage edge from a fleet turn to the
-- run that dispatched it. A workflow dispatch names its parent in the request key
-- `<runId>/<state>`; a nested agent run inherits SPUR_RUN_ID. Strategy dispatches are roots.
-- Byte-compatible with COORDINATION_RUNS_PARENT_SCHEMA_SQL in
-- packages/domain/src/migrations.ts.
ALTER TABLE coordination_runs ADD COLUMN parent_run_id TEXT;
CREATE INDEX IF NOT EXISTS idx_coordination_runs_parent ON coordination_runs (parent_run_id);
