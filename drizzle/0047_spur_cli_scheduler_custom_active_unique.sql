-- 0863: durable single-flight for configured scheduler jobs. The tick's
-- findActiveSchedulerCustomJob + insert sequence is check-then-act, so every
-- `spur serve` daemon sharing one project DB admitted its own `scheduler.custom`
-- row on the same cron occurrence (3-14 rows per tick on 2026-09-14/15, 402 loser
-- rows failed with "already running in this process" between 2026-09-08 and 15).
-- Duplicate active rows from the pre-index era are retired first (the oldest active
-- row per job name survives, the rest become terminal `failed` with an auditable
-- last_error) so CREATE UNIQUE INDEX cannot fail. Nothing is deleted.
-- Byte-compatible with SCHEDULER_CUSTOM_ACTIVE_UNIQUE_SCHEMA_SQL in
-- packages/domain/src/migrations.ts.
UPDATE queue_jobs
SET status = 'failed',
    last_error = 'retired by migration 0047_spur_cli_scheduler_custom_active_unique: superseded duplicate active scheduler.custom job name',
    processing_at = NULL,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE type = 'scheduler.custom'
  AND status IN ('pending', 'processing')
  AND id NOT IN (
      SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
              PARTITION BY json_extract(payload, '$.name') ORDER BY created_at ASC, id ASC
          ) AS rank
          FROM queue_jobs
          WHERE type = 'scheduler.custom' AND status IN ('pending', 'processing')
      ) WHERE rank = 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS queue_jobs_scheduler_custom_active_unique ON queue_jobs (json_extract(payload, '$.name')) WHERE type = 'scheduler.custom' AND status IN ('pending', 'processing');
