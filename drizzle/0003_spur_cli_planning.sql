-- _spur_cli_planning: append-only event ledger + task↔run traceability (D06, design §2.5).
-- Idempotent: CREATE TABLE IF NOT EXISTS, safe to re-apply.

CREATE TABLE IF NOT EXISTS planning_events (
    id TEXT PRIMARY KEY,
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    event TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    payload TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_run_links (
    id TEXT PRIMARY KEY,
    wbs TEXT NOT NULL,
    run_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL
);
