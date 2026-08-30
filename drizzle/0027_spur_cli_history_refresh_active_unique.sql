-- _spur_cli_ single-flight for history.refresh (task 0716).
-- Retire duplicate ACTIVE (pending/processing) history.refresh rows — the
-- deterministically OLDEST active row survives; the rest become terminal
-- `failed` with an auditable last_error — then swap the pending-only partial
-- unique index for one covering ACTIVE rows.
UPDATE queue_jobs
SET status = 'failed',
    last_error = 'retired by migration 0027_spur_cli_history_refresh_active_unique: superseded duplicate active history refresh',
    processing_at = NULL,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE type = 'history.refresh'
  AND status IN ('pending', 'processing')
  AND id NOT IN (
      SELECT id FROM queue_jobs
      WHERE type = 'history.refresh' AND status IN ('pending', 'processing')
      ORDER BY created_at ASC, id ASC
      LIMIT 1
  );

DROP INDEX IF EXISTS queue_jobs_history_refresh_pending_unique;

CREATE UNIQUE INDEX IF NOT EXISTS queue_jobs_history_refresh_active_unique ON queue_jobs (type) WHERE type = 'history.refresh' AND status IN ('pending', 'processing');
