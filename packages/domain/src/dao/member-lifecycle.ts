import type { DbAdapter } from '@gobing-ai/ts-db';
import { SystemEventDao } from './system-event-dao';

// ── Fleet member lifecycle state (feature G73 / task 1080) ──

/**
 * Lifecycle states a fleet member reports from its host hooks (G73 R1).
 * `blocked` means the member is waiting on a human (a permission prompt), which
 * makes it unavailable to the dispatch strategy even while its process is alive.
 */
export type MemberLifecycleState = 'working' | 'idle' | 'blocked';

/** Runtime list of the three lifecycle states (mirrors {@link MemberLifecycleState}). */
export const MEMBER_LIFECYCLE_STATES: readonly MemberLifecycleState[] = ['working', 'idle', 'blocked'];

/**
 * Cataloged ledger event carrying a member's current lifecycle state (G73 R2).
 * The newest accepted row per actor IS the member's current state, so no
 * separate state table exists; the Board renders the row through the
 * `agent.lifecycle.changed` presenter (`packages/app/src/services/event-names.ts`).
 */
export const AGENT_LIFECYCLE_EVENT = 'agent.lifecycle.changed';

/** A member's current lifecycle state as exposed by the fleet snapshot. */
export interface MemberLifecycleObservation {
    state: MemberLifecycleState;
    /** Hook-supplied monotonic report sequence (wall-clock nanoseconds); strictly increasing. */
    seq: number;
    /** When the accepting row was written (ISO). */
    at: string;
}

/** Input for {@link recordLifecycle}. */
export interface RecordLifecycleInput {
    state: MemberLifecycleState;
    seq: number;
}

/** Outcome of {@link recordLifecycle}; `accepted: false` means a stale/duplicate report was dropped. */
export interface RecordLifecycleResult {
    accepted: boolean;
    /** The member's state after the call — the new row when accepted, the existing one when dropped. */
    observation?: MemberLifecycleObservation;
}

/** Parse one lifecycle payload; malformed rows are skipped by the reader. */
function parseObservation(payloadJson: string | null): MemberLifecycleObservation | null {
    if (payloadJson === null) return null;
    let payload: { state?: unknown; seq?: unknown };
    try {
        payload = JSON.parse(payloadJson) as { state?: unknown; seq?: unknown };
    } catch {
        return null;
    }
    if (typeof payload.state !== 'string' || !MEMBER_LIFECYCLE_STATES.includes(payload.state as MemberLifecycleState)) {
        return null;
    }
    if (typeof payload.seq !== 'number' || !Number.isFinite(payload.seq)) return null;
    return { state: payload.state as MemberLifecycleState, seq: payload.seq, at: '' };
}

/**
 * Record the member's lifecycle state as a ledger row (actor = member id), after
 * the R1 monotonic guard: a report whose `seq` is not strictly greater than the
 * last accepted one is dropped (`accepted: false`) and writes nothing. The guard
 * lives here, not at the caller, so the CLI path and the service path cannot
 * disagree about what "stale" means.
 */
export async function recordLifecycle(
    db: DbAdapter,
    actor: string,
    input: RecordLifecycleInput,
): Promise<RecordLifecycleResult> {
    const current = (await readLifecycle(db, [actor])).get(actor);
    if (current !== undefined && input.seq <= current.seq) {
        return { accepted: false, observation: current };
    }
    const at = new Date().toISOString();
    await new SystemEventDao(db).insert({
        id: crypto.randomUUID(),
        event_name: AGENT_LIFECYCLE_EVENT,
        occurred_at: at,
        actor,
        payload_json: JSON.stringify({ member: actor, state: input.state, seq: input.seq }),
    });
    return { accepted: true, observation: { state: input.state, seq: input.seq, at } };
}

/**
 * Current lifecycle state per member actor — the {@link AGENT_LIFECYCLE_EVENT} row
 * with the highest payload `seq` wins; equal seqs fall back to the newest row
 * (ledger `sequence`, then timestamp, then id). A malformed payload is skipped rather than rendered as a state, and a
 * missing table (unmigrated db) reads as empty so observability degrades
 * instead of failing a dispatch tick.
 */
export async function readLifecycle(
    db: DbAdapter,
    actors: readonly string[],
): Promise<Map<string, MemberLifecycleObservation>> {
    const out = new Map<string, MemberLifecycleObservation>();
    if (actors.length === 0) return out;
    let rows: Array<Pick<SystemEventRowShape, 'actor' | 'payload_json' | 'occurred_at'>>;
    try {
        rows = await db.queryAll(
            `SELECT actor, payload_json, occurred_at
            FROM system_events
            WHERE event_name = ? AND actor IN (${actors.map(() => '?').join(', ')})
            ORDER BY COALESCE(sequence, -1) DESC, occurred_at DESC, id DESC`,
            AGENT_LIFECYCLE_EVENT,
            ...actors,
        );
    } catch (error) {
        if (error instanceof Error && error.message.includes('no such table: system_events')) return out;
        throw error;
    }
    // Highest seq wins, not newest row: detached hook processes can interleave the
    // writer's read-then-insert so a lower seq lands last. Ties keep the newest row.
    for (const row of rows) {
        if (row.actor === null) continue;
        const observation = parseObservation(row.payload_json);
        if (observation === null) continue;
        const kept = out.get(row.actor);
        if (kept === undefined || observation.seq > kept.seq)
            out.set(row.actor, { ...observation, at: row.occurred_at });
    }
    return out;
}

/** Structural subset of the system_events row this reader selects. */
interface SystemEventRowShape {
    actor: string | null;
    payload_json: string | null;
    occurred_at: string;
}
