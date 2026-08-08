import type { DbAdapter } from '@gobing-ai/ts-db';
import { cacheHitRatio, computeRecordCost } from './costs';
import { extractClaudeTokens, SOURCE_TABLES } from './query';
import type { CostRecord, EtlPayload, TokenTotals } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal `action_runs` row shape needed for the ETL join. */
export interface ActionRunCostRow {
    id: string;
    kind: string;
    started_at: string | null;
    completed_at: string | null;
    /** `result_json` column — engine-persisted `ActionResult.data` blob carrying invocation details. */
    result_json: string | null;
}

/** Per-action cost computed from matched ETL records. */
export interface ActionCost {
    /** Aggregated token + cost totals across all matched records. */
    totals: TokenTotals;
    /** Cache-hit ratio in [0,1], or null when unavailable (0281/0284 invariant). */
    cacheHit: number | null;
    /** True when the join used the heuristic R1b path (costs are estimates). */
    estimated: boolean;
}

/** Zero-value {@link ActionCost} for unjoinable steps. */
const UNAVAILABLE: ActionCost = Object.freeze({
    totals: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        records: 0,
        recordsWithUsage: 0,
        messages: 0,
        toolCalls: 0,
        durationMs: 0,
        durationUnmeasured: 0,
    },
    cacheHit: null,
    estimated: false,
});

// ---------------------------------------------------------------------------
// Session-id extraction (R1a infrastructure)
// ---------------------------------------------------------------------------

/**
 * Pull the agent session/conversation id from an action's `result_json`.
 * Returns `undefined` when no session id was captured (common — most agents
 * don't expose one through the current runner seam), falling through to R1b.
 */
