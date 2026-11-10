/**
 * Inclusive `since`/`until` predicates shared by the rollup and daily-mart readers (task 1310,
 * consolidating the pair the 1309 parity evidence proved equivalent). Parameter order is
 * since-then-until; only `null` means "no bound".
 */
/**
 * Bound rendering per grain. `instant` parses BOTH sides (task 1326): stored timestamps are
 * `...Z` and mix millisecond with seconds-only precision, while a daily selector carries a local
 * UTC offset. TEXT comparison then orders `2026-11-07T01:24:44.894Z` inside a
 * `-08:00`-bounded day, shifting every window by the offset; `julianday` compares instants.
 */
const BOUND_SQL = {
    day: 'DATE(?)',
    timestamp: "strftime('%Y-%m-%dT%H:%M:%SZ', ?)",
    instant: 'julianday(?)',
} as const;

/** The column side of each grain; only `instant` transforms it. */
const COLUMN_SQL: Record<keyof typeof BOUND_SQL, (column: string) => string> = {
    day: (column) => column,
    timestamp: (column) => column,
    instant: (column) => `julianday(${column})`,
};

/** Caller-owned constant columns only (`alias.column` or `column`); never user input. */
const COLUMN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

/**
 * Slack for the instant grain's sargable prefilter. A TEXT range cannot describe the window
 * exactly (stored precision varies and the bound carries an offset), so it is widened by one
 * second on each side and the exact `julianday` predicate does the real filtering. Without this
 * prefilter the parsed predicate is not sargable: measured on the 2026-11-10 database a bounded
 * daily analyze went from 1.2 s to 25.7 s because the plan degraded to a full covering-index scan.
 */
const INSTANT_PREFILTER_SLACK_MS = 1000;

/**
 * UTC-normalized TEXT bound for the prefilter, or `undefined` when the bound is not a parseable
 * instant (then only the exact predicate is emitted — correctness never depends on the prefilter).
 */
function instantPrefilterBound(bound: string, slackMs: number): string | undefined {
    const at = Date.parse(bound);
    return Number.isFinite(at) ? new Date(at + slackMs).toISOString() : undefined;
}

/**
 * Builds the inclusive `since`/`until` predicate fragments and their bound params for one column.
 * Throws on a column that is not a caller-owned identifier, since the SQL is interpolated.
 */
export function buildTimeRangeClauses(
    range: { since: string | null; until: string | null },
    target: { column: string; grain: keyof typeof BOUND_SQL },
): { clauses: string[]; params: unknown[] } {
    if (!COLUMN.test(target.column)) throw new Error(`invalid time-range column: ${target.column}`);
    const bound = BOUND_SQL[target.grain];
    const clauses: string[] = [];
    const params: unknown[] = [];
    const column = COLUMN_SQL[target.grain](target.column);
    const prefilter = target.grain === 'instant';
    if (range.since !== null) {
        const low = prefilter ? instantPrefilterBound(range.since, -INSTANT_PREFILTER_SLACK_MS) : undefined;
        if (low !== undefined) {
            clauses.push(`${target.column} >= ?`);
            params.push(low);
        }
        clauses.push(`${column} >= ${bound}`);
        params.push(range.since);
    }
    if (range.until !== null) {
        const high = prefilter ? instantPrefilterBound(range.until, INSTANT_PREFILTER_SLACK_MS) : undefined;
        if (high !== undefined) {
            clauses.push(`${target.column} <= ?`);
            params.push(high);
        }
        clauses.push(`${column} <= ${bound}`);
        params.push(range.until);
    }
    return { clauses, params };
}
