CREATE INDEX IF NOT EXISTS idx_history_tool_call_msg_tool
    ON history_tool_call (message_hash, tool_name);
CREATE INDEX IF NOT EXISTS idx_history_tool_call_tool_msg
    ON history_tool_call (tool_name, message_hash);
CREATE INDEX IF NOT EXISTS idx_history_message_ts
    ON history_message (ts);
