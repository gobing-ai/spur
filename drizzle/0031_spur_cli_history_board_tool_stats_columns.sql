ALTER TABLE history_board_tool_stats ADD COLUMN fresh_input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE history_board_tool_stats ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE history_board_tool_stats ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE history_board_tool_stats ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0;
