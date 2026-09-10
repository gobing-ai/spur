-- 0824: Partial index serving the History Board rollup `effective_model` fallback
-- subquery (`SELECT model FROM history_message WHERE source = ? AND session_id = ?
-- AND model IS NOT NULL AND model != '' AND model != 'unknown' LIMIT 1`). Without it
-- the subquery walks the session's (source, session_id, seq) slice row by row until the
-- first well-formed model; the NULL-ts sentinel rows map to sessions of up to 574k rows
-- on the real corpus, so one sentinel-bucket rebuild spent minutes in that scan and the
-- incremental rollup refresh never finished inside the worker timeout. The partial index
-- hands LIMIT 1 the first qualifying row directly (O(log n)); measured full per-bucket
-- batch: >300s -> <1s. Byte-compatible with
-- HISTORY_MESSAGE_MODEL_FALLBACK_INDEX_SCHEMA_SQL in packages/domain/src/migrations.ts.
CREATE INDEX IF NOT EXISTS idx_history_message_session_model
    ON history_message (source, session_id)
    WHERE model IS NOT NULL AND model != '' AND model != 'unknown';
