import type { QueueJobRow } from '@gobing-ai/spur-contracts';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button } from '@/ui';
import { fetchWithTimeout } from '../../lib/rpc-client';
import { formatDuration, historyUrl, parseHistoryResponse, type SystemEventRow } from './SystemEventsTab';
import type { ObservabilityNavIntent } from './tabs';

export interface JobDetailDrawerProps {
    job: QueueJobRow | null;
    onClose: () => void;
    onNavigate?: (intent: ObservabilityNavIntent) => void;
}

interface TimelineItem {
    id: string;
    eventName: string;
    occurredAt: string;
    derived?: boolean;
    error?: string;
    attempt?: number;
}

function extractJobId(row: SystemEventRow): string | undefined {
    if (!row.payload) return undefined;
    if (typeof row.payload.jobId === 'string') return row.payload.jobId;
    const ctx = row.payload.context as Record<string, unknown> | undefined;
    const correlation = ctx?.correlation as Record<string, unknown> | undefined;
    if (typeof correlation?.jobId === 'string') return correlation.jobId;
    return undefined;
}

function statusBadgeVariant(status: string): 'neutral' | 'info' | 'success' | 'warning' | 'error' {
    switch (status) {
        case 'completed':
            return 'success';
        case 'processing':
            return 'info';
        case 'failed':
            return 'error';
        default:
            return 'neutral';
    }
}

