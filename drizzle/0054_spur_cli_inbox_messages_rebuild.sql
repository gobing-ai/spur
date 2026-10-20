-- 1266 R1 (G11, ADR-143): rebuild inbox_messages as a Spur-owned table.
-- The ts-db shape (0001) could not express routing (kind), dispatch linkage (task_id,
-- parent_run_id) or a non-null sender. DROP first so fresh and legacy journals converge;
-- old rows are discarded by operator decision A6. Byte-compatible with
-- INBOX_MESSAGES_REBUILD_SQL in packages/domain/src/migrations.ts.
DROP TABLE IF EXISTS inbox_messages;
CREATE TABLE IF NOT EXISTS "inbox_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "from_id" text NOT NULL,
  "to_id" text NOT NULL,
  "body" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'chat',
  "status" text NOT NULL DEFAULT 'queued',
  "claimed_at" integer,
  "attempts" integer NOT NULL DEFAULT 0,
  "error" text,
  "delivered_at" integer,
  "read_at" integer,
  "in_reply_to" text,
  "thread_id" text,
  "request_key" text,
  "task_id" text,
  "parent_run_id" text,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_messages_to_status ON inbox_messages (to_id, status);
CREATE INDEX IF NOT EXISTS idx_inbox_messages_from_created ON inbox_messages (from_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inbox_messages_thread ON inbox_messages (thread_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_messages_request_key ON inbox_messages (request_key) WHERE request_key IS NOT NULL;
