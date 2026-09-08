-- 0799 (feature B5 / ADR-111): durable latest-observation delivery record for quota-driven
-- executor disabling. One row per (project_id, executor_name) in the project SQLite database —
-- independent of the prunable system_events ledger, which stays audit history. Timestamps are
-- UTC ISO-8601 ms so lexical comparison is chronological; disabled is constrained to 0/1.
-- Byte-compatible with AGENT_EXECUTOR_UPDATES_SCHEMA_SQL in packages/domain/src/migrations.ts.
CREATE TABLE IF NOT EXISTS agent_executor_updates (
    project_id TEXT NOT NULL,
    executor_name TEXT NOT NULL,
    observation_id TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    agent TEXT,
    model TEXT,
    disabled INTEGER NOT NULL CHECK (disabled IN (0, 1)),
    applied_observation_id TEXT,
    applied_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    retry_after TEXT,
    last_error TEXT,
    PRIMARY KEY (project_id, executor_name)
);
