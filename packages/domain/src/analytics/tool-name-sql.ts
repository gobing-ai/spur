/**
 * Standalone SQL constants shared by forensic-query and history-board-rollup.
 *
 * Extracted into their own module (with zero imports) to break what was a bidirectional
 * value cycle: forensic-query imported EFFECTIVE_TOOL_NAME_SQL from history-board-rollup
 * and evaluated its own RESOLVED_TOOL_NAME_SQL at module scope, while history-board-rollup
 * imported analyzer functions back from forensic-query. Under some load orders the
 * module-scope read hit a TDZ ReferenceError (the importing module had not yet initialized
 * the constant). Giving both consumers a common, import-free source removes the cycle and
 * unifies the two near-identical RESOLVED_TOOL_NAME_SQL definitions.
 */

/** SQL resolving the effective tool name for a history_tool_call `tc` row. */
export const EFFECTIVE_TOOL_NAME_SQL = `CASE
    WHEN tc.tool_name IS NOT NULL AND TRIM(tc.tool_name) != '' AND tc.tool_name != 'unknown'
    THEN TRIM(tc.tool_name)
    WHEN json_valid(tc.args_raw) AND COALESCE(
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.tool') AS TEXT)), ''),
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.tool_name') AS TEXT)), ''),
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.toolName') AS TEXT)), ''),
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.name') AS TEXT)), ''),
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.command') AS TEXT)), ''),
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.cmd') AS TEXT)), ''),
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.action') AS TEXT)), ''),
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.function') AS TEXT)), ''),
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.operation') AS TEXT)), ''),
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.skill') AS TEXT)), ''),
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.skill_name') AS TEXT)), '')
    ) IS NOT NULL
    THEN COALESCE(
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.tool') AS TEXT)), ''),
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.tool_name') AS TEXT)), ''),
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.toolName') AS TEXT)), ''),
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.name') AS TEXT)), ''),
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.command') AS TEXT)), ''),
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.cmd') AS TEXT)), ''),
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.action') AS TEXT)), ''),
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.function') AS TEXT)), ''),
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.operation') AS TEXT)), ''),
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.skill') AS TEXT)), ''),
        NULLIF(TRIM(CAST(json_extract(tc.args_raw, '$.skill_name') AS TEXT)), '')
    )
    WHEN tc.call_id IS NOT NULL AND (
        tc.call_id LIKE 'call_bash_%' OR tc.call_id LIKE 'bash_%' OR tc.call_id LIKE 'exec_%'
    ) THEN 'bash'
    WHEN tc.call_id IS NOT NULL AND (
        tc.call_id LIKE 'call_read_%' OR tc.call_id LIKE 'read_%'
    ) THEN 'read'
    WHEN tc.call_id IS NOT NULL AND (
        tc.call_id LIKE 'call_edit_%' OR tc.call_id LIKE 'edit_%'
    ) THEN 'edit'
    WHEN tc.call_id IS NOT NULL AND (
        tc.call_id LIKE 'call_search_%' OR tc.call_id LIKE 'search_%' OR tc.call_id LIKE 'web_search_%'
    ) THEN 'search'
    ELSE 'unknown'
END`;

/**
 * Activity window (days) backing the History board Sources tab per-day heatmap grid.
 * Single knob for the window — the board's `historyBoardSourcesFromRollup` /
 * `dailyTokenMatrix` defaults and the app-side heatmap span all read it. Raise to
 * widen the visible activity history; the materialized tables are all-time, so no
 * re-import is needed.
 */
export const HISTORY_BOARD_ACTIVITY_DAYS = 180;

/**
 * Resolves effective tool name, preferring the persisted column if not 'unknown',
 * falling back to the CASE expression for unmigrated or unpopulated test rows.
 */
export const RESOLVED_TOOL_NAME_SQL = `CASE
    WHEN tc.effective_tool_name IS NOT NULL AND tc.effective_tool_name != '' AND tc.effective_tool_name != 'unknown'
    THEN tc.effective_tool_name
    ELSE ${EFFECTIVE_TOOL_NAME_SQL}
END`;