export function extractSessionId(action: ActionRunCostRow): string | undefined {
    if (!action.result_json) return undefined;
    try {
        const parsed = JSON.parse(action.result_json);
        const sid = (parsed as Record<string, unknown>)?.invocation as Record<string, unknown> | undefined;
        return typeof sid?.sessionId === 'string' ? sid.sessionId : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Extract the resolved agent name and model from an action's `result_json`.
 * Used by R1b to narrow the time-window join to matching agent/model pairs.
 */
function extractAgentModel(action: ActionRunCostRow): { agent: string | undefined; model: string | undefined } {
    if (!action.result_json) return { agent: undefined, model: undefined };
    try {
        const parsed = JSON.parse(action.result_json);
        const inv = (parsed as Record<string, unknown>)?.invocation as Record<string, unknown> | undefined;
        return {
            agent: typeof inv?.agent === 'string' ? inv.agent : undefined,
            model: typeof inv?.model === 'string' ? inv.model : undefined,
        };
    } catch {
        return { agent: undefined, model: undefined };
    }
}

// ---------------------------------------------------------------------------
// ETL matching
// ---------------------------------------------------------------------------

/** A matched-record set plus whether the R1b heuristic (not an exact session-id join) produced it. */
export interface EtlMatch {
    /** ETL payloads attributed to the action. */
    records: readonly EtlPayload[];
    /** True when the R1b time-window heuristic was used (no session id) — costs are estimates. */
    estimated: boolean;
}

/**
 * Load every imported ETL payload across all source tables once.
 *
 * Split out from matching so a caller iterating many actions (e.g. a trace with
 * several `agent.run` steps) pays the table scan a single time and matches each
 * action in memory, instead of re-scanning every table per action. Absent tables
 * and unparseable rows are skipped (best-effort, like the rest of the trace path).
 */
export async function loadAllEtlPayloads(db: DbAdapter): Promise<readonly EtlPayload[]> {
    const payloads: EtlPayload[] = [];
    for (const table of SOURCE_TABLES) {
        let rows: Array<{ payload_json: string }>;
        try {
            rows = await db.queryAll<{ payload_json: string }>(`SELECT payload_json FROM ${table}`);
        } catch {
            continue; // Table doesn't exist yet — skip
        }
        for (const row of rows) {
            try {
                payloads.push(JSON.parse(row.payload_json) as EtlPayload);
            } catch {
                // Skip unparseable rows
            }
        }
    }
    return payloads;
}

/**
 * Match pre-loaded ETL payloads to a workflow `action_runs` row (pure, no I/O).
 *
 * Prefers an exact join on the agent's session id (R1a, `estimated: false`); falls
 * back to a time-window heuristic limited to matching agent/model pairs (R1b,
 * `estimated: true`). The `estimated` flag *is* the R1a/R1b path, so callers no
 * longer re-parse the action to re-derive it.
 */
export function matchEtlPayloads(payloads: readonly EtlPayload[], action: ActionRunCostRow): EtlMatch {
    const sessionId = extractSessionId(action);
    if (sessionId) {
        const records = payloads.filter((p) => (p as Record<string, unknown>).sessionId === sessionId);
        return { records, estimated: false };
    }

    const { agent, model } = extractAgentModel(action);
    const startedAt = action.started_at ? new Date(action.started_at).getTime() : 0;
    const completedAt = action.completed_at ? new Date(action.completed_at).getTime() : Date.now();

    const records = payloads.filter((p) => {
        const record = p as Record<string, unknown>;
        const createdAt = new Date(String(record.created_at ?? '')).getTime();
        if (Number.isNaN(createdAt)) return false;
        if (createdAt < startedAt || createdAt > completedAt) return false;
        // Narrow by agent/model when available in invocation data
        if (agent && record.agent !== agent) return false;
        if (model && record.model !== model) return false;
        return true;
    });
    return { records, estimated: true };
}

/**
 * Match imported ETL records to a single workflow `action_runs` row: loads the
 * source tables, then matches. For many actions, prefer {@link loadAllEtlPayloads}
 * once + {@link matchEtlPayloads} per action to avoid re-scanning per action.
 *
 * Prefers an exact join on the agent's session id (R1a); falls back to a
 * time-window heuristic limited to matching agent/model pairs (R1b).
 */
export async function matchEtlForAction(db: DbAdapter, action: ActionRunCostRow): Promise<EtlMatch> {
    const payloads = await loadAllEtlPayloads(db);
    return matchEtlPayloads(payloads, action);
}

// ---------------------------------------------------------------------------
// Cost computation
// ---------------------------------------------------------------------------

/**
 * Compute per-action token cost and cache-hit ratio from matched ETL records
 * by feeding them through the existing analytics cost path.
 *
 * Returns a zeroed shape with `cacheHit: null` when no records matched —
 * the caller renders `n/a`, never `$0.00` (0281/0284 invariant).
 */
export function actionCost(matchedRecords: readonly EtlPayload[], source: string): ActionCost {
    if (matchedRecords.length === 0) {
        return UNAVAILABLE;
    }

    const costRecords: CostRecord[] = [];
    for (const payload of matchedRecords) {
        costRecords.push(computeRecordCost(payloadToCostRecord(payload, source)));
    }

    const totals = foldTotals(costRecords);
    const cacheHit = cacheHitRatio(totals);

    return {
        totals,
        cacheHit,
        estimated: false,
    };
}

/**
 * Fold priced cost records into a {@link TokenTotals} bucket. The in-memory
 * `aggregateCosts` that used to do this was retired with the analyze SQL cut-over
 * (task 0474, R7); run-cost still needs a small local fold over the bounded set of
 * matched records. The forensic dimensions (`messages`, `toolCalls`, `durationMs`,
 * `durationUnmeasured`) are not derivable from ETL payloads and stay 0 here.
 */
function foldTotals(records: readonly CostRecord[]): TokenTotals {
    const totals: TokenTotals = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        records: 0,
        recordsWithUsage: 0,
        messages: 0,
        toolCalls: 0,
        durationMs: 0,
        durationUnmeasured: 0,
    };
    for (const record of records) {
        totals.inputTokens += record.inputTokens;
        totals.outputTokens += record.outputTokens;
        totals.cacheReadTokens += record.cacheReadTokens;
        totals.cacheWriteTokens += record.cacheCreationTokens;
        totals.costUsd += record.costUsd;
        totals.records += 1;
        if (record.usageReported) totals.recordsWithUsage += 1;
    }
    return totals;
}

/**
 * Build a {@link CostRecord} from an ETL payload using the provider `usage` object.
 * Mirrors the retired `etlToCostRecord` without its 4-chars-per-token length estimate
 * (task 0474 R7): an estimate silently entering a cost total is the fabrication the
 * forensic contract exists to end. Absent usage yields zero tokens with
 * `usageReported: false` — the never-fabricate invariant, not a guessed number.
 */
function payloadToCostRecord(payload: EtlPayload, source: string): CostRecord {
    const tokens = extractClaudeTokens(payload);
    return {
        source,
        date: payload.created_at?.slice(0, 10) ?? 'unknown',
        model: payload.model ?? 'unknown',
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        cacheReadTokens: tokens.cacheReadTokens,
        cacheCreationTokens: tokens.cacheCreationTokens,
        usageReported: tokens.usageReported,
        costUsd: 0, // Filled by cost computation
    };
}

/**
 * Variant of {@link actionCost} that marks the result as estimated (R1b path).
 * Called when the join used the time-window heuristic rather than an exact
 * session-id match.
 */
export function actionCostEstimated(matchedRecords: readonly EtlPayload[], source: string): ActionCost {
    const cost = actionCost(matchedRecords, source);
    return matchedRecords.length === 0 ? cost : { ...cost, estimated: true };
}
