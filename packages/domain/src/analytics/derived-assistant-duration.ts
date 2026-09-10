import type { DbAdapter } from '@gobing-ai/ts-db';

/**
 * Set-based backfill of assistant-step `duration_ms` the sources never wrote
 * (0702 R2), replacing the upstream per-row `deriveAssistantDurations` loop at
 * the import call site. The loop awaited one UPDATE per candidate row — ~167k
 * roundtrips ≈ 15+ min on a 2M-row corpus, which alone blew the 600s refresh
 * job budget every run. One window-function UPDATE does the same work in
 * seconds (7.7s measured on the real corpus).
 *
 * Semantics preserved from the upstream contract: assistant rows only, delta
 * to the preceding record of the same (source, session_id) in `seq` order,
 * positive deltas up to `ceilingMs` only, provider values and earlier derived
 * values never overwritten, rows without a parseable timestamp untouched.
 */
export async function deriveMissingAssistantDurations(db: DbAdapter, ceilingMs: number): Promise<void> {
    await db.run(`
        WITH ordered AS (
            SELECT record_hash AS recordHash,
                   role,
                   duration_ms,
                   CAST(ROUND((unixepoch(ts, 'subsec') - unixepoch(LAG(ts) OVER (
                       PARTITION BY source, session_id ORDER BY seq
                   ), 'subsec')) * 1000) AS INTEGER) AS deltaMs
            FROM history_message
            WHERE ts IS NOT NULL AND ts LIKE '____-__-__T%'
        )
        UPDATE history_message
        SET duration_ms = ordered.deltaMs,
            duration_source = 'derived'
        FROM ordered
        WHERE history_message.record_hash = ordered.recordHash
          AND ordered.role = 'assistant'
          AND ordered.duration_ms IS NULL
          AND history_message.duration_ms IS NULL
          AND ordered.deltaMs IS NOT NULL
          AND ordered.deltaMs > 0
          AND ordered.deltaMs <= ${ceilingMs}
    `);
}
