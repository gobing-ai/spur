import type { DbAdapter } from '@gobing-ai/ts-db';
import { ROUTING_SUMMARY_DEFAULT_WINDOW_MS, type RoutingSummaryWindow } from '../dao/system-event-dao';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Token totals for one role over a window, split by mapping exactness (R4).
 * Deliberately omits any currency field — the task's R2 measurable is "the new
 * surface's output contains no currency field", and `costUsd` stays on the
 * shared `TokenTotals` bucket untouched (neither extended nor read).
 */
export interface RoleTokenTotals {
    /** Total billed input: fresh + cache read + cache write (typed columns exclude cache). */
    inputTokens: number;
    outputTokens: number;
    /** Input tokens served from the provider's prompt cache. */
    cacheReadTokens: number;
    /** Input tokens written into the provider's prompt cache (`history_message.cache_write_tokens`). */
    cacheCreationTokens: number;
    /** Matched `history_message` rows folded into this bucket. */
    records: number;
    /** Rows in this bucket that carried token data — the measured-basis count (R3). */
    recordsWithUsage: number;
}

/**
 * Token consumption of one role over a bounded window (task 0547 R1).
 *
 * `role` is null for dispatches that carried no role (a pure pin), mirroring
 * {@link RoutingSummaryWindow}'s sibling aggregate's nullable role. `totalRuns`
 * is the coverage denominator and `matchedRuns` the numerator (R5); `exact` and
 * `estimated` are the two exactness classes from the run→session mapping
 * (tasks 0557/0558), never summed into one number (R4). `unmeasured` is true
 * when neither bucket holds a measured figure — a role with no matched history
 * rows, or whose rows carry no usage, is reported as unmeasured with the
 * matched-run count, never as zero-as-observed-fact (R3).
 */
export interface RoleTokenAttribution {
    /** Role the attributed runs were serving; null groups pure pins (0546 parity). */
    role: string | null;
    /** Attributed runs in the window — routing rows with an executor (coverage denominator, R5). */
    totalRuns: number;
    /** Attributed runs that matched ≥1 history row via the run→session mapping (coverage numerator, R5). */
    matchedRuns: number;
    /** Totals from `exact` mappings (task 0557 observed/supplied); null when no measured exact figure. */
    exact: RoleTokenTotals | null;
    /** Totals from `estimated` mappings (task 0558 retroactive); null when no measured estimated figure. */
    estimated: RoleTokenTotals | null;
    /** True when neither bucket holds a measured figure — unmeasured, never zero-as-fact (R3). */
    unmeasured: boolean;
}

/** Result of {@link roleTokenSummary}: per-role attributions plus the window actually covered (R5). */
export interface RoleTokenSummaryResult {
    /** The inclusive window the counts cover — reported, never implied. */
    window: RoutingSummaryWindow;
    /** Per-role attributions, deterministic order (role ASC, nulls as ''). */
    roles: RoleTokenAttribution[];
}

/** Options for {@link roleTokenSummary}, mirroring {@link SystemEventDao.routingSummary}. */
export interface RoleTokenSummaryQuery {
    /** Inclusive lower bound (ISO); defaults to {@link ROUTING_SUMMARY_DEFAULT_WINDOW_MS} before `until`. */
    since?: string;
    /** Inclusive upper bound (ISO); defaults to now. */
    until?: string;
}

// ---------------------------------------------------------------------------
// Aggregation (R1: routing attribution → run→session mapping → typed columns)
// ---------------------------------------------------------------------------

/**
 * Aggregate token consumption by role over a bounded window (task 0547).
 *
 * The join mirrors `routingSummary`'s source (attributed `agent.invoke.start`
 * rows on `system_events` carrying a routing block) and `attributeActionCost`'s
 * fold (typed `history_message` token columns through the `history_run_session`
 * run→session mapping — feature E6). Each attributed run's mapped sessions'
 * typed columns are folded per exactness class; a role's `exact` and
 * `estimated` buckets are reported separately (R4) and never summed.
 *
 * Never-fabricate (R3): a bucket is present only when its matched rows carried
 * token data (`recordsWithUsage > 0`). A role with no matched rows, or whose
 * rows carry no usage, reports `unmeasured` with the matched-run count — zero
 * tokens are never presented as an observed fact. Coverage (R5) is reported as
 * `matchedRuns` of `totalRuns` so a thin dataset reads as thin.
 *
 * No dollar figure is computed anywhere (R2): `history_message.cost_usd` and
 * the pricing tables stay unread, and the result type has no currency field.
 *
 * `ponytail:` a mapped session is folded whole (like `attributeActionCost`'s
 * bound-less action path), so two runs mapping the same session attribute its
 * tokens to both. Per-message attribution inside a shared session would need
 * per-message run stamps — add when a step-level breakdown is requested.
 */
