import type { DbAdapter } from '@gobing-ai/ts-db';
import { RunSessionDao } from '../dao/run-session-dao';

/**
 * Retroactive time-window correlation of imported history to runs (feature E6 /
 * task 0558, the R1b half). Correlates `history_message` rows that predate
 * run-to-session observation (all 1.3M imported rows have `run_id` NULL) by
 * matching each history session's `(source, cwd, ts)` span against the run
 * windows recorded in `system_events` (`agent.invoke.start` → `agent.invoke.exit`
 * pairs keyed by `run_id` — the PREMISE VERIFICATION source, since
 * `coordination_runs` holds 0 rows). Writes are marked `estimated` / `inferred`:
 * the honest ceiling, since after the fact the only evidence is source, cwd, time.
 *
 * Invariants:
 * - **R2** — an `exact` mapping (task 0557 boundary observation) is never
 *   overwritten or shadowed; enforced in the DAO write path (`insertInferred`).
 * - **R3** — a session matching zero or several run windows produces **no**
 *   mapping and is counted, never a nearest-neighbour guess.
 * - **R4** — the scan is bounded by the explicit window (indexed on `ts` /
 *   `occurred_at`) and re-runs are idempotent (guarded writes).
 *
 * `ponytail:` run cwd is not persisted anywhere (the `agent.invoke.*` payloads
 * carry only agent/operation/label/correlation), so cwd is a session-identity
 * dimension in the grouping, not a per-run filter — the frozen run-window
 * contract has no cwd column either. If a future task persists run cwd, add it
 * to the candidate filter here.
 */
export class RetroCorrelator {
    constructor(private readonly db: DbAdapter) {}

    /**
     * Correlate uncorrelated history rows in `window` to recorded run windows.
     * Returns the report with all three outcome counts (R5) and how many rows
     * were actually written (0 on an idempotent re-run).
     */
    async correlate(window: RetroCorrelationWindow): Promise<RetroCorrelationReport> {
        const dao = new RunSessionDao(this.db);
        const runs = await this.loadRunWindows(window);
        const sessions = await this.loadSessions(window);
        const resolvedAt = new Date().toISOString();

        let correlated = 0;
        let ambiguous = 0;
        let noCandidate = 0;
        let mappingsWritten = 0;

        for (const session of sessions) {
            const candidates = runs.filter(
                (run) => run.source === session.source && run.start <= session.max_ts && run.end >= session.min_ts,
            );
            if (candidates.length === 0) {
                noCandidate += session.row_count;
            } else if (candidates.length === 1) {
                correlated += session.row_count;
                const run = candidates[0];
                const written =
                    run !== undefined &&
                    (await dao.insertInferred({
                        runId: run.runId,
                        source: session.source,
                        sessionId: session.session_id,
                        resolvedAt,
                    }));
                if (written) mappingsWritten += 1;
            } else {
                ambiguous += session.row_count;
            }
        }

        return {
            window,
            correlated,
            ambiguous,
            noCandidate,
            rowsScanned: correlated + ambiguous + noCandidate,
            runsConsidered: runs.length,
            mappingsWritten,
        };
    }

    /** Run windows from `system_events` invoke pairs, bounded to the window. */
    private async loadRunWindows(window: RetroCorrelationWindow): Promise<RunWindow[]> {
        let events: Array<{
            run_id: string | null;
            event_name: string;
            occurred_at: string;
            actor: string | null;
            payload_json: string | null;
        }>;
        try {
            events = await this.db.queryAll(
                `SELECT run_id, event_name, occurred_at, actor, payload_json
                 FROM system_events
                 WHERE event_name IN ('agent.invoke.start', 'agent.invoke.exit')
                   AND occurred_at >= ? AND occurred_at <= ?
                 ORDER BY occurred_at`,
                window.start,
                window.end,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: system_events')) return [];
            throw error;
        }

        const byRun = new Map<string, { source: string | null; starts: string[]; exits: string[] }>();
        for (const event of events) {
            if (event.run_id == null) continue; // no key → cannot write a mapping
            let entry = byRun.get(event.run_id);
            if (!entry) {
                entry = { source: this.extractSource(event), starts: [], exits: [] };
                byRun.set(event.run_id, entry);
            }
            if (event.event_name === 'agent.invoke.start') entry.starts.push(event.occurred_at);
            else entry.exits.push(event.occurred_at);
        }

        const runs: RunWindow[] = [];
        for (const [runId, entry] of byRun) {
            if (entry.starts.length === 0) continue; // unbounded start unknown — skip
            let start = entry.starts[0] as string;
            for (const at of entry.starts) {
                if (at < start) start = at;
            }
            // Open window (missing exit: crash/kill) is bounded by the
            // correlation window's end — never treated as matching
            // everything after it.
            let end = window.end;
            if (entry.exits.length > 0) {
                end = entry.exits[0] as string;
                for (const at of entry.exits) {
                    if (at > end) end = at;
                }
            }
            runs.push({ runId, source: entry.source ?? 'unknown', start, end });
        }
        return runs;
    }

    /** History sessions (source, session_id, cwd) intersecting the window, with their row spans. */
    private async loadSessions(window: RetroCorrelationWindow): Promise<HistorySession[]> {
        try {
            return await this.db.queryAll<HistorySession>(
                `SELECT source, session_id, cwd, MIN(ts) AS min_ts, MAX(ts) AS max_ts, COUNT(*) AS row_count
                 FROM history_message
                 WHERE ts >= ? AND ts <= ? AND run_id IS NULL
                 GROUP BY source, session_id, cwd
                 ORDER BY min_ts`,
                window.start,
                window.end,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: history_message')) return [];
            throw error;
        }
    }

    /** Source (agent id) from the event payload, falling back to the actor column. */
    private extractSource(event: { actor: string | null; payload_json: string | null }): string | null {
        if (event.payload_json) {
            try {
                const parsed = JSON.parse(event.payload_json) as { agent?: unknown };
                if (typeof parsed.agent === 'string' && parsed.agent.length > 0) return parsed.agent;
            } catch {
                // fall through to actor
            }
        }
        return event.actor;
    }
}

/** Explicit correlation window (inclusive ISO bounds). */
export interface RetroCorrelationWindow {
    start: string;
    end: string;
}

/** Outcome report (R5): counts are history rows bucketed within the window. */
export interface RetroCorrelationReport {
    window: RetroCorrelationWindow;
    /** Rows whose session matched exactly one run window — mapped estimated. */
    correlated: number;
    /** Rows whose session matched ≥2 run windows — no mapping written (R3). */
    ambiguous: number;
    /** Rows whose session matched no run window — no mapping (R3). */
    noCandidate: number;
    /** Rows scanned within the window (correlated + ambiguous + noCandidate). */
    rowsScanned: number;
    /** Run windows built from start/exit pairs with a run_id and known source. */
    runsConsidered: number;
    /** Estimated mappings actually written (0 on an idempotent re-run, R4). */
    mappingsWritten: number;
}

interface RunWindow {
    runId: string;
    source: string;
    start: string;
    end: string;
}

interface HistorySession {
    source: string;
    session_id: string;
    cwd: string | null;
    min_ts: string;
    max_ts: string;
    row_count: number;
}
