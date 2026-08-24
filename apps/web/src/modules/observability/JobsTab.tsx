import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Card, CardBody, Loading } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import { timeRangeSince } from './ObservabilityFilters';
import { formatDuration, historyUrl, parseHistoryResponse, type SystemEventRow } from './SystemEventsTab';
import type { ObservabilityTabProps } from './tabs';

interface JobStats {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
}

interface StatsResponse {
    stats: JobStats;
}

interface JobsState {
    stats: JobStats;
    events: SystemEventRow[];
}

const API_URL = resolveApiUrl();
const JOB_STATS_URL = `${API_URL}/jobs/stats`;
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

/**
 * Typed extraction of job-event fields from an event payload. Narrowing-only:
 * unknown / malformed fields degrade to `undefined`, never throw. Field names
 * are keyed to the ts-infra event payload shapes (`@gobing-ai/ts-infra/src/events.ts`).
 */
interface JobEventFields {
    /** Producer-stamped job correlator (queue.job.* payloads). */
    jobId?: string;
    /** Job type label (queue.job.* use `type`; scheduler uses `name`). */
    type?: string;
    /** Scheduler job name - surfaced separately so scheduler rows read correctly. */
    name?: string;
    /** 0-indexed attempt count on `queue.job.failed` / `queue.job.retrying`. */
    attempt?: number;
    /** Failure reason on `queue.job.failed`; optional error on `scheduler.job.executed`. */
    error?: string;
    /** Execution duration on `scheduler.job.executed`. */
    durationMs?: number;
}

/**
 * Derive a human job-state label from the event-name suffix. The suffix is the
 * load-bearing discriminator - `queue.job.enqueued` -> "pending",
 * `queue.job.completed` -> "completed", etc. Returns `null` for non-job events
 * (consumer lifecycle, stats) so callers can skip a state badge.
 */
function deriveJobState(eventName: string): string | null {
    const suffix = eventName.split('.').pop() ?? '';
    switch (suffix) {
        case 'enqueued':
            return 'pending';
        case 'retrying':
            return 'retrying';
        case 'completed':
            return 'completed';
        case 'failed':
            return 'failed';
        case 'executed':
            return 'executed';
        default:
            return null;
    }
}

function narrowJobFields(eventName: string, payload: Record<string, unknown> | null): JobEventFields {
    const fields: JobEventFields = {};
    if (!payload) return fields;
    const pickString = (key: string): string | undefined => {
        const v = payload[key];
        return typeof v === 'string' && v.length > 0 ? v : undefined;
    };
    const pickNumber = (key: string): number | undefined => {
        const v = payload[key];
        return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    };
    const suffix = eventName.split('.').pop() ?? '';
    fields.durationMs = pickNumber('durationMs');
    if (suffix === 'executed') {
        // scheduler.job.executed -> { name, durationMs, error? }
        fields.name = pickString('name');
        fields.error = pickString('error');
    } else {
        // queue.job.* -> { jobId, type, ... }
        fields.jobId = pickString('jobId');
        fields.type = pickString('type');
        if (suffix === 'failed' || suffix === 'retrying') {
            fields.attempt = pickNumber('attempt');
        }
        if (suffix === 'failed') {
            fields.error = pickString('error');
        }
    }
    return fields;
}

/** Badge variant for a job state label. */
function stateBadgeVariant(state: string): 'neutral' | 'info' | 'success' | 'warning' | 'error' {
    switch (state) {
        case 'completed':
        case 'executed':
            return 'success';
        case 'retrying':
            return 'warning';
        case 'failed':
            return 'error';
        default:
            return 'neutral';
    }
}

/**
 * Merge two newest-first event pages into one newest-first list. Both prefix
 * pages arrive sorted by `occurredAt` descending (server ORDER BY); standard
 * O(n) merge of two sorted lists. Ties broken by stable queue-before-scheduler
 * ordering so cross-prefix determinism holds in tests.
 */
function mergeByOccurredAtDesc(queue: SystemEventRow[], scheduler: SystemEventRow[]): SystemEventRow[] {
    const merged: SystemEventRow[] = [];
    let i = 0;
    let j = 0;
    while (i < queue.length && j < scheduler.length) {
        const q = queue[i];
        const s = scheduler[j];
        if (q && s && q.occurredAt >= s.occurredAt) {
            merged.push(q);
            i++;
        } else if (s) {
            merged.push(s);
            j++;
        } else if (q) {
            merged.push(q);
            i++;
        } else {
            break;
        }
    }
    while (i < queue.length) {
        const item = queue[i];
        if (item) merged.push(item);
        i++;
    }
    while (j < scheduler.length) {
        const item = scheduler[j];
        if (item) merged.push(item);
        j++;
    }
    return merged;
}

