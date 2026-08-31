-- 0722 (feature E6): direct task↔session attribution authority. One row per
-- evidence-backed (wbs, source, session_id) triple; attribution metadata only —
-- never transcript content. See packages/domain/src/migrations.ts
-- (HISTORY_TASK_SESSION_SCHEMA_SQL) for the contract.
CREATE TABLE IF NOT EXISTS history_task_session (
    wbs TEXT NOT NULL,
    source TEXT NOT NULL,
    session_id TEXT NOT NULL,
    exactness TEXT NOT NULL,
    mechanism TEXT NOT NULL,
    evidence_kind TEXT NOT NULL,
    evidence_ref TEXT,
    resolved_at TEXT NOT NULL,
    PRIMARY KEY (wbs, source, session_id)
);

CREATE INDEX IF NOT EXISTS idx_history_task_session_source_session ON history_task_session (source, session_id);
