-- 0741: Incremental rollup refresh watermark (task 0741).
-- Per-table refresh watermark over `imported_at`, the materialized bucket range,
-- and the index that makes the watermark predicate range-scan instead of scanning
-- the whole history_message table. All statements are idempotent.

CREATE TABLE IF NOT EXISTS history_board_rollup_watermark (
    table_name            TEXT PRIMARY KEY,
    imported_at_watermark TEXT NOT NULL,
    definition_version    TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS history_board_rollup_bucket (
    table_name   TEXT NOT NULL,
    bucket_start TEXT NOT NULL,
    PRIMARY KEY (table_name, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_history_message_imported_at
    ON history_message (imported_at);
