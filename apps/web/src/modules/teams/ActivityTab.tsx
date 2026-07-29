import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import { type TeamGroup, useTeamsData } from './useTeamsData';

/** One row on the Teams activity timeline (0254 R7, 0269 R9). */
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

/** Roster index for actor → team/member/agent fallback (0269 R9). */
interface RosterIdentity {
    teamId: string;
    memberLabel: string;
    agentType: string;
}

/** Build agentId → identity from the live teams feed for Activity fallback joins. */
export function buildRosterIndex(teams: TeamGroup[]): Map<string, RosterIdentity> {
    const index = new Map<string, RosterIdentity>();
    for (const team of teams) {
        for (const member of team.members) {
            index.set(member.id, {
                teamId: team.teamId,
                memberLabel: member.id,
                agentType: member.type,
            });
        }
    }
    return index;
}

/**
 * Fill missing team/member/agent fields from the roster. Lookup keys: memberLabel
 * first (often agentId from process payloads), then actor. Payload values win.
 */
export function enrichRowFromRoster(row: ActivityRow, roster: Map<string, RosterIdentity>): ActivityRow {
    if (row.teamId && row.memberLabel && row.agentType) return row;
    const key = row.memberLabel ?? row.actor;
    if (!key) return row;
    const hit = roster.get(key);
    if (!hit) return row;
    return {
        ...row,
        teamId: row.teamId ?? hit.teamId,
        memberLabel: row.memberLabel ?? hit.memberLabel,
        agentType: row.agentType ?? hit.agentType,
    };
}

/** Cap for history fetch and live SSE buffer (matches history `limit=100`). */
export const MAX_ACTIVITY_ROWS = 100;

/** Prepend a live row and trim to {@link MAX_ACTIVITY_ROWS} (newest-first). */
export function prependActivityRow(prev: ActivityRow[] | null, row: ActivityRow): ActivityRow[] {
    const next = [row, ...(prev ?? [])];
    if (next.length > MAX_ACTIVITY_ROWS) next.length = MAX_ACTIVITY_ROWS;
    return next;
}

export const historyUrl = () => `${resolveApiUrl()}/events/history?limit=${MAX_ACTIVITY_ROWS}`;
export const sseUrl = () => `${resolveApiUrl()}/events/planning`;

/** Event-name prefixes that belong on the Teams activity timeline (0254 R7):
 * agent lifecycle, inter-agent messages, team + supervisor process events. */
const TEAM_EVENT_PREFIXES = ['agent.', 'message.', 'team.', 'supervisor.', 'process.'];

function isTeamEvent(name: string): boolean {
    return TEAM_EVENT_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** Runtime-narrow one raw event into an `ActivityRow`, or `null` when the shape
 * is wrong or the event is out of scope. Network input is untrusted.
 *
 * Identity resolution (0269 R9/P4): payload `teamId` / `memberLabel` / `agentType`
 * / `agentId` win; `agentId` doubles as memberLabel when memberLabel is absent;
 * roster enrich fills remaining gaps from actor/agentId.
 */
export function toRow(value: unknown): ActivityRow | null {
    if (value === null || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    if (typeof obj.eventName !== 'string' || typeof obj.occurredAt !== 'string') return null;
    if (!isTeamEvent(obj.eventName)) return null;
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

/**
 * Activity tab — agent-lifecycle + message-event timeline (0254 R7).
 *
 * Adapts the SystemEventsTab fetch+SSE pattern: loads `/api/events/history`,
 * filters to team/message/agent/supervisor events, and prepends live frames from
 * the board's EventSource (`/api/events/planning`). System-wide telemetry stays
 * on the Observability board — this timeline is scoped to team activity only.
 */
export default function ActivityTab() {
    const [rows, setRows] = useState<ActivityRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const { teams } = useTeamsData();
    const roster = useMemo(() => buildRosterIndex(teams), [teams]);

    const load = useCallback(async () => {
        try {
            const res = await fetchWithTimeout(new Request(historyUrl()));
            if (!res.ok) throw new Error(`events fetch failed: ${res.status}`);
            const parsed = parseHistory(await res.json());
            if (!parsed) throw new Error('events response failed schema validation');
            setRows(parsed);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    // Live tail: prepend matching team/message events as they arrive.
    useEffect(() => {
        if (typeof EventSource === 'undefined') return;
        const es = new EventSource(sseUrl());
        es.onmessage = (frame) => {
            try {
                const row = toRow(JSON.parse(frame.data));
                if (row) setRows((prev) => prependActivityRow(prev, row));
            } catch {
                // Malformed frame — drop silently.
            }
        };
        return () => es.close();
    }, []);

    const displayRows = useMemo(
        () => (rows === null ? null : rows.map((row) => enrichRowFromRoster(row, roster))),
        [rows, roster],
    );

    if (error)
        return (
            <div className="p-4 text-sm text-error" role="alert">
                Failed to load activity: {error}
            </div>
        );
    if (displayRows === null) return <div className="p-4 text-sm text-spur-text-muted">Loading activity…</div>;

    return (
        <div className="flex flex-col h-full overflow-y-auto" data-activity-tab>
            {displayRows.length === 0 ? (
                <div className="p-4 text-sm text-spur-text-muted italic">No team activity yet.</div>
            ) : (
                <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-base-200">
                        <tr className="text-left text-spur-text-muted">
                            <th className="px-3 py-1 font-medium">Time</th>
                            <th className="px-3 py-1 font-medium">Event</th>
                            <th className="px-3 py-1 font-medium">Team</th>
                            <th className="px-3 py-1 font-medium">Member</th>
                            <th className="px-3 py-1 font-medium">Agent</th>
                            <th className="px-3 py-1 font-medium">Actor</th>
                        </tr>
                    </thead>
                    <tbody>
                        {displayRows.map((row) => (
                            <tr key={row.id} className="border-t border-spur-border" data-activity-row={row.eventName}>
                                <td className="px-3 py-1 font-mono text-spur-text-muted">{row.occurredAt}</td>
                                <td className="px-3 py-1 text-spur-text">{row.eventName}</td>
                                <td className="px-3 py-1 font-mono text-spur-text-muted">{row.teamId ?? '—'}</td>
                                <td className="px-3 py-1 text-spur-text-muted">{row.memberLabel ?? '—'}</td>
                                <td className="px-3 py-1 text-spur-text-muted">{row.agentType ?? '—'}</td>
                                <td className="px-3 py-1 text-spur-text-muted">{row.actor ?? 'system'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
