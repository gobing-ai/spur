-- 0832: request_key column + partial unique idx_inbox_messages_request_key on legacy
-- inbox_messages tables (the @gobing-ai/ts-db 0.4.65 enqueueIdempotent writes the column,
-- embedded migration 0014_inbox_messages_request_key). CREATE TABLE IF NOT EXISTS never
-- adds columns to an existing table, so every enqueueIdempotent call on a pre-0832
-- database failed with `SQLiteError: table inbox_messages has no column named request_key`.
-- addColumnIfMissing guards with `request_key`; fresh DBs already get both from 0000/0001.
-- Byte-compatible with INBOX_MESSAGES_REQUEST_KEY_SCHEMA_SQL in packages/domain/src/migrations.ts.
ALTER TABLE inbox_messages ADD COLUMN request_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_messages_request_key ON inbox_messages (request_key) WHERE request_key IS NOT NULL;
