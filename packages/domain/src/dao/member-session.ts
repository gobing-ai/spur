import type { DbAdapter } from '@gobing-ai/ts-db';
import { SystemEventDao } from './system-event-dao';

// ── Fleet member session state (feature G66 / task 0897) ──

/**
 * How a fleet member's coding-agent session is pinned (G66 design §6):
 * `persistent` — one long-lived stdin process; `resume` — each drain re-opens
 * the previous session id; `one-shot` — a fresh session per drain.
 */
export type MemberSessionMode = 'persistent' | 'resume' | 'one-shot';

/** Runtime list of the three session modes (mirrors {@link MemberSessionMode}). */
export const MEMBER_SESSION_MODES: readonly MemberSessionMode[] = ['persistent', 'resume', 'one-shot'];

/** Current member session state as exposed by the fleet snapshot / process entries. */
export interface MemberSessionObservation {
    mode: MemberSessionMode;
    /** Resume id (`resume` mode only) — persistent members carry no id (the live process IS the session). */
    id?: string;
}

/** Ledger event carrying the member's current session state (G66 observability). */
export const MEMBER_SESSION_EVENT = 'fleet.member-session';
/** Ledger event naming a deliberate session reset — 0896 R4; a later reset row clears the resume id. */
export const MEMBER_SESSION_RESET_EVENT = 'fleet.member-session-reset';

const SESSION_EVENT_NAMES: readonly string[] = [MEMBER_SESSION_EVENT, MEMBER_SESSION_RESET_EVENT];

/**
 * Record the member's current session state as a ledger row (actor = member
 * instanceId). Written by the agent loop on mode resolution and resume-id
 * capture; deliberate resets keep writing their own reason-named reset rows.
 */
export async function recordMemberSession(
    db: DbAdapter,
    actor: string,
    session: MemberSessionObservation,
): Promise<void> {
    await new SystemEventDao(db).insert({
        id: crypto.randomUUID(),
        event_name: MEMBER_SESSION_EVENT,
        occurred_at: new Date().toISOString(),
        actor,
        payload_json: JSON.stringify(session),
    });
}

/** Parse one session-state payload; a reset row clears the resume id. Invalid rows are skipped by the reader. */
function parseObservation(eventName: string, payloadJson: string | null): MemberSessionObservation | null {
    if (payloadJson === null) return null;
    let payload: { mode?: unknown; id?: unknown };
    try {
        payload = JSON.parse(payloadJson) as { mode?: unknown; id?: unknown };
    } catch {
        return null;
    }
    if (typeof payload.mode !== 'string' || !MEMBER_SESSION_MODES.includes(payload.mode as MemberSessionMode)) {
        return null;
    }
    if (eventName === MEMBER_SESSION_RESET_EVENT) {
        return { mode: payload.mode as MemberSessionMode };
    }
    return {
        mode: payload.mode as MemberSessionMode,
        ...(typeof payload.id === 'string' && payload.id.length > 0 ? { id: payload.id } : {}),
    };
}

/**
 * Latest session state per member instanceId, read off the ledger: the newest
 * row among {@link MEMBER_SESSION_EVENT} / {@link MEMBER_SESSION_RESET_EVENT}
 * for the actor wins, and a reset row reports the mode with no resume id.
 * A ledger with no session history yields no entry — a member that never ran
 * carries no session. Missing table (unmigrated db) reads as empty.
 */
export async function readMemberSessions(
    db: DbAdapter,
    actors: readonly string[],
): Promise<Map<string, MemberSessionObservation>> {
    const out = new Map<string, MemberSessionObservation>();
    if (actors.length === 0) return out;
    const placeholders = actors.map(() => '?').join(', ');
    let rows: Array<
        Pick<SystemEventRowShape, 'actor' | 'event_name' | 'payload_json' | 'sequence' | 'occurred_at' | 'id'>
    >;
    try {
        rows = await db.queryAll(
            `SELECT actor, event_name, payload_json, sequence, occurred_at, id
            FROM system_events
            WHERE event_name IN (${SESSION_EVENT_NAMES.map(() => '?').join(', ')}) AND actor IN (${placeholders})
            ORDER BY COALESCE(sequence, -1) DESC, occurred_at DESC, id DESC`,
            ...SESSION_EVENT_NAMES,
            ...actors,
        );
    } catch (error) {
        if (error instanceof Error && error.message.includes('no such table: system_events')) return out;
        throw error;
    }
    for (const row of rows) {
        if (row.actor === null || out.has(row.actor)) continue;
        const observation = parseObservation(row.event_name, row.payload_json);
        if (observation !== null) out.set(row.actor, observation);
    }
    return out;
}

/** Structural subset of the system_events row this reader selects. */
interface SystemEventRowShape {
    actor: string | null;
    event_name: string;
    payload_json: string | null;
    sequence: number | null;
    occurred_at: string;
    id: string;
}
