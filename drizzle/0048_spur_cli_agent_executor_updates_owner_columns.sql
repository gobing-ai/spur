-- 0890 (feature B6): ownership/provenance columns on agent_executor_updates — `owner`
-- (quota|probe) + `layer` (project) written with every observation, plus `skipped_reason`
-- for operator-owned classified no-ops (never `last_error`, which stays failure-only).
-- Legacy NULL owners backfill to `quota` (B5 recorded quota events only).
-- Byte-compatible with AGENT_EXECUTOR_UPDATES_OWNER_COLUMNS_SCHEMA_SQL in
-- packages/domain/src/migrations.ts.
ALTER TABLE agent_executor_updates ADD COLUMN owner TEXT;
ALTER TABLE agent_executor_updates ADD COLUMN layer TEXT;
ALTER TABLE agent_executor_updates ADD COLUMN skipped_reason TEXT;
UPDATE agent_executor_updates SET owner = 'quota', layer = 'project' WHERE owner IS NULL;
