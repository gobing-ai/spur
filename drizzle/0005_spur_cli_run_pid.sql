-- _spur_cli_run_pid: add a pid column to the engine-owned `runs` table so
-- `spur workflow cancel <run-id>` can SIGTERM the in-flight subprocess of an
-- async run (task 0140).
--
-- SQLite has no `ADD COLUMN IF NOT EXISTS`. This is safe because the migration
-- applier journals each migration by id and runs it exactly once per database.
-- Collision risk: if `@gobing-ai/ts-dual-workflow-engine` ever ships its own
-- `runs.pid` column, this ALTER fails on fresh DBs — review at that point.

ALTER TABLE runs ADD COLUMN pid INTEGER;
