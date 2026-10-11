-- 0204 P2: Spur-local read receipt on inbox_messages (ms epoch, NULL = unread), written by
-- InboxRecentDao.markRead and announced as the metadata-only `message.read` event. Kept out
-- of 0001's ts-db mirror DDL; addColumnIfMissing guards with `read_at` on fresh and legacy DBs.
-- Byte-compatible with INBOX_MESSAGES_READ_AT_SCHEMA_SQL in packages/domain/src/migrations.ts.
ALTER TABLE inbox_messages ADD COLUMN read_at INTEGER;
