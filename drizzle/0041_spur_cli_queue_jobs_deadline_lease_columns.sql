-- 0817: A21 execution-deadline/lease columns on legacy queue_jobs tables. The
-- @gobing-ai/ts-infra 0.4.62 enqueue/claim SQL (ts-db embedded migration 0005)
-- writes timeout_ms / timeout_unlimited / attempt_token / lease_expires_at
-- unconditionally, and CREATE TABLE IF NOT EXISTS never adds columns to an
-- existing table — every enqueue on a pre-0005 database failed with
-- `SQLiteError: table queue_jobs has no column named timeout_ms`, which
-- silenced the scheduler's history-refresh ticks entirely.
-- Byte-compatible with QUEUE_JOBS_DEADLINE_LEASE_COLUMNS_SCHEMA_SQL in
-- packages/domain/src/migrations.ts.
ALTER TABLE queue_jobs ADD COLUMN timeout_ms INTEGER;
ALTER TABLE queue_jobs ADD COLUMN timeout_unlimited INTEGER NOT NULL DEFAULT 0;
ALTER TABLE queue_jobs ADD COLUMN attempt_token TEXT;
ALTER TABLE queue_jobs ADD COLUMN lease_expires_at INTEGER;