export default function JobDetailDrawer({ job, onClose, onNavigate }: JobDetailDrawerProps) {
    const [timeline, setTimeline] = useState<TimelineItem[]>([]);
    const [recordedEventsCount, setRecordedEventsCount] = useState<number | null>(null);
    const [loadingTimeline, setLoadingTimeline] = useState(false);
    const fetchIdRef = useRef(0);

    useEffect(() => {
        if (!job) {
            setTimeline([]);
            setRecordedEventsCount(null);
            return;
        }

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);

        const controller = new AbortController();
        const fetchId = ++fetchIdRef.current;
        setLoadingTimeline(true);

        (async () => {
            try {
                const url = historyUrl({ prefix: 'queue', since: job.queuedAt, limit: 200 });
                const res = await fetchWithTimeout(new Request(url, { signal: controller.signal }));
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = parseHistoryResponse((await res.json()) as unknown);
                if (controller.signal.aborted || fetchId !== fetchIdRef.current) return;

                const matchingEvents = (data?.events ?? []).filter((ev) => extractJobId(ev) === job.id);
                setRecordedEventsCount(matchingEvents.length);
                const items: TimelineItem[] = matchingEvents.map((ev) => {
                    const payload = ev.payload as Record<string, unknown> | null;
                    return {
                        id: ev.id,
                        eventName: ev.eventName,
                        occurredAt: ev.occurredAt,
                        error: typeof payload?.error === 'string' ? payload.error : undefined,
                        attempt: typeof payload?.attempt === 'number' ? payload.attempt : undefined,
                    };
                });

                // Synthesize started step from job.startedAt if present (Q&A D2)
                if (job.startedAt) {
                    items.push({
                        id: `synth-started-${job.id}`,
                        eventName: 'queue.job.started',
                        occurredAt: job.startedAt,
                        derived: true,
                    });
                }

                // Chronological sort
                items.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

                setTimeline(items);
            } catch {
                if (controller.signal.aborted || fetchId !== fetchIdRef.current) return;
                setRecordedEventsCount(0);
                // An empty chain on fetch failure degrades gracefully without error banner
                const fallbackItems: TimelineItem[] = [];
                if (job.startedAt) {
                    fallbackItems.push({
                        id: `synth-started-${job.id}`,
                        eventName: 'queue.job.started',
                        occurredAt: job.startedAt,
                        derived: true,
                    });
                }
                setTimeline(fallbackItems);
            } finally {
                if (!controller.signal.aborted && fetchId === fetchIdRef.current) {
                    setLoadingTimeline(false);
                }
            }
        })();

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            controller.abort();
        };
    }, [job, onClose]);

    if (!job) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs"
            onClick={onClose}
            onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
            }}
            role="dialog"
            aria-modal="true"
            aria-label={`Job details for ${job.id}`}
            data-testid="job-detail-drawer"
        >
            <div
                className="w-full max-w-xl h-full bg-base-100 border-l border-base-content/10 shadow-2xl flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                role="document"
            >
                {/* Header */}
                <div className="px-5 py-4 border-b border-base-content/10 flex items-center justify-between bg-base-200/50">
                    <div className="flex items-center gap-2">
                        <Badge variant={statusBadgeVariant(job.status)} size="sm">
                            {job.status}
                        </Badge>
                        <span className="font-mono text-sm font-semibold text-base-content truncate max-w-xs">
                            {job.id}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {onNavigate && (
                            <Button
                                variant="outline"
                                size="xs"
                                data-testid="navigate-system-events-btn"
                                onClick={() => onNavigate({ tab: 'system-events', runId: job.id })}
                            >
                                View in System Events
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={onClose}
                            aria-label="Close drawer"
                            data-testid="close-job-drawer"
                        >
                            ✕
                        </Button>
                    </div>
                </div>

                {/* Content Body */}
                <div className="p-5 flex-1 overflow-y-auto space-y-5">
                    {/* Metadata Grid */}
                    <div className="grid grid-cols-2 gap-3 bg-base-200/40 p-3 rounded-lg border border-base-content/10 text-xs font-mono">
                        <div>
                            <span className="text-base-content/50 block text-[10px] uppercase">Type</span>
                            <span className="font-semibold text-base-content">{job.type}</span>
                        </div>
                        <div>
                            <span className="text-base-content/50 block text-[10px] uppercase">Attempts</span>
                            <span className="text-base-content">
                                {job.attempts} / {job.maxRetries}
                            </span>
                        </div>
                        <div>
                            <span className="text-base-content/50 block text-[10px] uppercase">Queued At</span>
                            <span className="text-base-content">{new Date(job.queuedAt).toLocaleString()}</span>
                        </div>
                        <div>
                            <span className="text-base-content/50 block text-[10px] uppercase">Started At</span>
                            <span className="text-base-content">
                                {job.startedAt ? new Date(job.startedAt).toLocaleString() : '—'}
                            </span>
                        </div>
                        <div>
                            <span className="text-base-content/50 block text-[10px] uppercase">Ended At</span>
                            <span className="text-base-content">
                                {job.endedAt ? new Date(job.endedAt).toLocaleString() : '—'}
                            </span>
                        </div>
                        <div>
                            <span className="text-base-content/50 block text-[10px] uppercase">Duration</span>
                            <span className="text-base-content">
                                {job.durationMs !== null ? formatDuration(job.durationMs) : '—'}
                            </span>
                        </div>
                    </div>

                    {/* Last Error (if present) */}
                    {job.lastError && (
                        <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-xs font-mono whitespace-pre-wrap break-words">
                            <span className="font-bold block mb-1">Last Error:</span>
                            {job.lastError}
                        </div>
                    )}

                    {/* Formatted Payload */}
                    <div className="space-y-1.5">
                        <span className="text-xs font-semibold uppercase tracking-wider text-base-content/60">
                            Payload
                        </span>
                        <div className="bg-base-200 p-3 rounded-lg border border-base-content/10 font-mono text-xs overflow-x-auto max-h-48 text-base-content/90">
                            {job.payload ? (
                                <pre className="whitespace-pre-wrap">{JSON.stringify(job.payload, null, 2)}</pre>
                            ) : (
                                <span className="text-base-content/50 italic">payload unavailable</span>
                            )}
                        </div>
                    </div>

                    {/* Chronological Lifecycle Timeline */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wider text-base-content/60">
                                Lifecycle Timeline
                            </span>
                            {loadingTimeline && <span className="text-[10px] text-base-content/50">Loading…</span>}
                        </div>

                        {recordedEventsCount === 0 && !loadingTimeline && (
                            <div
                                className="p-4 rounded-lg border border-base-content/10 bg-base-200/40 text-xs text-base-content/60 italic"
                                data-testid="empty-lifecycle-timeline"
                            >
                                No lifecycle events recorded. Queue lifecycle events are diagnostic-tier — set{' '}
                                <code className="font-mono text-base-content">SPUR_DIAGNOSTIC_EVENTS=1</code> to capture
                                them.
                            </div>
                        )}

                        {timeline.length > 0 && (
                            <div className="space-y-2 font-mono text-xs" data-testid="lifecycle-timeline-list">
                                {timeline.map((item) => (
                                    <div
                                        key={item.id}
                                        className="p-2.5 rounded-lg border border-base-content/10 bg-base-200/60 flex items-center justify-between gap-2"
                                    >
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="font-semibold text-base-content">{item.eventName}</span>
                                            {item.derived && (
                                                <Badge size="xs" variant="outline">
                                                    derived
                                                </Badge>
                                            )}
                                            {item.attempt !== undefined && (
                                                <Badge size="xs" variant="neutral">
                                                    attempt {item.attempt}
                                                </Badge>
                                            )}
                                            {item.error && (
                                                <span className="text-error truncate max-w-xs">{item.error}</span>
                                            )}
                                        </div>
                                        <span className="text-[11px] text-base-content/50 shrink-0">
                                            {new Date(item.occurredAt).toLocaleTimeString()}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
