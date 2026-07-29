-- _spur_cli_system_events_correlation: backfill the indexed correlation
-- columns (`run_id`, `entity_kind`, `entity_id`, `sequence`) on `system_events`
-- so the J3 read API can filter by run or entity in one indexed round trip
-- (task 0369).
--
-- SQLite has no `ADD COLUMN IF NOT EXISTS`. Embedded migrations guard these
-- ALTERs with a column-exists check before execution so fresh DBs, whose
-- foundation DDL already creates the columns, journal the migration without a
-- duplicate-column error. Folder-loaded migrations rely on the same task-era
-- expectation as the runs-external-key precedent: apply only to legacy DBs
-- missing the columns. The indexes use `CREATE INDEX IF NOT EXISTS` and are
-- therefore always safe to re-run. No payload backfill — existing rows keep
-- their nulls and remain fully readable (R4/R5).

ALTER TABLE system_events ADD COLUMN run_id TEXT;
ALTER TABLE system_events ADD COLUMN entity_kind TEXT;
ALTER TABLE system_events ADD COLUMN entity_id TEXT;
ALTER TABLE system_events ADD COLUMN sequence INTEGER;

CREATE INDEX IF NOT EXISTS idx_system_events_run_id ON system_events (run_id);
CREATE INDEX IF NOT EXISTS idx_system_events_entity ON system_events (entity_kind, entity_id);
