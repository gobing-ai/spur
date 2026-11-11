import type { DbAdapter } from '@gobing-ai/ts-db';

/**
 * Executor latency history for adaptive agent-run budgets (D3 / task 1323).
 * Reads the same `history_board_model_stats` rollup the history board
 * maintains; raw persistence stays in domain (ADR-011) so app services consume
 * this through `@gobing-ai/spur-domain`.
 */

/** Observed latency for one executor (or its model) from run history. */
export interface ExecutorLatencyStats {
    /** Mean observed duration in ms. */
    meanMs: number;
    /** p95 duration when the source provides one; absent → derived from mean. */
    p95Ms?: number;
    /** Sample count backing the durations; 0 means "no evidence". */
    samples: number;
    /** Success ratio clamped to [0,1]; 1 when no failure evidence exists. */
    successRate: number;
}

interface ModelStatsRow {
    model: string;
    assistant_duration_ms: number;
    assistant_duration_samples: number;
    errors: number;
    tool_calls: number;
}

/**
 * Read observed latency for the given executor/model keys from
 * `history_board_model_stats` (the table the history board rollup maintains).
 * A missing table, empty history or any read failure degrades to an empty map
 * — static behavior, never a failed dispatch (Q&A: degrades when history is
 * empty).
 */
export async function readExecutorLatency(
    db: DbAdapter,
    keys: readonly string[],
): Promise<Map<string, ExecutorLatencyStats>> {
    const wanted = [...new Set(keys)].filter((key) => key.length > 0);
    if (wanted.length === 0) return new Map();
    try {
        const placeholders = wanted.map(() => '?').join(', ');
        const rows = await db.queryAll<ModelStatsRow>(
            `SELECT model, assistant_duration_ms, assistant_duration_samples, errors, tool_calls
             FROM history_board_model_stats WHERE model IN (${placeholders})`,
            ...wanted,
        );
        const stats = new Map<string, ExecutorLatencyStats>();
        for (const row of rows) {
            const samples = row.assistant_duration_samples;
            if (samples <= 0) continue;
            // Success proxy from the same table: tool error ratio. No tool
            // evidence at all counts as success (no failure observation).
            const successRate = row.tool_calls > 0 ? Math.min(1, Math.max(0, 1 - row.errors / row.tool_calls)) : 1;
            stats.set(row.model, {
                meanMs: row.assistant_duration_ms / samples,
                samples,
                successRate,
            });
        }
        return stats;
    } catch {
        return new Map();
    }
}
