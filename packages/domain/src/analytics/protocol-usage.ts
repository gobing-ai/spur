import type { DbAdapter } from '@gobing-ai/ts-db';
import { buildTimeRangeClauses } from './selector-time-range';

/**
 * Protocol usage over a bounded window (task 1398, feature I61).
 *
 * The MCP and A2A surfaces emit their own catalog names (1376/1377) onto the same `system_events`
 * ledger as everything else, so a bounded read of those names is enough — no new table and no
 * second bus. This mirrors `pairings`: one windowed query, folded in TypeScript.
 *
 * `ponytail: in-memory percentile; push into SQL or a rollup if a window exceeds ~1e6 protocol
 * events.`
 */

/** Per-tool call statistics for the MCP surface. */
export interface ProtocolToolUsage {
    tool: string;
    /** Successful calls (`mcp.tool.called`). */
    calls: number;
    /** Failed calls (`mcp.tool.failed`). */
    failures: number;
    /** `failures / (calls + failures)`; 0 when the tool has no events. */
    failureRate: number;
    /** Nearest-rank p50 over measured `durationMs`; null when nothing was measured. */
    p50Ms: number | null;
    /** Nearest-rank p95 over measured `durationMs`; null when nothing was measured. */
    p95Ms: number | null;
    /** Rows with no numeric `durationMs` — counted here, excluded from the percentiles, never 0. */
    durationUnmeasured: number;
}

/** Per-resource read statistics. */
export interface ProtocolResourceUsage {
    uri: string;
    reads: number;
    failures: number;
}

/** Per-actor MCP call attribution; a null actor reads as `unknown`, never guessed. */
export interface ProtocolActorUsage {
    actor: string;
    calls: number;
    failures: number;
}

/** A2A intake and cancellation split per member. */
export interface ProtocolA2aUsage {
    member: string;
    /** `outcome=accepted` intake rows. */
    received: number;
    /** `outcome=replayed` intake rows (benign client retry). */
    replayed: number;
    /** `outcome=conflict` intake rows (client bug). */
    conflict: number;
    cancelled: number;
}

/** Bearer refusals per surface and structural reason. */
export interface ProtocolAuthDeniedUsage {
    surface: string;
    reason: string;
    count: number;
}

/** The protocol-usage block of the history artifact. */
export interface ProtocolUsage {
    tools: ProtocolToolUsage[];
    resources: ProtocolResourceUsage[];
    byActor: ProtocolActorUsage[];
    a2a: ProtocolA2aUsage[];
    authDenied: ProtocolAuthDeniedUsage[];
}

/** Options for {@link protocolUsageSummary}; absent bounds are unbounded. */
export interface ProtocolUsageOptions {
    /** Inclusive lower bound on `system_events.occurred_at` (ISO). */
    since?: string;
    /** Inclusive upper bound on `system_events.occurred_at` (ISO). */
    until?: string;
}

/** The one row shape the fold needs; JSON is extracted in SQL so a malformed payload cannot throw. */
interface ProtocolEventRow {
    event_name: string;
    actor: string | null;
    tool: string | null;
    uri: string | null;
    member: string | null;
    surface: string | null;
    reason: string | null;
    outcome: string | null;
    duration_ms: number | null;
}

const PROTOCOL_EVENT_NAMES = [
    'mcp.tool.called',
    'mcp.tool.failed',
    'mcp.resource.read',
    'a2a.message.received',
    'a2a.task.cancelled',
    'auth.denied',
] as const;

/**
 * Aggregate protocol usage over a bounded window (1398 R1).
 *
 * A missing or empty plane reads as empty arrays (best-effort, like the rest of the trace path),
 * never a throw — the report renders "not available" rather than a fabricated zero (R4).
 */