/**
 * A collapsed per-job thread: one or more `queue.job.*` events sharing a
 * `jobId`, ordered newest-first. The header surfaces the latest event's
 * state/attempt/error so an operator can read the job's story at a glance;
 * the disclosure lists the full event sequence (R3).
 */
interface JobThreadItem {
    kind: 'thread';
    jobId: string;
    events: SystemEventRow[];
}

/** A standalone event not grouped under a jobId (scheduler, consumer, stats). */
interface StandaloneItem {
    kind: 'standalone';
    row: SystemEventRow;
}

type JobListItem = JobThreadItem | StandaloneItem;

/**
 * Correlate `queue.job.*` events by `payload.jobId` into collapsed per-job
 * threads ordered by most-recent event; scheduler/consumer/stats rows stay
 * standalone. Events arrive newest-first from the merged page, so the first
 * sighting of a jobId fixes the thread's list position and subsequent events
 * for the same jobId append to that thread (R3).
 */
function groupJobEvents(events: SystemEventRow[]): JobListItem[] {
    const items: JobListItem[] = [];
    const threads = new Map<string, JobThreadItem>();
    for (const row of events) {
        const isQueueJob = row.eventName.startsWith('queue.job.');
        const jobId = isQueueJob ? narrowJobFields(row.eventName, row.payload).jobId : undefined;
        if (jobId !== undefined) {
            const existing = threads.get(jobId);
            if (existing) {
                existing.events.push(row);
            } else {
                const thread: JobThreadItem = { kind: 'thread', jobId, events: [row] };
                threads.set(jobId, thread);
                items.push(thread);
            }
        } else {
            items.push({ kind: 'standalone', row });
        }
    }
    return items;
}

/** Total queue-story duration from the oldest to newest correlated event. */
function jobThreadDurationMs(events: SystemEventRow[]): number | null {
    if (events.length < 2) return null;
    const newest = Date.parse(events[0]?.occurredAt ?? '');
    const oldest = Date.parse(events.at(-1)?.occurredAt ?? '');
    if (!Number.isFinite(newest) || !Number.isFinite(oldest)) return null;
    return Math.max(0, newest - oldest);
}

