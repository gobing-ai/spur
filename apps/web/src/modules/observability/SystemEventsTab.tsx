import { useEffect, useState } from 'react';
import { Badge, Card, CardBody, Loading } from '@/ui';
import { resolveApiUrl } from '../../lib/rpc-client';

/** Wire shape of a single system event row from the history endpoint. */
export interface SystemEventRow {
    id: string;
    eventName: string;
    occurredAt: string;
    actor: string | null;
    payload: Record<string, unknown> | null;
}

/** Wire shape of the `/api/events/history` JSON envelope. */
interface HistoryResponse {
    events: SystemEventRow[];
    count: number;
}

/** Wire shape of one SSE envelope pushed by the planning stream. */
interface SseEnvelope {
    eventName: string;
    occurredAt: string;
    actor: string | null;
    payload: Record<string, unknown> | null;
}

const HISTORY_URL = `${resolveApiUrl()}/events/history`;
const SSE_URL = `${resolveApiUrl()}/events/planning`;
const HISTORY_LIMIT = 100;

/**
 * Runtime-narrow an unknown network payload into a `HistoryResponse`, or
 * return `null` when the shape is wrong. Network input is untrusted — a
 * single bad row from the server must not crash the tab.
 */
function parseHistoryResponse(value: unknown): HistoryResponse | null {
    if (value === null || typeof value !== 'object') return null;
    if (!('events' in value) || !('count' in value)) return null;
    const rawEvents = (value as { events: unknown }).events;
    if (!Array.isArray(rawEvents)) return null;
    const count = (value as { count: unknown }).count;
    if (typeof count !== 'number') return null;
    const events: SystemEventRow[] = [];
    for (const raw of rawEvents) {
        const row = parseHistoryRow(raw);
        if (!row) return null;
        events.push(row);
    }
    return { events, count };
}

/** Runtime-narrow one history row. */
function parseHistoryRow(value: unknown): SystemEventRow | null {
    if (value === null || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    if (typeof obj.id !== 'string') return null;
    if (typeof obj.eventName !== 'string') return null;
    if (typeof obj.occurredAt !== 'string') return null;
    const actor = obj.actor;
    if (actor !== null && typeof actor !== 'string') return null;
    const payload = obj.payload;
    if (payload === null)
        return { id: obj.id, eventName: obj.eventName, occurredAt: obj.occurredAt, actor, payload: null };
    if (typeof payload !== 'object') return null;
    return {
        id: obj.id,
        eventName: obj.eventName,
        occurredAt: obj.occurredAt,
        actor,
        payload: payload as Record<string, unknown>,
    };
}

/**
 * Runtime-narrow an unknown SSE frame into an {@link SseEnvelope}, or return
 * `null` when the frame is malformed. Network input is untrusted — the server
 * may push a keepalive comment (`: keepalive\n\n`) that we silently drop at
 * the EventSource layer, but a hand-rolled frame must still be checked
 * before being read into the row shape.
 */
function parseSseEnvelope(value: unknown): SseEnvelope | null {
    if (value === null || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    if (typeof obj.eventName !== 'string' || obj.eventName.length === 0) return null;
    if (typeof obj.occurredAt !== 'string') return null;
    const actor = obj.actor;
    if (actor !== null && typeof actor !== 'string') return null;
    const payload = obj.payload;
    if (payload === null) return { eventName: obj.eventName, occurredAt: obj.occurredAt, actor, payload: null };
    if (typeof payload !== 'object') return null;
    return {
        eventName: obj.eventName,
        occurredAt: obj.occurredAt,
        actor,
        payload: payload as Record<string, unknown>,
    };
}

/**
 * System Events tab (task 0189 R5).
 *
 * Initial fetch loads the most recent `HISTORY_LIMIT` rows from
 * `/api/events/history` newest-first. After mount, an `EventSource` against
 * `/api/events/planning` appends each fired event to the top of the list so
 * the operator sees live activity without a refresh.
 *
 * The cap-and-prune contract is server-side: this tab never assumes the
 * ledger will fit in memory — the render set is bounded by `HISTORY_LIMIT`
 * (newest-first), and any SSE envelope whose `eventName === 'connected'`
 * (the stream's initial signal) is dropped to avoid a duplicate first row.
 */
export default function SystemEventsTab() {
    const [events, setEvents] = useState<SystemEventRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Initial history fetch.
    useEffect(() => {
        const controller = new AbortController();
        (async () => {
            try {
                const res = await fetch(`${HISTORY_URL}?limit=${HISTORY_LIMIT}`, { signal: controller.signal });
                if (!res.ok) throw new Error(`history fetch failed: ${res.status}`);
                const raw: unknown = await res.json();
                const body = parseHistoryResponse(raw);
                if (!body) throw new Error('history response failed schema validation');
                setEvents(body.events);
            } catch (err) {
                if (controller.signal.aborted) return;
                setError(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => controller.abort();
    }, []);

    // Live tail via SSE — appends each new event to the top of the list.
    useEffect(() => {
        if (typeof EventSource === 'undefined') return;
        const es = new EventSource(SSE_URL);
        es.onmessage = (msg) => {
            try {
                const raw: unknown = JSON.parse(msg.data);
                const envelope = parseSseEnvelope(raw);
                if (!envelope) return; // malformed frame — drop silently
                if (envelope.eventName === 'connected') return;
                const row: SystemEventRow = {
                    id: `live-${envelope.occurredAt}-${envelope.eventName}`,
                    eventName: envelope.eventName,
                    occurredAt: envelope.occurredAt,
                    actor: envelope.actor,
                    payload: envelope.payload,
                };
                setEvents((prev) => (prev ? [row, ...prev].slice(0, HISTORY_LIMIT) : [row]));
            } catch {
                // Drop malformed frames silently — a bad row must not break the live tail.
            }
        };
        return () => es.close();
    }, []);

    if (error) {
        return (
            <div className="p-4 text-sm text-error" role="alert">
                Failed to load event history: {error}
            </div>
        );
    }
    if (events === null) {
        return (
            <div className="flex items-center justify-center h-32 text-spur-text-muted text-sm">
                <Loading size="sm" /> Loading event history…
            </div>
        );
    }
    if (events.length === 0) {
        return (
            <div className="p-4 text-sm text-spur-text-muted italic">
                No system events yet. New events from the planning bus will appear here in real time.
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="px-4 py-2 border-b border-spur-border bg-base-200 shrink-0">
                <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">System Events</span>
                <span className="ml-2 text-xs text-spur-text-muted">newest first · live tail</span>
            </div>
            <ul className="flex-1 overflow-y-auto p-2 space-y-2" data-system-events-tab>
                {events.map((evt) => (
                    <li key={evt.id}>
                        <Card variant="compact" className="bg-base-200 border border-spur-border">
                            <CardBody className="p-3 gap-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <Badge variant="outline" size="xs">
                                        {evt.eventName}
                                    </Badge>
                                    {evt.actor && <span className="text-xs text-spur-text-muted">by {evt.actor}</span>}
                                    <span
                                        className="text-[10px] text-spur-text-muted ml-auto font-mono"
                                        title={evt.occurredAt}
                                    >
                                        {evt.occurredAt}
                                    </span>
                                </div>
                                {evt.payload !== null && Object.keys(evt.payload).length > 0 && (
                                    <pre className="text-[11px] text-spur-text-muted bg-base-300 rounded p-2 overflow-x-auto">
                                        {JSON.stringify(evt.payload, null, 2)}
                                    </pre>
                                )}
                            </CardBody>
                        </Card>
                    </li>
                ))}
            </ul>
        </div>
    );
}
