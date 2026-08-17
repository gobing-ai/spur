import type { DbAdapter } from '@gobing-ai/ts-db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One (executor, role) pairing aggregated over a window (feature J8 R1).
 *
 * `agent` and `model` are denormalized from the dispatching `agent.invoke.start`
 * row: an executor IS an (agent, model) pair (models are pinned in config), so
 * the pairing is keyed by (executor, role) and the model rides as a nullable
 * attribute — null for pre-pin history rows that recorded no model.
 *
 * `escalations` is keyed by the escalation trigger; an empty object means the
 * pairing never escalated (absence, not a zero-valued row). `successRate` is the
 * share of dispatches whose FINAL dispatch outcome was `done` (0..1). Cost is
 * folded through the run→session mapping exactly as {@link roleTokenSummary}
 * does; a pairing with no mapped history rows carries 0 — the artifact's
 * cost field is a total, not a coverage claim.
 */
export interface PairingStat {
    /** Resolved executor name (`routing.executor`). */
    executor: string;
    /** Role the dispatches served (`routing.role`; non-null — pure pins are out of scope). */
    role: string;
    /** Denormalized coding-agent name from the dispatch payload. */
    agent: string;
    /** Denormalized model from the dispatch payload; null when not recorded. */
    model: string | null;
    /** `agent.invoke.start` rows attributed to this pairing. */
    dispatches: number;
    /** Share of dispatches whose final dispatch outcome was `done` (0..1). */
    successRate: number;
    /** Escalation counts keyed by `agent.invoke.escalated.trigger`; {} when none. */
    escalations: Record<string, number>;
    /** Folded `history_message.cost_usd` through the run→session mapping. */
    totalCostUsd: number;
    /** Mean `agent.invoke.exit.durationMs` across dispatches with a measured duration; 0 when none. */
    meanDurationMs: number;
}

/** Options for {@link pairingSummary}. Absent bounds are unbounded — the analyze artifact is full-history. */
export interface PairingSummaryOptions {
    /** Inclusive lower bound on `system_events.occurred_at` (ISO). */
    since?: string;
    /** Inclusive upper bound on `system_events.occurred_at` (ISO). */
    until?: string;
}

// ---------------------------------------------------------------------------
// Aggregation (R1: dispatch/exit/escalation rows + run→session cost fold)
// ---------------------------------------------------------------------------

/**
 * Aggregate per-(executor, role) dispatch statistics over a bounded window
 * (feature J8 R1).
 *
 * Source rows mirror `roleTokenSummary`'s: `agent.invoke.start` dispatches on
 * `system_events` carrying a routing block (executor + role), with the final
 * outcome and duration from the `agent.invoke.exit` row joined on
 * `executionId` (one dispatch = one start + one exit). Escalations
 * (`agent.invoke.escalated`, keyed by `trigger`) are attributed to the pairing
 * of the dispatch that started the run on that executor — the earliest dispatch
 * per (run_id, executor), mirroring `routingSummary`'s escalation join so an
 * escalation is never fanned out across sibling groups sharing the pair.
 *
 * Cost folds through the run→session mapping (`history_run_session`) into the
 * typed `history_message.cost_usd` column exactly as {@link roleTokenSummary}
 * does. Rates are computed in TS after the fetch (small N; no SQL ratio
 * gymnastics).
 *
 * Never-fabricate (R1): a pairing exists only when it has ≥1 attributed
 * dispatch — zero-attribution pairings are absent, never zero-valued. A
 * missing `system_events` / history plane reads as empty (best-effort like the
 * rest of the trace path), never a throw.
 *
 * `ponytail:` a mapped session is folded whole per dispatch, so a run that
 * escalates folds its session cost to every executor pairing it dispatched on
 * (the same whole-session fold {@link roleTokenSummary} applies). Per-message
 * attribution inside a shared session would need per-message run stamps — add
 * when a step-level breakdown is requested.
 */
