CREATE INDEX IF NOT EXISTS idx_history_message_source_ts
    ON history_message (source, ts);
CREATE INDEX IF NOT EXISTS idx_history_message_model_ts
    ON history_message (model, ts);
CREATE INDEX IF NOT EXISTS idx_history_tool_call_session_id_seq
    ON history_tool_call (session_id, seq);
CREATE INDEX IF NOT EXISTS idx_history_board_message_5m_bucket_model
    ON history_board_message_5m (bucket_start, model);
CREATE INDEX IF NOT EXISTS idx_history_board_tool_5m_bucket_skill
    ON history_board_tool_5m (bucket_start, skill_name);
CREATE INDEX IF NOT EXISTS idx_history_board_session_source_started
    ON history_board_session_stats (source, started_at DESC);
