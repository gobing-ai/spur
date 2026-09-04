-- 0746: Retention compaction run-marker (task 0746).
-- A tiny KV table recording when the DB compaction last ran, so the daily pipeline can gate
-- compaction on a minimum interval. Idempotent (CREATE TABLE IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS spur_retention_meta (
    kind    TEXT NOT NULL,
    ran_at  INTEGER NOT NULL,
    PRIMARY KEY (kind)
);
