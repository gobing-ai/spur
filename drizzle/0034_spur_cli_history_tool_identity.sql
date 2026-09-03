-- 0739: Persist effective_tool_name and tool_name_alias on history_tool_call,
-- create history_tool_alias_map, supporting indexes, and backfill existing rows.

CREATE TABLE IF NOT EXISTS history_tool_alias_map (
    source TEXT NOT NULL,
    effective_tool_name TEXT NOT NULL,
    alias TEXT NOT NULL,
    PRIMARY KEY (source, effective_tool_name)
);

CREATE INDEX IF NOT EXISTS idx_history_tool_call_effective_tool_name
ON history_tool_call (effective_tool_name);

CREATE INDEX IF NOT EXISTS idx_history_tool_call_alias
ON history_tool_call (tool_name_alias);

UPDATE history_tool_call SET
    effective_tool_name = CASE
        WHEN tool_name IS NOT NULL AND TRIM(tool_name) != '' AND tool_name != 'unknown'
        THEN TRIM(tool_name)
        WHEN json_valid(args_raw) AND COALESCE(
            NULLIF(TRIM(CAST(json_extract(args_raw, '$.tool') AS TEXT)), ''),
            NULLIF(TRIM(CAST(json_extract(args_raw, '$.tool_name') AS TEXT)), ''),
            NULLIF(TRIM(CAST(json_extract(args_raw, '$.toolName') AS TEXT)), ''),
            NULLIF(TRIM(CAST(json_extract(args_raw, '$.name') AS TEXT)), ''),
            NULLIF(TRIM(CAST(json_extract(args_raw, '$.command') AS TEXT)), '')
        ) IS NOT NULL
        THEN COALESCE(
            NULLIF(TRIM(CAST(json_extract(args_raw, '$.tool') AS TEXT)), ''),
            NULLIF(TRIM(CAST(json_extract(args_raw, '$.tool_name') AS TEXT)), ''),
            NULLIF(TRIM(CAST(json_extract(args_raw, '$.toolName') AS TEXT)), ''),
            NULLIF(TRIM(CAST(json_extract(args_raw, '$.name') AS TEXT)), ''),
            NULLIF(TRIM(CAST(json_extract(args_raw, '$.command') AS TEXT)), '')
        )
        WHEN call_id LIKE 'call_bash_%' THEN 'bash'
        WHEN call_id LIKE 'call_read_%' THEN 'read'
        WHEN call_id LIKE 'call_edit_%' THEN 'edit'
        WHEN call_id LIKE 'call_write_%' THEN 'write'
        WHEN call_id LIKE 'call_grep_%' THEN 'grep'
        WHEN call_id LIKE 'call_find_%' THEN 'find'
        WHEN call_id LIKE 'call_ls_%' THEN 'ls'
        ELSE 'unknown'
    END
WHERE effective_tool_name = 'unknown';

UPDATE history_tool_call SET
    tool_name_alias = effective_tool_name
WHERE tool_name_alias = 'unknown';
