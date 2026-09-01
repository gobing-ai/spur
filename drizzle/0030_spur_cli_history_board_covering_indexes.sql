CREATE INDEX IF NOT EXISTS idx_history_daily_stats_day
    ON history_daily_stats (day, source, model);
CREATE INDEX IF NOT EXISTS idx_history_daily_stats_model_day
    ON history_daily_stats (model, day);
CREATE INDEX IF NOT EXISTS idx_history_board_source_daily_day
    ON history_board_source_daily (day, source);
CREATE INDEX IF NOT EXISTS idx_history_board_message_5m_bucket_source
    ON history_board_message_5m (bucket_start, source);
CREATE INDEX IF NOT EXISTS idx_history_board_tool_5m_bucket_tool
    ON history_board_tool_5m (bucket_start, tool_name);
CREATE INDEX IF NOT EXISTS idx_history_board_session_source_model_started
    ON history_board_session_stats (source, model, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_tool_call_source_imported
    ON history_tool_call (source, imported_at);
CREATE INDEX IF NOT EXISTS idx_history_task_session_session_id
    ON history_task_session (session_id);
