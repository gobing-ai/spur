-- _spur_cli_ team mode inbox messages.
-- Durable inter-agent message queue backing `spur message` and team-mode delivery.
-- DDL mirrors @gobing-ai/ts-db schema/inbox-messages (InboxMessageDao). Keep in sync
-- with that package; column types and the pending-lookup index must match exactly.
CREATE TABLE IF NOT EXISTS inbox_messages (
    id TEXT PRIMARY KEY,
    from_id TEXT,
    to_id TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    in_reply_to TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    delivered_at INTEGER,
    inject_attempts INTEGER NOT NULL DEFAULT 0,
    inject_error TEXT,
    request_key TEXT
);

CREATE INDEX IF NOT EXISTS idx_inbox_messages_to_status ON inbox_messages (to_id, status);

-- 0832: caller-minted idempotency key on send. Partial unique index — SQLite
-- allows unlimited NULLs, so keyless sends are unaffected while keyed sends are
-- collision-proof (the constraint arbitrates concurrent submissions).
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_messages_request_key ON inbox_messages (request_key) WHERE request_key IS NOT NULL;
