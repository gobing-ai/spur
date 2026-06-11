-- Incremental migration: rule-engine run history tables (task 0040).
-- Mirrors RULE_ENGINE_SCHEMA_SQL from @gobing-ai/ts-rule-engine; keep byte-compatible.
CREATE TABLE IF NOT EXISTS rule_runs (
    id TEXT PRIMARY KEY,
    preset TEXT,
    source_kind TEXT NOT NULL,
    source_value TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    rule_count INTEGER NOT NULL DEFAULT 0,
    finding_count INTEGER NOT NULL DEFAULT 0,
    fix_count INTEGER NOT NULL DEFAULT 0,
    applied_fix_count INTEGER NOT NULL DEFAULT 0,
    fail_on TEXT,
    stop_on_first TEXT,
    fix_mode TEXT NOT NULL DEFAULT 'none',
    dry_run INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    duration_ms INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rule_eval_runs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES rule_runs(id),
    rule_id TEXT NOT NULL,
    severity TEXT NOT NULL,
    evaluator TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    finding_count INTEGER NOT NULL DEFAULT 0,
    fix_count INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    error TEXT,
    findings_json TEXT,
    fixes_json TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rule_eval_runs_run_id ON rule_eval_runs (run_id);
