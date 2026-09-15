import { resolveApiUrl } from '../../lib/rpc-client';

/** One row on an activity timeline (0254 R7, 0269 R9). */
export interface ActivityRow {
    id: string;
    eventName: string;
    occurredAt: string;
    actor: string | null;
    /** Identity resolved from payload when present; fallback to actor parse. */
    teamId?: string;
    memberLabel?: string;
    agentType?: string;
}

/** Cap for the history fetch, matching the history endpoint's `limit=100`. */
export const MAX_ACTIVITY_ROWS = 100;

/** History endpoint for the activity timeline, capped at {@link MAX_ACTIVITY_ROWS}. */
export const historyUrl = () => `${resolveApiUrl()}/events/history?limit=${MAX_ACTIVITY_ROWS}`;

/** Event-name prefixes that belong on the Board activity timeline (0254 R7; the
 * retired `team.` prefix was dropped by 0860 R2): agent lifecycle, inter-agent
 * messages, task assignment, supervisor process events. */
const COORDINATION_EVENT_PREFIXES = ['agent.', 'message.', 'task.', 'supervisor.', 'process.'];

function isCoordinationEvent(name: string): boolean {
    return COORDINATION_EVENT_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** Runtime-narrow one raw event into an `ActivityRow`, or `null` when the shape
 * is wrong or the event is out of scope. Network input is untrusted.
 *
 * Identity resolution (0269 R9/P4): payload `memberLabel` / `agentType` / `agentId`
 * win; `agentId` doubles as memberLabel when memberLabel is absent. Rows persisted
 * before 0860 still carry a `teamId`, so the reader tolerates it (R2: no data
 * migration, readers stay generic).
 */
export function toRow(value: unknown): ActivityRow | null {
    if (value === null || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    if (typeof obj.eventName !== 'string' || typeof obj.occurredAt !== 'string') return null;
    if (!isCoordinationEvent(obj.eventName)) return null;
    const payload =
        obj.payload !== null && typeof obj.payload === 'object' ? (obj.payload as Record<string, unknown>) : null;
    const teamId =
        payload && typeof payload.teamId === 'string' && payload.teamId.length > 0 ? payload.teamId : undefined;
    const agentType =
        payload && typeof payload.agentType === 'string' && payload.agentType.length > 0
            ? payload.agentType
            : undefined;
    const memberLabel =
        payload && typeof payload.memberLabel === 'string' && payload.memberLabel.length > 0
            ? payload.memberLabel
            : payload && typeof payload.agentId === 'string' && payload.agentId.length > 0
              ? payload.agentId
              : undefined;
    const actor =
        typeof obj.actor === 'string' && obj.actor.length > 0
            ? obj.actor
            : payload && typeof payload.agentId === 'string' && payload.agentId.length > 0
              ? payload.agentId
              : null;
    return {
        id: typeof obj.id === 'string' ? obj.id : `${obj.eventName}-${obj.occurredAt}`,
        eventName: obj.eventName,
        occurredAt: obj.occurredAt,
        actor,
        ...(teamId ? { teamId } : {}),
        ...(memberLabel ? { memberLabel } : {}),
        ...(agentType ? { agentType } : {}),
    };
}

/** Narrow a `{ events: [...] }` history response into rows, dropping malformed entries;
 * `null` when the envelope itself is the wrong shape (caller decides how loud to be). */
export function parseHistory(value: unknown): ActivityRow[] | null {
    if (value === null || typeof value !== 'object' || !('events' in value)) return null;
    const events = (value as { events: unknown }).events;
    if (!Array.isArray(events)) return null;
    const rows: ActivityRow[] = [];
    for (const raw of events) {
        const row = toRow(raw);
        if (row) rows.push(row);
    }
    return rows;
}
