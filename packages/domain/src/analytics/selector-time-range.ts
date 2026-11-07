/**
 * Inclusive `since`/`until` predicates shared by the rollup and daily-mart readers (task 1310,
 * consolidating the pair the 1309 parity evidence proved equivalent). Parameter order is
 * since-then-until; only `null` means "no bound".
 */
const BOUND_SQL = {
    day: 'DATE(?)',
    timestamp: "strftime('%Y-%m-%dT%H:%M:%SZ', ?)",
} as const;

/** Caller-owned constant columns only (`alias.column` or `column`); never user input. */
const COLUMN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

export function buildTimeRangeClauses(
    range: { since: string | null; until: string | null },
    target: { column: string; grain: keyof typeof BOUND_SQL },
): { clauses: string[]; params: unknown[] } {
    if (!COLUMN.test(target.column)) throw new Error(`invalid time-range column: ${target.column}`);
    const bound = BOUND_SQL[target.grain];
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (range.since !== null) {
        clauses.push(`${target.column} >= ${bound}`);
        params.push(range.since);
    }
    if (range.until !== null) {
        clauses.push(`${target.column} <= ${bound}`);
        params.push(range.until);
    }
    return { clauses, params };
}
