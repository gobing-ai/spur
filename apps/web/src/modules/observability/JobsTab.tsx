import { useEffect, useState } from 'react';
import { Badge, Card, CardBody, Loading } from '@/ui';
import { resolveApiUrl } from '../../lib/rpc-client';
import type { SystemEventRow } from './SystemEventsTab';

interface JobStats {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
}

interface StatsResponse {
    stats: JobStats;
}

interface HistoryResponse {
    events: SystemEventRow[];
    count: number;
}

interface JobsState {
    stats: JobStats;
    events: SystemEventRow[];
}

const API_URL = resolveApiUrl();
const JOB_STATS_URL = `${API_URL}/jobs/stats`;
const EVENTS_HISTORY_URL = `${API_URL}/events/history`;
const JOB_HISTORY_LIMIT = 50;

function parseStatsResponse(value: unknown): StatsResponse | null {
    if (value === null || typeof value !== 'object') return null;
    const stats = (value as { stats?: unknown }).stats;
    if (stats === null || typeof stats !== 'object') return null;
    const obj = stats as Record<string, unknown>;
    if (
        typeof obj.pending !== 'number' ||
        typeof obj.processing !== 'number' ||
        typeof obj.completed !== 'number' ||
        typeof obj.failed !== 'number'
    ) {
        return null;
    }
    return {
        stats: {
            pending: obj.pending,
            processing: obj.processing,
            completed: obj.completed,
            failed: obj.failed,
        },
    };
}

function parseHistoryResponse(value: unknown): HistoryResponse | null {
    if (value === null || typeof value !== 'object') return null;
    const rawEvents = (value as { events?: unknown }).events;
    const count = (value as { count?: unknown }).count;
    if (!Array.isArray(rawEvents) || typeof count !== 'number') return null;
    const events: SystemEventRow[] = [];
    for (const raw of rawEvents) {
        const row = parseEventRow(raw);
        if (!row) return null;
        events.push(row);
    }
    return { events, count };
}

function parseEventRow(value: unknown): SystemEventRow | null {
    if (value === null || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    if (typeof obj.id !== 'string') return null;
    if (typeof obj.eventName !== 'string') return null;
    if (typeof obj.occurredAt !== 'string') return null;
    const actor = obj.actor;
    if (actor !== null && typeof actor !== 'string') return null;
    const payload = obj.payload;
    if (payload === null) {
        return { id: obj.id, eventName: obj.eventName, occurredAt: obj.occurredAt, actor, payload: null };
    }
    if (typeof payload !== 'object') return null;
    return {
        id: obj.id,
        eventName: obj.eventName,
        occurredAt: obj.occurredAt,
        actor,
        payload: payload as Record<string, unknown>,
    };
}

/** Jobs tab: queue status cards plus recent queue/scheduler events. */
export default function JobsTab() {
    const [state, setState] = useState<JobsState | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        (async () => {
            try {
                const [statsRes, eventsRes] = await Promise.all([
                    fetch(JOB_STATS_URL, { signal: controller.signal }),
                    fetch(`${EVENTS_HISTORY_URL}?limit=${JOB_HISTORY_LIMIT}`, { signal: controller.signal }),
                ]);
                if (!statsRes.ok) throw new Error(`job stats fetch failed: ${statsRes.status}`);
                if (!eventsRes.ok) throw new Error(`job history fetch failed: ${eventsRes.status}`);
                const statsBody = parseStatsResponse((await statsRes.json()) as unknown);
                const historyBody = parseHistoryResponse((await eventsRes.json()) as unknown);
                if (!statsBody) throw new Error('job stats response failed schema validation');
                if (!historyBody) throw new Error('job history response failed schema validation');
                setState({
                    stats: statsBody.stats,
                    events: historyBody.events.filter(
                        (evt) => evt.eventName.startsWith('queue.') || evt.eventName.startsWith('scheduler.'),
                    ),
                });
            } catch (err) {
                if (controller.signal.aborted) return;
                setError(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => controller.abort();
    }, []);

    if (error) {
        return (
            <div className="p-4 text-sm text-error" role="alert">
                Failed to load jobs: {error}
            </div>
        );
    }
    if (state === null) {
        return (
            <div className="flex items-center justify-center h-32 text-spur-text-muted text-sm">
                <Loading size="sm" /> Loading jobs…
            </div>
        );
    }

    const stats = [
        ['Pending', state.stats.pending],
        ['Processing', state.stats.processing],
        ['Completed', state.stats.completed],
        ['Failed', state.stats.failed],
    ] as const;

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3 border-b border-spur-border bg-base-200 shrink-0">
                {stats.map(([label, value]) => (
                    <Card key={label} variant="compact" className="bg-base-100 border border-spur-border">
                        <CardBody className="p-3 gap-1">
                            <span className="text-[10px] uppercase text-spur-text-muted font-semibold">{label}</span>
                            <span className="text-xl font-semibold text-spur-text tabular-nums">{value}</span>
                        </CardBody>
                    </Card>
                ))}
            </div>
            <div className="px-4 py-2 border-b border-spur-border bg-base-200 shrink-0">
                <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">Recent Job Events</span>
                <span className="ml-2 text-xs text-spur-text-muted">{state.events.length} event(s)</span>
            </div>
            {state.events.length === 0 ? (
                <div className="p-4 text-sm text-spur-text-muted italic">No job events yet.</div>
            ) : (
                <ul className="flex-1 overflow-y-auto p-2 space-y-2" data-jobs-tab>
                    {state.events.map((evt) => (
                        <li key={evt.id}>
                            <Card variant="compact" className="bg-base-200 border border-spur-border">
                                <CardBody className="p-3 gap-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Badge variant="outline" size="xs">
                                            {evt.eventName}
                                        </Badge>
                                        <span className="text-[10px] text-spur-text-muted ml-auto font-mono">
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
            )}
        </div>
    );
}
