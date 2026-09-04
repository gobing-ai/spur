-- 0740: Complete measure vector on existing rollup tables.
-- Adds cache_write_tokens, assistant_duration_samples, and renames allocated
-- token columns to _alloc names on history_board_tool_5m and history_board_tool_stats.

ALTER TABLE history_daily_stats ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE history_daily_stats ADD COLUMN assistant_duration_samples INTEGER NOT NULL DEFAULT 0;

ALTER TABLE history_board_message_5m ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0;

ALTER TABLE history_board_session_stats ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE history_board_session_stats ADD COLUMN assistant_duration_samples INTEGER NOT NULL DEFAULT 0;

ALTER TABLE history_board_model_stats ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0;

ALTER TABLE history_board_source_stats ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0;

ALTER TABLE history_board_source_daily ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0;

ALTER TABLE history_board_tool_5m RENAME COLUMN fresh_input_tokens TO fresh_input_tokens_alloc;
ALTER TABLE history_board_tool_5m RENAME COLUMN cache_read_tokens TO cache_read_tokens_alloc;
ALTER TABLE history_board_tool_5m RENAME COLUMN output_tokens TO output_tokens_alloc;
ALTER TABLE history_board_tool_5m ADD COLUMN cache_write_tokens_alloc REAL NOT NULL DEFAULT 0;

DROP TABLE IF EXISTS history_board_tool_stats;
CREATE TABLE history_board_tool_stats (
    tool_name                 TEXT NOT NULL,
    skill_name                TEXT NOT NULL,
    calls                     INTEGER NOT NULL,
    errors                    INTEGER NOT NULL,
    fresh_input_tokens_alloc  REAL NOT NULL DEFAULT 0,
    cache_read_tokens_alloc   REAL NOT NULL DEFAULT 0,
    cache_write_tokens_alloc  REAL NOT NULL DEFAULT 0,
    output_tokens_alloc       REAL NOT NULL DEFAULT 0,
    duration_ms               INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tool_name, skill_name)
);
