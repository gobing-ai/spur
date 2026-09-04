import type { DbAdapter } from '@gobing-ai/ts-db';

/**
 * Test-time statement recorder (task 0743 R8).
 *
 * Wraps a `DbAdapter` and records every SQL statement it executes. The invariant it enforces is a
 * read-path discipline: with rollups fresh, no History-endpoint statement groups or aggregates over
 * the raw `history_message` / `history_tool_call` tables. Point lookups by `record_hash` for
 * drill-down detail remain permitted (the design's scope boundary, section 14).
 *
 * This is a test helper, not production instrumentation — adding a production hook to enforce a
 * test-time invariant would pay a runtime cost forever for a check that belongs in CI.
 */

/** Methods that carry SQL and are recorded by {@link recordStatements}. */
const SQL_METHODS = ['queryAll', 'queryFirst', 'run', 'exec'] as const;

/** Wrap a DbAdapter, recording every executed SQL statement. */
export function recordStatements(db: DbAdapter): { db: DbAdapter; statements: string[] } {
    const statements: string[] = [];
    const recorded = new Proxy(db, {
        get(target, prop) {
            const value = Reflect.get(target, prop, target);
            if (typeof prop === 'string' && (SQL_METHODS as readonly string[]).includes(prop)) {
                return (sql: string, ...params: unknown[]) => {
                    statements.push(sql);
                    return (value as (...args: unknown[]) => unknown).call(target, sql, ...params);
                };
            }
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    return { db: recorded, statements };
}

/** A single-statement violation of the materialized-only read path. */
export interface NoRawAggregationViolation {
    statement: string;
    table: string;
}

/**
 * Assert no executed statement groups or aggregates over `history_message` / `history_tool_call`.
 *
 * A statement is a violation when it names one of the raw tables AND (`GROUP BY` or a bare aggregate
 * function is present) — unless its predicate on the raw table is limited to an equality on
 * `record_hash`. Point lookups by `record_hash` for drill-down remain permitted.
 */
export function assertNoRawAggregation(statements: readonly string[]): NoRawAggregationViolation[] {
    const rawTables = ['history_message', 'history_tool_call'];
    const aggregatePattern = /\b(GROUP BY|COUNT|SUM|AVG|MIN|MAX)\b/i;
    const violations: NoRawAggregationViolation[] = [];
    for (const sql of statements) {
        const table = rawTables.find((t) => new RegExp(`\\b${t}\\b`, 'i').test(sql));
        if (table === undefined) continue;
        // A record_hash point lookup is permitted. Only aggregate/group statements that ALSO name a
        // raw table are violations. A statement naming record_hash only in equality predicates and
        // carrying no aggregate is a drill-down read and must pass.
        if (aggregatePattern.test(sql)) {
            violations.push({ statement: sql, table });
        }
    }
    return violations;
}
