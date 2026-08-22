-- Freshness gate shared by Summary (27.02s), Sessions (2.65s), Insights (12.48s), and Sources (5.45s).
CREATE TABLE IF NOT EXISTS history_board_rollup_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1), history_version TEXT NOT NULL, refreshed_at TEXT NOT NULL
);
-- Summary (27.02s): bounded daily token series and breakdowns.
CREATE TABLE IF NOT EXISTS history_daily_stats (
    source TEXT NOT NULL, model TEXT NOT NULL, day TEXT NOT NULL,
    fresh_input_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
    messages INTEGER NOT NULL, assistant_duration_ms INTEGER NOT NULL, tool_calls INTEGER NOT NULL,
    PRIMARY KEY (source, model, day)
);
-- Summary (27.02s): sub-day token series, also feeding the Sources (5.45s) refresh projection.
CREATE TABLE IF NOT EXISTS history_board_message_5m (
    bucket_start TEXT NOT NULL, session_id TEXT NOT NULL, source TEXT NOT NULL, model TEXT NOT NULL,
    fresh_input_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
    messages INTEGER NOT NULL, assistant_duration_ms INTEGER NOT NULL, assistant_duration_samples INTEGER NOT NULL,
    PRIMARY KEY (bucket_start, session_id, source, model)
);
CREATE INDEX IF NOT EXISTS idx_history_board_message_5m_source ON history_board_message_5m (source, bucket_start);
CREATE INDEX IF NOT EXISTS idx_history_board_message_5m_model ON history_board_message_5m (model, bucket_start);
CREATE INDEX IF NOT EXISTS idx_history_board_message_5m_session ON history_board_message_5m (session_id, source);
-- Summary (27.02s): tool/skill series and call totals, also feeding Insights (12.48s) model reliability.
CREATE TABLE IF NOT EXISTS history_board_tool_5m (
    bucket_start TEXT NOT NULL, session_id TEXT NOT NULL, source TEXT NOT NULL, model TEXT NOT NULL,
    tool_name TEXT NOT NULL, skill_name TEXT NOT NULL DEFAULT '',
    fresh_input_tokens REAL NOT NULL, cache_read_tokens REAL NOT NULL, output_tokens REAL NOT NULL,
    calls INTEGER NOT NULL, errors INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
    PRIMARY KEY (bucket_start, session_id, source, model, tool_name, skill_name)
);
CREATE INDEX IF NOT EXISTS idx_history_board_tool_5m_source ON history_board_tool_5m (source, bucket_start);
CREATE INDEX IF NOT EXISTS idx_history_board_tool_5m_model ON history_board_tool_5m (model, bucket_start);
CREATE INDEX IF NOT EXISTS idx_history_board_tool_5m_tool ON history_board_tool_5m (tool_name, bucket_start);
CREATE INDEX IF NOT EXISTS idx_history_board_tool_5m_skill ON history_board_tool_5m (skill_name, bucket_start);
CREATE INDEX IF NOT EXISTS idx_history_board_tool_5m_session ON history_board_tool_5m (session_id, source);
-- Sessions (2.65s): paginated rows, also feeding Insights (12.48s) and Sources (5.45s).
CREATE TABLE IF NOT EXISTS history_board_session_stats (
    source TEXT NOT NULL, session_id TEXT NOT NULL, model TEXT NOT NULL, started_at TEXT, ended_at TEXT,
    messages INTEGER NOT NULL, tool_calls INTEGER NOT NULL, errors INTEGER NOT NULL,
    fresh_input_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
    assistant_duration_ms INTEGER NOT NULL, top_tool TEXT, state TEXT NOT NULL,
    PRIMARY KEY (source, session_id)
);
CREATE INDEX IF NOT EXISTS idx_history_board_session_started ON history_board_session_stats (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_board_session_model ON history_board_session_stats (model, started_at DESC);
-- Insights (12.48s): bounded all-time model comparison axes.
CREATE TABLE IF NOT EXISTS history_board_model_stats (
    model TEXT PRIMARY KEY, assistant_duration_ms INTEGER NOT NULL, assistant_duration_samples INTEGER NOT NULL,
    fresh_input_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
    tool_calls INTEGER NOT NULL, errors INTEGER NOT NULL
);
-- Summary (27.02s): bounded all-time Top Tools and Skills Used aggregates.
CREATE TABLE IF NOT EXISTS history_board_tool_stats (
    tool_name TEXT NOT NULL, skill_name TEXT NOT NULL, calls INTEGER NOT NULL, errors INTEGER NOT NULL,
    PRIMARY KEY (tool_name, skill_name)
);
-- Insights (12.48s): reused loop-analyzer findings.
CREATE TABLE IF NOT EXISTS history_board_loop_findings (
    source TEXT NOT NULL, session_id TEXT NOT NULL, model TEXT NOT NULL, started_at TEXT,
    tool_name TEXT NOT NULL, args_digest TEXT NOT NULL,
    repeats INTEGER NOT NULL, first_seq INTEGER NOT NULL, last_seq INTEGER NOT NULL,
    PRIMARY KEY (source, session_id, tool_name, args_digest)
);
-- Insights (12.48s): bounded token, duration, and cache-waste rankings.
CREATE TABLE IF NOT EXISTS history_board_ranked_steps (
    kind TEXT NOT NULL, rank INTEGER NOT NULL, session_id TEXT NOT NULL, source TEXT NOT NULL,
    ts TEXT, model TEXT, input_tokens INTEGER, cache_read_tokens INTEGER, output_tokens INTEGER, duration_ms INTEGER,
    PRIMARY KEY (kind, rank)
);
CREATE INDEX IF NOT EXISTS idx_history_board_ranked_steps_filter ON history_board_ranked_steps (kind, source, model, ts);
-- Sources (5.45s): all-time source cards and registry totals.
CREATE TABLE IF NOT EXISTS history_board_source_stats (
    source TEXT PRIMARY KEY, files INTEGER NOT NULL, messages INTEGER NOT NULL, last_imported_at TEXT,
    sessions INTEGER NOT NULL DEFAULT 0, fresh_input_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
    tool_calls INTEGER NOT NULL DEFAULT 0, first_date TEXT, last_date TEXT
);
-- Sources (5.45s): bounded 90-day heatmap reads.
CREATE TABLE IF NOT EXISTS history_board_source_daily (
    source TEXT NOT NULL, day TEXT NOT NULL,
    fresh_input_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
    sessions INTEGER NOT NULL, tool_calls INTEGER NOT NULL,
    PRIMARY KEY (source, day)
);
