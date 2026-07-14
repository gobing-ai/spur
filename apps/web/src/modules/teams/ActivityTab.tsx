import { useCallback, useEffect, useState } from 'react';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';

/** One row on the Teams activity timeline (0254 R7). */
interface ActivityRow {
    id: string;
    eventName: string;
    occurredAt: string;
    actor: string | null;
}

const historyUrl = () => `${resolveApiUrl()}/events/history?limit=100`;
const sseUrl = () => `${resolveApiUrl()}/events/planning`;

/** Event-name prefixes that belong on the Teams activity timeline (0254 R7):
 * agent lifecycle, inter-agent messages, team + supervisor process events. */
const TEAM_EVENT_PREFIXES = ['agent.', 'message.', 'team.', 'supervisor.'];

function isTeamEvent(name: string): boolean {
    return TEAM_EVENT_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** Runtime-narrow one raw event into an `ActivityRow`, or `null` when the shape
 * is wrong or the event is out of scope. Network input is untrusted. */
function toRow(value: unknown): ActivityRow | null {
    if (value === null || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    if (typeof obj.eventName !== 'string' || typeof obj.occurredAt !== 'string') return null;
    if (!isTeamEvent(obj.eventName)) return null;
    return {
        id: typeof obj.id === 'string' ? obj.id : `${obj.eventName}-${obj.occurredAt}`,
        eventName: obj.eventName,
        occurredAt: obj.occurredAt,
        actor: typeof obj.actor === 'string' ? obj.actor : null,
    };
}

function parseHistory(value: unknown): ActivityRow[] | null {
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
                if (row) setRows((prev) => [row, ...(prev ?? [])]);
            } catch {
                // Malformed frame — drop silently.
            }
        };
        return () => es.close();
    }, []);

    if (error)
        return (
            <div className="p-4 text-sm text-error" role="alert">
                Failed to load activity: {error}
            </div>
        );
    if (rows === null) return <div className="p-4 text-sm text-spur-text-muted">Loading activity…</div>;

    return (
        <div className="flex flex-col h-full overflow-y-auto" data-activity-tab>
            {rows.length === 0 ? (
                <div className="p-4 text-sm text-spur-text-muted italic">No team activity yet.</div>
            ) : (
                <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-base-200">
                        <tr className="text-left text-spur-text-muted">
                            <th className="px-3 py-1 font-medium">Time</th>
                            <th className="px-3 py-1 font-medium">Event</th>
                            <th className="px-3 py-1 font-medium">Actor</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.id} className="border-t border-spur-border" data-activity-row={row.eventName}>
                                <td className="px-3 py-1 font-mono text-spur-text-muted">{row.occurredAt}</td>
                                <td className="px-3 py-1 text-spur-text">{row.eventName}</td>
                                <td className="px-3 py-1 text-spur-text-muted">{row.actor ?? 'system'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
