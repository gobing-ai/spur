CREATE INDEX IF NOT EXISTS idx_history_message_session_id_seq
    ON history_message (session_id, seq);
CREATE INDEX IF NOT EXISTS idx_history_message_duration_rank
    ON history_message (duration_ms DESC)
    WHERE role = 'assistant' AND duration_ms IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_history_message_token_rank
    ON history_message ((COALESCE(input_tokens, 0) + COALESCE(cache_read_tokens, 0)) DESC)
    WHERE role = 'assistant';
CREATE INDEX IF NOT EXISTS idx_history_message_input_rank
    ON history_message (input_tokens DESC)
    WHERE role = 'assistant';
