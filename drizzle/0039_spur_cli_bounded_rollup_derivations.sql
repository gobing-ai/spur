-- 0763 (R4/R8): Bounded rollup derivations candidate-set narrowing.
-- Adds the two columns the bounded derivation reads to scope its candidate set, plus the index
-- that bounds the per-source file scan. The columns are RAW (no dedup, no turn watermark) because
-- they back import coverage. Idempotent: the index is CREATE INDEX IF NOT EXISTS, and the two
-- columns are guarded by the embedded migration's addColumnIfMissing on `raw_messages`.
CREATE INDEX IF NOT EXISTS idx_history_message_source_file
    ON history_message (source, source_file);

ALTER TABLE history_board_source_daily ADD COLUMN raw_messages INTEGER NOT NULL DEFAULT 0;
ALTER TABLE history_board_source_daily ADD COLUMN last_imported_at TEXT;