export async function pairingSummary(db: DbAdapter, spec: PairingSummaryOptions = {}): Promise<PairingStat[]> {
    const [dispatchRows, escRows, foldRows] = await Promise.all([
        loadDispatchStats(db, spec),
        loadEscalations(db, spec),
        loadFolds(db, spec),
    ]);

    // The dispatch SQL groups by (executor, role, agent, model), so one
    // (executor, role) can arrive as several rows when a model pin changes
    // mid-window. Accumulate across those rows instead of overwriting — a
    // `byKey.set` per row would silently keep only the last group, dropping
    // dispatches/successes/durations from the earlier ones. `agent`/`model`
    // stay as the first-seen values (denormalized-attribute contract).
    const rawByKey = new Map<string, DispatchStatRow>();
    for (const d of dispatchRows) {
        const key = pairingKey(d.executor, d.role);
        const existing = rawByKey.get(key);
        if (existing === undefined) {
            rawByKey.set(key, { ...d });
        } else {
            existing.dispatches += d.dispatches;
            existing.successes += d.successes;
            existing.durationTotal += d.durationTotal;
            existing.durationCount += d.durationCount;
        }
    }

    const byKey = new Map<string, PairingStat>();
    for (const [key, d] of rawByKey) {
        byKey.set(key, {
            executor: d.executor,
            role: d.role,
            agent: d.agent,
            model: d.model,
            dispatches: d.dispatches,
            successRate: d.dispatches > 0 ? d.successes / d.dispatches : 0,
            escalations: {},
            totalCostUsd: 0,
            meanDurationMs: d.durationCount > 0 ? d.durationTotal / d.durationCount : 0,
        });
    }
    for (const e of escRows) {
        const entry = byKey.get(pairingKey(e.executor, e.role));
        if (entry === undefined) continue;
        entry.escalations[e.trigger] = (entry.escalations[e.trigger] ?? 0) + e.count;
    }
    for (const f of foldRows) {
        const entry = byKey.get(pairingKey(f.executor, f.role));
        if (entry === undefined) continue;
        entry.totalCostUsd += f.totalCostUsd;
    }

    // Deterministic order — never optimizer-dependent.
    return [...byKey.values()].sort((a, b) => a.executor.localeCompare(b.executor) || a.role.localeCompare(b.role));
}

/** NUL-free grouping key for one (executor, role) pair. */
function pairingKey(executor: string, role: string): string {
    return `${executor}\u0000${role}`;
}

/** One aggregated dispatch row from the dispatch × exit join. */
interface DispatchStatRow {
    executor: string;
    role: string;
    agent: string;
    model: string | null;
    dispatches: number;
    successes: number;
    durationTotal: number;
    durationCount: number;
}

/** Dispatch + final-outcome + duration stats per (executor, role). */
async function loadDispatchStats(db: DbAdapter, spec: PairingSummaryOptions): Promise<DispatchStatRow[]> {
    try {
        const { where, params } = eventWindow(spec);
        return await db.queryAll<DispatchStatRow>(
            `WITH dispatch AS (
                 SELECT id, run_id, occurred_at,
                        json_extract(payload_json, '$.data.executionId') AS execution_id,
                        json_extract(payload_json, '$.data.agent') AS agent,
                        json_extract(payload_json, '$.data.model') AS model,
                        json_extract(payload_json, '$.data.routing.executor') AS executor,
                        json_extract(payload_json, '$.data.routing.role') AS role
                 FROM system_events
                 WHERE event_name = 'agent.invoke.start'
                   ${where}
                   AND json_valid(payload_json) = 1
                   AND json_extract(payload_json, '$.data.routing.executor') IS NOT NULL
                   AND json_extract(payload_json, '$.data.routing.role') IS NOT NULL
             ),
             exit_rows AS (
                 SELECT id, occurred_at,
                        json_extract(payload_json, '$.data.executionId') AS execution_id,
                        json_extract(payload_json, '$.data.outcome') AS outcome,
                        json_extract(payload_json, '$.data.durationMs') AS duration_ms
                 FROM system_events
                 WHERE event_name = 'agent.invoke.exit'
                   ${where}
                   AND json_valid(payload_json) = 1
                   AND json_extract(payload_json, '$.data.executionId') IS NOT NULL
             ),
             -- One exit per executionId: the latest. An execution emits one exit,
             -- but picking the latest keeps the FINAL dispatch outcome honest if
             -- a re-dispatch ever reuses an id.
             fin AS (
                 SELECT x.* FROM exit_rows x
                 WHERE x.id = (
                     SELECT x2.id FROM exit_rows x2
                     WHERE x2.execution_id = x.execution_id
                     ORDER BY x2.occurred_at DESC, x2.id DESC
                     LIMIT 1
                 )
             )
             SELECT d.executor AS executor, d.role AS role, d.agent AS agent, d.model AS model,
                    COUNT(DISTINCT d.id) AS dispatches,
                    COALESCE(SUM(CASE WHEN f.outcome = 'done' THEN 1 ELSE 0 END), 0) AS successes,
                    COALESCE(SUM(f.duration_ms), 0) AS durationTotal,
                    COALESCE(SUM(CASE WHEN f.duration_ms IS NOT NULL THEN 1 ELSE 0 END), 0) AS durationCount
             FROM dispatch d
             LEFT JOIN fin f ON f.execution_id = d.execution_id
             GROUP BY d.executor, d.role, d.agent, d.model`,
            ...params,
            ...params,
        );
    } catch (error) {
        if (error instanceof Error && error.message.includes('no such table: system_events')) {
            return [];
        }
        throw error;
    }
}

/** One escalation count row attributed to a pairing. */
interface EscalationRow {
    executor: string;
    role: string;
    trigger: string;
    count: number;
}