export async function protocolUsageSummary(db: DbAdapter, spec: ProtocolUsageOptions = {}): Promise<ProtocolUsage> {
    const { clauses, params } = buildTimeRangeClauses(
        { since: spec.since ?? null, until: spec.until ?? null },
        { column: 'occurred_at', grain: 'instant' },
    );
    const where = clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '';
    const names = PROTOCOL_EVENT_NAMES.map((name) => `'${name}'`).join(', ');

    let rows: ProtocolEventRow[];
    try {
        rows = await db.queryAll<ProtocolEventRow>(
            `SELECT event_name,
                    actor,
                    json_extract(payload_json, '$.data.tool') AS tool,
                    json_extract(payload_json, '$.data.uri') AS uri,
                    json_extract(payload_json, '$.data.member') AS member,
                    json_extract(payload_json, '$.data.surface') AS surface,
                    json_extract(payload_json, '$.data.reason') AS reason,
                    json_extract(payload_json, '$.data.outcome') AS outcome,
                    json_extract(payload_json, '$.data.durationMs') AS duration_ms
             FROM system_events
             WHERE event_name IN (${names})
               ${where}`,
            ...params,
        );
    } catch {
        return { tools: [], resources: [], byActor: [], a2a: [], authDenied: [] };
    }

    const tools = new Map<string, { calls: number; failures: number; durations: number[]; unmeasured: number }>();
    const resources = new Map<string, ProtocolResourceUsage>();
    const actors = new Map<string, ProtocolActorUsage>();
    const a2a = new Map<string, ProtocolA2aUsage>();
    const denied = new Map<string, ProtocolAuthDeniedUsage>();

    const bucket = (key: string) => {
        let entry = tools.get(key);
        if (entry === undefined) {
            entry = { calls: 0, failures: 0, durations: [], unmeasured: 0 };
            tools.set(key, entry);
        }
        return entry;
    };
    const actorBucket = (actor: string) => {
        let entry = actors.get(actor);
        if (entry === undefined) {
            entry = { actor, calls: 0, failures: 0 };
            actors.set(actor, entry);
        }
        return entry;
    };
    const a2aBucket = (member: string) => {
        let entry = a2a.get(member);
        if (entry === undefined) {
            entry = { member, received: 0, replayed: 0, conflict: 0, cancelled: 0 };
            a2a.set(member, entry);
        }
        return entry;
    };

    for (const row of rows) {
        const duration = typeof row.duration_ms === 'number' ? row.duration_ms : null;
        switch (row.event_name) {
            case 'mcp.tool.called':
            case 'mcp.tool.failed': {
                const tool = row.tool ?? 'unknown';
                const entry = bucket(tool);
                const failed = row.event_name === 'mcp.tool.failed';
                if (failed) entry.failures += 1;
                else entry.calls += 1;
                if (duration === null) entry.unmeasured += 1;
                else entry.durations.push(duration);
                const actor = actorBucket(row.actor ?? 'unknown');
                if (failed) actor.failures += 1;
                else actor.calls += 1;
                break;
            }
            case 'mcp.resource.read': {
                const uri = row.uri ?? 'unknown';
                const entry = resources.get(uri) ?? { uri, reads: 0, failures: 0 };
                entry.reads += 1;
                if (row.outcome === 'error') entry.failures += 1;
                resources.set(uri, entry);
                break;
            }
            case 'a2a.message.received': {
                const entry = a2aBucket(row.member ?? 'unknown');
                if (row.outcome === 'replayed') entry.replayed += 1;
                else if (row.outcome === 'conflict') entry.conflict += 1;
                else entry.received += 1;
                break;
            }
            case 'a2a.task.cancelled':
                a2aBucket(row.member ?? 'unknown').cancelled += 1;
                break;
            case 'auth.denied': {
                const surface = row.surface ?? 'unknown';
                const reason = row.reason ?? 'unknown';
                const key = `${surface}\u0000${reason}`;
                const entry = denied.get(key) ?? { surface, reason, count: 0 };
                entry.count += 1;
                denied.set(key, entry);
                break;
            }
        }
    }

    return {
        tools: [...tools.entries()]
            .map(([tool, entry]) => {
                const total = entry.calls + entry.failures;
                return {
                    tool,
                    calls: entry.calls,
                    failures: entry.failures,
                    failureRate: total === 0 ? 0 : entry.failures / total,
                    p50Ms: nearestRank(entry.durations, 50),
                    p95Ms: nearestRank(entry.durations, 95),
                    durationUnmeasured: entry.unmeasured,
                };
            })
            .sort((a, b) => b.calls + b.failures - (a.calls + a.failures) || a.tool.localeCompare(b.tool)),
        resources: [...resources.values()].sort((a, b) => b.reads - a.reads || a.uri.localeCompare(b.uri)),
        byActor: [...actors.values()].sort(
            (a, b) => b.calls + b.failures - (a.calls + a.failures) || a.actor.localeCompare(b.actor),
        ),
        a2a: [...a2a.values()].sort((a, b) => a.member.localeCompare(b.member)),
        authDenied: [...denied.values()].sort(
            (a, b) => b.count - a.count || a.surface.localeCompare(b.surface) || a.reason.localeCompare(b.reason),
        ),
    };
}

/** Nearest-rank percentile over measured durations (R2); null when nothing was measured. */
function nearestRank(values: number[], percentile: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.ceil((percentile / 100) * sorted.length);
    return sorted[Math.min(Math.max(rank - 1, 0), sorted.length - 1)] ?? null;
}
