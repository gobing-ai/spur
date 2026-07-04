-- _spur_cli_system_events: capped append-only ledger of planning/system events
-- persisted by the server EventBus tap (task 0189 wave A / 0198). Indexed on
-- occurred_at (history query newest-first + since-filter) and event_name (filter
-- by name for the per-stream board tabs). Idempotent: CREATE TABLE IF NOT EXISTS,
-- safe to re-apply.

CREATE TABLE IF NOT EXISTS system_events (
    id TEXT PRIMARY KEY,
    event_name TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    actor TEXT,
    payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_system_events_occurred_at ON system_events (occurred_at);
CREATE INDEX IF NOT EXISTS idx_system_events_event_name ON system_events (event_name);
