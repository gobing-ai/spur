-- 1100: decision_logs — one row per decision invocation, keyed by the `decision.start`
-- invocationId. Rows carry the served result (outcome/value/fallback_value/source/reason/
-- confidence), the caller context (caller, run correlation, maker and catalog provenance),
-- the (redacted, bounded) input for `decisions.log = 'full'`, the always-stored input keys and
-- evidence digest, and the caller-observed phase timings. DecisionLogDao prunes beyond the
-- newest 10,000 rows by started_at. Byte-compatible with DECISION_LOGS_SCHEMA_SQL in
-- packages/domain/src/migrations.ts.
CREATE TABLE IF NOT EXISTS decision_logs (
    id TEXT PRIMARY KEY,
    decision_id TEXT NOT NULL,
    decision_type TEXT,
    caller TEXT NOT NULL,
    run_id TEXT,
    workflow_name TEXT,
    node_id TEXT,
    wbs TEXT,
    maker_name TEXT,
    maker_source TEXT,
    catalog_layer TEXT,
    catalog_source TEXT,
    min_confidence REAL,
    question TEXT,
    input_json TEXT,
    input_keys_json TEXT NOT NULL DEFAULT '[]',
    evidence_digest TEXT,
    outcome TEXT NOT NULL,
    value TEXT,
    fallback_value TEXT,
    source TEXT,
    reason TEXT,
    confidence REAL,
    error TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    phases_json TEXT NOT NULL DEFAULT '[]',
    schema_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_decision_logs_started_at ON decision_logs (started_at);
CREATE INDEX IF NOT EXISTS idx_decision_logs_decision_started ON decision_logs (decision_id, started_at);
CREATE INDEX IF NOT EXISTS idx_decision_logs_maker_started ON decision_logs (maker_name, started_at);
CREATE INDEX IF NOT EXISTS idx_decision_logs_run ON decision_logs (run_id);