/**
 * Escalation counts per (executor, role, trigger). Each `agent.invoke.escalated`
 * row names only run_id + fromExecutor, so it is attributed to the pairing of
 * the EARLIEST dispatch of that run on that executor (mirrors routingSummary's
 * `first_routed`) — never fanned out across every (executor, role) group sharing
 * the run. A row with no fromExecutor is excluded (absence is the signal).
 */
async function loadEscalations(db: DbAdapter, spec: PairingSummaryOptions): Promise<EscalationRow[]> {
    try {
        const { where, params } = eventWindow(spec);
        return await db.queryAll<EscalationRow>(
            `WITH dispatch AS (
                 SELECT id, run_id, occurred_at,
                        json_extract(payload_json, '$.data.routing.executor') AS executor,
                        json_extract(payload_json, '$.data.routing.role') AS role
                 FROM system_events
                 WHERE event_name = 'agent.invoke.start'
                   ${where}
                   AND json_valid(payload_json) = 1
                   AND json_extract(payload_json, '$.data.routing.executor') IS NOT NULL
                   AND json_extract(payload_json, '$.data.routing.role') IS NOT NULL
             ),
             first_dispatch AS (
                 SELECT d.* FROM dispatch d
                 WHERE d.id = (
                     SELECT d2.id FROM dispatch d2
                     WHERE d2.run_id = d.run_id AND d2.executor = d.executor
                     ORDER BY d2.occurred_at, d2.id
                     LIMIT 1
                 )
             ),
             esc AS (
                 SELECT id, run_id,
                        json_extract(payload_json, '$.data.fromExecutor') AS from_executor,
                        json_extract(payload_json, '$.data.trigger') AS trigger
                 FROM system_events
                 WHERE event_name = 'agent.invoke.escalated'
                   ${where}
                   AND json_valid(payload_json) = 1
                   AND json_extract(payload_json, '$.data.fromExecutor') IS NOT NULL
             )
             SELECT fd.executor AS executor, fd.role AS role, e.trigger AS trigger,
                    COUNT(DISTINCT e.id) AS count
             FROM esc e
             JOIN first_dispatch fd ON fd.run_id = e.run_id AND fd.executor = e.from_executor
             GROUP BY fd.executor, fd.role, e.trigger
             ORDER BY fd.executor, fd.role, e.trigger`,
            ...params,
            ...params,
        );
    } catch (error) {
        if (error instanceof Error && error.message.includes('no such table: system_events')) {
            return [];
        }
        throw error;
    }
}

/** One folded cost row for a pairing. */
interface FoldRow {
    executor: string;
    role: string;
    totalCostUsd: number;
}

/**
 * Fold `history_message.cost_usd` per (executor, role) through the run→session
 * mapping — the same `history_run_session` → `history_message` fold
 * {@link roleTokenSummary} applies. A missing mapping or history plane reads as
 * empty (best-effort like the rest of the trace path), never a throw.
 */
async function loadFolds(db: DbAdapter, spec: PairingSummaryOptions): Promise<FoldRow[]> {
    try {
        const { where, params } = eventWindow(spec);
        return await db.queryAll<FoldRow>(
            `WITH routed AS (
                 SELECT run_id,
                        json_extract(payload_json, '$.data.routing.executor') AS executor,
                        json_extract(payload_json, '$.data.routing.role') AS role
                 FROM system_events
                 WHERE event_name = 'agent.invoke.start'
                   ${where}
                   AND json_valid(payload_json) = 1
                   AND json_extract(payload_json, '$.data.routing.executor') IS NOT NULL
                   AND json_extract(payload_json, '$.data.routing.role') IS NOT NULL
             ),
             mapped AS (
                 SELECT r.executor AS executor, r.role AS role, m.run_id AS run_id,
                        m.source AS source, m.session_id AS session_id
                 FROM routed r
                 JOIN history_run_session m ON m.run_id = r.run_id
                 WHERE m.session_id IS NOT NULL
             )
             SELECT m.executor AS executor, m.role AS role,
                    COALESCE(SUM(h.cost_usd), 0) AS totalCostUsd
             FROM mapped m
             LEFT JOIN history_message h
               ON h.source = m.source AND h.session_id = m.session_id
             GROUP BY m.executor, m.role`,
            ...params,
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

/**
 * Conditional `occurred_at` window clauses shared by every system_events query.
 * Absent bounds contribute nothing — the analyze artifact is full-history by
 * default, and a caller wanting a bounded window supplies the bounds.
 */
function eventWindow(spec: PairingSummaryOptions): { where: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (spec.since !== undefined) {
        clauses.push('occurred_at >= ?');
        params.push(spec.since);
    }
    if (spec.until !== undefined) {
        clauses.push('occurred_at <= ?');
        params.push(spec.until);
    }
    return { where: clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '', params };
}