/** Jobs tab: queue status cards plus recent queue/scheduler events. */
export default function JobsTab({ timeRange = 'all' }: ObservabilityTabProps = {}) {
    const [state, setState] = useState<JobsState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fetchIdRef = useRef(0);

    useEffect(() => {
        const controller = new AbortController();
        const fetchId = ++fetchIdRef.current;
        setError(null);
        setState(null);
        (async () => {
            try {
                const since = timeRangeSince(timeRange);
                const queueRequestUrl = historyUrl({
                    prefix: 'queue',
                    limit: JOB_HISTORY_LIMIT,
                    ...(since ? { since } : {}),
                });
                const schedulerRequestUrl = historyUrl({
                    prefix: 'scheduler',
                    limit: JOB_HISTORY_LIMIT,
                    ...(since ? { since } : {}),
                });

                const [statsRes, queueRes, schedulerRes] = await Promise.all([
                    fetchWithTimeout(new Request(JOB_STATS_URL, { signal: controller.signal })),
                    fetchWithTimeout(
                        new Request(queueRequestUrl, {
                            signal: controller.signal,
                        }),
                    ),
                    fetchWithTimeout(
                        new Request(schedulerRequestUrl, {
                            signal: controller.signal,
                        }),
                    ),
                ]);
                if (!statsRes.ok) throw new Error(`job stats fetch failed: ${statsRes.status}`);
                if (!queueRes.ok) throw new Error(`queue history fetch failed: ${queueRes.status}`);
                if (!schedulerRes.ok) throw new Error(`scheduler history fetch failed: ${schedulerRes.status}`);
                const statsBody = parseStatsResponse((await statsRes.json()) as unknown);
                const queueBody = parseHistoryResponse((await queueRes.json()) as unknown);
                const schedulerBody = parseHistoryResponse((await schedulerRes.json()) as unknown);
                if (!statsBody) throw new Error('job stats response failed schema validation');
                if (!queueBody) throw new Error('queue history response failed schema validation');
                if (!schedulerBody) throw new Error('scheduler history response failed schema validation');
                const events = mergeByOccurredAtDesc(queueBody.events, schedulerBody.events);
                if (controller.signal.aborted || fetchId !== fetchIdRef.current) return;
                setState({ stats: statsBody.stats, events });
            } catch (err) {
                if (controller.signal.aborted || fetchId !== fetchIdRef.current) return;
                setError(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => controller.abort();
    }, [timeRange]);

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
        ['Pending', state.stats.pending, 'text-spur-text'],
        ['Processing', state.stats.processing, 'text-info'],
        ['Completed', state.stats.completed, 'text-success'],
        ['Failed', state.stats.failed, 'text-error'],
    ] as const;

    return (
        <div className="flex flex-col h-full overflow-hidden" data-jobs-tab>
            {/* Current Queue State (Live Aggregate) */}
            <div className="p-3 border-b border-spur-border bg-base-200 shrink-0 space-y-2">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">
                        Current Queue State
                    </span>
                    <span className="text-[11px] text-spur-text-muted">Live aggregate counters from queue engine</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {stats.map(([label, value, color]) => (
                        <Card key={label} variant="compact" className="bg-base-100 border border-spur-border shadow-xs">
                            <CardBody className="p-3 gap-1">
                                <span className="text-[10px] uppercase text-spur-text-muted font-semibold tracking-wider">
                                    {label}
                                </span>
                                <span className={`text-xl font-semibold tabular-nums font-mono ${color}`}>{value}</span>
                            </CardBody>
                        </Card>
                    ))}
                </div>
            </div>

            {/* Recent Job Events Section Header */}
            <div className="px-4 py-2.5 border-b border-spur-border bg-base-200 shrink-0 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">
                        Recent Job Events
                    </span>
                    <Badge variant="outline" size="xs" className="font-mono">
                        {timeRange === 'all' ? 'All time' : `Last ${timeRange}`}
                    </Badge>
                </div>
                <span className="text-xs text-spur-text-muted font-mono">{state.events.length} event(s)</span>
            </div>

            {/* Event List or Range-Aware Empty State */}
            {state.events.length === 0 ? (
                <div className="p-8 text-center text-sm text-spur-text-muted italic" data-jobs-empty>
                    No job events {timeRange === 'all' ? 'recorded yet' : `in the last ${timeRange}`} — queue and
                    scheduler have not processed events in this window.
                </div>
            ) : (
                <ul className="flex-1 overflow-y-auto p-3 space-y-2">
                    {groupJobEvents(state.events).map((item) =>
                        item.kind === 'thread' ? (
                            <JobThreadCard key={`thread-${item.jobId}`} item={item} />
                        ) : (
                            <JobEventCard key={item.row.id} row={item.row} />
                        ),
                    )}
                </ul>
            )}
        </div>
    );
}

/** One structured job-event row: scannable fields + collapsed raw payload. */
function JobEventCard({ row }: { row: SystemEventRow }) {
    const fields = useMemo(() => narrowJobFields(row.eventName, row.payload), [row.eventName, row.payload]);
    const jobState = deriveJobState(row.eventName);
    const isScheduler = row.eventName.startsWith('scheduler.');
    const identity = isScheduler ? (fields.name ?? 'scheduler') : (fields.jobId ?? 'job');
    const typeLabel = isScheduler ? 'scheduler' : (fields.type ?? 'unknown');
    const durationLabel = fields.durationMs !== undefined ? formatDuration(fields.durationMs) : null;

    return (
        <li>
            <Card variant="compact" className="bg-base-200 border border-spur-border">
                <CardBody className="p-3 gap-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        {jobState !== null && (
                            <Badge variant={stateBadgeVariant(jobState)} size="xs">
                                {jobState}
                            </Badge>
                        )}
                        <span className="text-xs font-mono text-spur-text font-semibold">{identity}</span>
                        <Badge variant="outline" size="xs">
                            {typeLabel}
                        </Badge>
                        <span className="text-[10px] text-spur-text-muted ml-auto font-mono">{row.occurredAt}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap text-[11px] text-spur-text-muted">
                        {fields.attempt !== undefined && (
                            <span>
                                attempt <span className="font-mono text-spur-text">{fields.attempt}</span>
                            </span>
                        )}
                        <span>
                            duration <span className="font-mono text-spur-text">{durationLabel ?? 'unavailable'}</span>
                        </span>
                        {fields.error !== undefined && (
                            <span className="text-error truncate max-w-md" title={fields.error}>
                                {fields.error}
                            </span>
                        )}
                        {!isScheduler && fields.type === undefined && <span className="italic">unknown job type</span>}
                    </div>
                    {row.payload !== null && Object.keys(row.payload).length > 0 && (
                        <details className="mt-1">
                            <summary className="text-[10px] text-spur-text-muted cursor-pointer select-none">
                                raw payload
                            </summary>
                            <pre className="text-[10px] text-spur-text-muted bg-base-300 rounded p-2 overflow-x-auto mt-1">
                                {JSON.stringify(row.payload, null, 2)}
                            </pre>
                        </details>
                    )}
                </CardBody>
            </Card>
        </li>
    );
}

/** A collapsed per-job thread: header shows the latest event's state/fields,
 * disclosure lists the full event sequence (R3). */
function JobThreadCard({ item }: { item: JobThreadItem }) {
    const latest = item.events[0];
    const fields = useMemo(() => (latest ? narrowJobFields(latest.eventName, latest.payload) : null), [latest]);
    if (!latest || !fields) return null;
    const jobState = deriveJobState(latest.eventName);
    const storyDuration = jobThreadDurationMs(item.events);
    const durationLabel =
        fields.durationMs !== undefined
            ? formatDuration(fields.durationMs)
            : storyDuration !== null
              ? formatDuration(storyDuration)
              : null;

    return (
        <li>
            <Card variant="compact" className="bg-base-200 border border-spur-border">
                <CardBody className="p-3 gap-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        {jobState !== null && (
                            <Badge variant={stateBadgeVariant(jobState)} size="xs">
                                {jobState}
                            </Badge>
                        )}
                        <span className="text-xs font-mono text-spur-text font-semibold">{item.jobId}</span>
                        {fields.type !== undefined && (
                            <Badge variant="outline" size="xs">
                                {fields.type}
                            </Badge>
                        )}
                        <span className="text-[10px] text-spur-text-muted ml-auto font-mono">{latest.occurredAt}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap text-[11px] text-spur-text-muted">
                        {fields.attempt !== undefined && (
                            <span>
                                attempt <span className="font-mono text-spur-text">{fields.attempt}</span>
                            </span>
                        )}
                        <span>
                            duration <span className="font-mono text-spur-text">{durationLabel ?? 'unavailable'}</span>
                        </span>
                        {fields.error !== undefined && (
                            <span className="text-error truncate max-w-md" title={fields.error}>
                                {fields.error}
                            </span>
                        )}
                        <span className="italic">{item.events.length} event(s)</span>
                    </div>
                    {item.events.length > 1 && (
                        <details className="mt-1">
                            <summary className="text-[10px] text-spur-text-muted cursor-pointer select-none">
                                event sequence ({item.events.length})
                            </summary>
                            <ol className="mt-1 space-y-1">
                                {item.events.map((evt) => {
                                    const evtFields = narrowJobFields(evt.eventName, evt.payload);
                                    return (
                                        <li
                                            key={evt.id}
                                            className="text-[10px] text-spur-text-muted flex items-center gap-2"
                                        >
                                            <span className="font-mono">{evt.occurredAt}</span>
                                            <span>{evt.eventName}</span>
                                            {evtFields.attempt !== undefined && (
                                                <span>attempt {evtFields.attempt}</span>
                                            )}
                                        </li>
                                    );
                                })}
                            </ol>
                        </details>
                    )}
                    {latest.payload !== null && Object.keys(latest.payload).length > 0 && (
                        <details className="mt-1">
                            <summary className="text-[10px] text-spur-text-muted cursor-pointer select-none">
                                raw payload
                            </summary>
                            <pre className="text-[10px] text-spur-text-muted bg-base-300 rounded p-2 overflow-x-auto mt-1">
                                {JSON.stringify(latest.payload, null, 2)}
                            </pre>
                        </details>
                    )}
                </CardBody>
            </Card>
        </li>
    );
}
