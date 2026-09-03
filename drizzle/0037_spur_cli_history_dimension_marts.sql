-- 0743: Dimension marts (task 0743).
-- Two day-grain mart tables carrying the ADR-106 nine-measure additive vector for the
-- four materialized Summary dimensions. Every measure column is nullable for exactly one
-- reason: ADR-106 records a measure that is not well defined at a dimension as NULL, never
-- as a zero that would be indistinguishable from a measured absence of activity.
--
--   - tool  dimension: skill_calls is not applicable -> NULL
--   - skill dimension: tool_calls is not applicable -> NULL
--   - source dimension: duration_ms / duration_samples are not applicable -> NULL
--
-- history_board_kpi_window stores the current and previous aggregate window KPIs for a
-- named range window. All statements are idempotent (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS history_board_dimension_daily (
    dimension           TEXT NOT NULL,
    dimension_key       TEXT NOT NULL,
    day                 TEXT NOT NULL,
    -- ADR-106 nine-member additive measure vector. NULLABLE, never a NOT NULL column with a
    -- zero default: a not-applicable measure is stored as NULL.
    messages            INTEGER,
    tool_calls          INTEGER,
    skill_calls         INTEGER,
    fresh_input_tokens  REAL,
    cache_read_tokens   REAL,
    cache_write_tokens  REAL,
    output_tokens       REAL,
    duration_ms         INTEGER,
    duration_samples    INTEGER,
    -- Per-(dimension, key, day) tool-error count (not part of the ADR-106 additive vector but
    -- needed by the top-tools error-rate projection. NULLABLE like every other scalar.
    errors              INTEGER,
    PRIMARY KEY (dimension, dimension_key, day)
);

CREATE TABLE IF NOT EXISTS history_board_kpi_window (
    range_key           TEXT NOT NULL,
    window_kind         TEXT NOT NULL CHECK (window_kind IN ('current', 'previous')),
    -- ADR-106 nine-member additive measure vector, plus the non-additive totals the KPI
    -- projection needs (sessions and tool_errors are counts, never summed as means).
    messages            INTEGER,
    tool_calls          INTEGER,
    skill_calls         INTEGER,
    fresh_input_tokens  REAL,
    cache_read_tokens   REAL,
    cache_write_tokens  REAL,
    output_tokens       REAL,
    duration_ms         INTEGER,
    duration_samples    INTEGER,
    sessions            INTEGER,
    tool_errors         INTEGER,
    PRIMARY KEY (range_key, window_kind)
);

CREATE INDEX IF NOT EXISTS idx_history_board_dimension_daily_day
    ON history_board_dimension_daily (dimension, day);
