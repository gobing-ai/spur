-- _spur_cli_runs_external_key: backfill the `runs.external_key` column used by
-- LifecycleAdapter to associate entity lifecycle transitions with workflow runs
-- (task 0213).
--
-- SQLite has no `ADD COLUMN IF NOT EXISTS`. Embedded migrations guard this ALTER
-- with a column-exists check before execution so fresh DBs, whose foundation DDL
-- already creates `external_key`, journal the migration without a duplicate-column
-- error. Folder-loaded migrations rely on the same task-era expectation as the
-- run-pid precedent: apply only to legacy DBs missing the column.

ALTER TABLE runs ADD COLUMN external_key TEXT;