export async function roleTokenSummary(
    db: DbAdapter,
    spec: RoleTokenSummaryQuery = {},
): Promise<RoleTokenSummaryResult> {
    const until = spec.until ?? new Date().toISOString();
    const since = spec.since ?? new Date(Date.parse(until) - ROUTING_SUMMARY_DEFAULT_WINDOW_MS).toISOString();
    const window: RoutingSummaryWindow = { since, until };

    const [runsByRole, folds] = await Promise.all([loadAttributedRuns(db, window), loadFolds(db, window)]);

    const byRole = new Map<string | null, RoleTokenAttribution>();
    for (const r of runsByRole) {
        byRole.set(r.role, {
            role: r.role,
            totalRuns: r.runs,
            matchedRuns: 0,
            exact: null,
            estimated: null,
            unmeasured: true,
        });
    }

    for (const f of folds) {
        const entry = byRole.get(f.role) ?? {
            role: f.role,
            totalRuns: 0,
            matchedRuns: 0,
            exact: null,
            estimated: null,
            unmeasured: true,
        };
        entry.matchedRuns = f.matchedRuns;
        if (f.recordsWithUsage > 0) {
            const bucket: RoleTokenTotals = {
                inputTokens: f.inputTokens,
                outputTokens: f.outputTokens,
                cacheReadTokens: f.cacheReadTokens,
                cacheCreationTokens: f.cacheWriteTokens,
                records: f.records,
                recordsWithUsage: f.recordsWithUsage,
            };
            if (f.exactness === 'exact') entry.exact = bucket;
            else if (f.exactness === 'estimated') entry.estimated = bucket;
            // Any other exactness value carries no measured figure — ignored
            // (the mapping WHERE clause already excludes `unresolved` rows).
        }
        entry.unmeasured = entry.exact === null && entry.estimated === null;
        byRole.set(f.role, entry);
    }

    const roles = [...byRole.values()].sort((a, b) => (a.role ?? '').localeCompare(b.role ?? ''));
    return { window, roles };
}

/** Attributed runs per role in the window — the coverage denominator (R5). */
async function loadAttributedRuns(
    db: DbAdapter,
    window: RoutingSummaryWindow,
): Promise<Array<{ role: string | null; runs: number }>> {
    try {
        return await db.queryAll<{ role: string | null; runs: number }>(
            `SELECT json_extract(payload_json, '$.data.routing.role') AS role,
                    COUNT(*) AS runs
             FROM system_events
             WHERE event_name = 'agent.invoke.start'
               AND occurred_at >= ?1 AND occurred_at <= ?2
               AND json_valid(payload_json) = 1
               AND json_extract(payload_json, '$.data.routing.executor') IS NOT NULL
             GROUP BY role`,
            window.since,
            window.until,
        );
    } catch (error) {
        if (error instanceof Error && error.message.includes('no such table: system_events')) {
            return [];
        }
        throw error;
    }
}

/** One folded (role, exactness) group with matched-run and token sums. */
interface RoleTokenFoldRow {
    role: string | null;
    exactness: 'exact' | 'estimated';
    /** Attributed runs whose mapped session matched ≥1 history row. */
    matchedRuns: number;
    records: number;
    recordsWithUsage: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}

/**
 * Fold typed token columns per (role, exactness). `system_events` is the
 * attribution source (same rows `routingSummary` reads); `history_run_session`
 * is the run→session mapping; `history_message` supplies the typed columns.
 * A missing mapping or history plane reads as empty — best-effort like the
 * rest of the trace path (unmigrated DB / no coverage yet), never a throw.
 */
async function loadFolds(db: DbAdapter, window: RoutingSummaryWindow): Promise<RoleTokenFoldRow[]> {
    try {
        return await db.queryAll<RoleTokenFoldRow>(
            `WITH routed AS (
                 SELECT id, run_id,
                        json_extract(payload_json, '$.data.routing.role') AS role
                 FROM system_events
                 WHERE event_name = 'agent.invoke.start'
                   AND occurred_at >= ?1 AND occurred_at <= ?2
                   AND json_valid(payload_json) = 1
                   AND json_extract(payload_json, '$.data.routing.executor') IS NOT NULL
             ),
             mapped AS (
                 SELECT r.role AS role, m.run_id AS run_id,
                        m.source AS source, m.session_id AS session_id,
                        m.exactness AS exactness
                 FROM routed r
                 JOIN history_run_session m ON m.run_id = r.run_id
                 WHERE m.session_id IS NOT NULL
             ),
             -- Coverage numerator (R5): DISTINCT runs per role that matched ≥1
             -- history row. Computed over the mapping join alone (not per
             -- exactness class) so a run with mappings in BOTH classes counts
             -- once, never twice.
             matched_runs AS (
                 SELECT m.role AS role, COUNT(DISTINCT m.run_id) AS matchedRuns
                 FROM mapped m
                 JOIN history_message h
                   ON h.source = m.source AND h.session_id = m.session_id
                 GROUP BY m.role
             )
             SELECT m.role AS role, m.exactness AS exactness,
                    COALESCE(mr.matchedRuns, 0) AS matchedRuns,
                    COUNT(h.record_hash) AS records,
                    COALESCE(SUM(CASE WHEN h.input_tokens IS NOT NULL OR h.output_tokens IS NOT NULL
                                      THEN 1 ELSE 0 END), 0) AS recordsWithUsage,
                    COALESCE(SUM(h.input_tokens), 0) + COALESCE(SUM(h.cache_read_tokens), 0)
                        + COALESCE(SUM(h.cache_write_tokens), 0) AS inputTokens,
                    COALESCE(SUM(h.output_tokens), 0) AS outputTokens,
                    COALESCE(SUM(h.cache_read_tokens), 0) AS cacheReadTokens,
                    COALESCE(SUM(h.cache_write_tokens), 0) AS cacheWriteTokens
             FROM mapped m
             LEFT JOIN matched_runs mr ON mr.role = m.role
             LEFT JOIN history_message h
               ON h.source = m.source AND h.session_id = m.session_id
             GROUP BY m.role, m.exactness`,
            window.since,
            window.until,
        );
    } catch (error) {
        if (error instanceof Error) {
            const msg = error.message;
            if (
                msg.includes('no such table: system_events') ||
                msg.includes('no such table: history_run_session') ||
                msg.includes('no such table: history_message')
            ) {
                return [];
            }
        }
        throw error;
    }
}
