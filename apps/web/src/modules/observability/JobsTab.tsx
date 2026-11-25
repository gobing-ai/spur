import type {
    QueueJobListResponse,
    QueueJobRow,
    QueueJobStatusCounts,
    SchedulerScheduleRow,
    SchedulerSchedulesResponse,
} from '@gobing-ai/spur-contracts';
import { type FC, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Checkbox, Loading } from '@/ui';
import { EmptyState } from '../../components/module-kit/EmptyState';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import JobDetailDrawer from './JobDetailDrawer';
import { RetentionBadge, timeRangeSince } from './ObservabilityFilters';
import type { ObservabilityTabProps } from './tabs';

export type JobStatusFilter = 'all' | 'failed' | 'running' | 'completed';

/**
 * Format a duration in milliseconds with 3 decimal places and thousands grouping,
 * or an em dash when absent/non-finite.
 */
export function formatDurationMs(durationMs: number | null | undefined): string {
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) {
        return '—';
    }
    return durationMs.toLocaleString('en-US', {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
    });
}

function readNonEmptyString(payload: Record<string, unknown> | null, key: string): string | null {
    if (!payload) return null;
    const raw = payload[key];
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * Derive a human-readable job label from payload metadata when available,
 * falling back to `job.type`.
 */
export function resolveJobName(job: QueueJobRow): string {
    if (job.type === 'scheduler.custom') {
        return readNonEmptyString(job.payload, 'name') ?? job.type;
    }
    if (job.type === 'task-action') {
        const wbs = readNonEmptyString(job.payload, 'wbs');
        const action = readNonEmptyString(job.payload, 'action');
        if (wbs && action) return `task:${wbs} · ${action}`;
        if (wbs) return `task:${wbs}`;
        if (action) return `${job.type} · ${action}`;
        return job.type;
    }
    if (job.type === 'feature-action') {
        const featureId = readNonEmptyString(job.payload, 'featureId');
        const action = readNonEmptyString(job.payload, 'action');
        if (featureId && action) return `feature:${featureId} · ${action}`;
        if (featureId) return `feature:${featureId}`;
        if (action) return `${job.type} · ${action}`;
        return job.type;
    }
    return readNonEmptyString(job.payload, 'name') ?? job.type;
}

/**
 * Extract the command or source summary for a queue job row.
 */
export function resolveJobCommand(job: QueueJobRow): string | null {
    const command = readNonEmptyString(job.payload, 'command');
    if (command) return command;
    const source = readNonEmptyString(job.payload, 'source');
    if (source) return `source: ${source}`;
    return null;
}

function formatJobTimestamp(iso: string | null): string {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    const now = new Date();
    const isSameDay =
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();
    if (isSameDay) {
        return date.toLocaleTimeString();
    }
    return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
    });
}

/**
 * Return whether a queue job remains visible under the current schedule exclusions.
 */
export function jobMatchesScheduleFilter(
    job: QueueJobRow,
    excluded: { excludeTypes: readonly string[]; excludeCustomNames: readonly string[] },
): boolean {
    if (excluded.excludeTypes.includes(job.type)) {
        return false;
    }
    if (
        job.type === 'scheduler.custom' &&
        job.payload !== null &&
        typeof job.payload.name === 'string' &&
        excluded.excludeCustomNames.includes(job.payload.name)
    ) {
        return false;
    }
    return true;
}

/**
 * Filter queue jobs against unchecked schedules (defense-in-depth alongside server SQL filtering).
 */
export function filterJobsBySchedules(
    jobs: readonly QueueJobRow[],
    excluded: { excludeTypes: readonly string[]; excludeCustomNames: readonly string[] },
): QueueJobRow[] {
    if (excluded.excludeTypes.length === 0 && excluded.excludeCustomNames.length === 0) {
        return [...jobs];
    }
    const excludeTypeSet = new Set(excluded.excludeTypes);
    const excludeCustomSet = new Set(excluded.excludeCustomNames);
    return jobs.filter((job) => {
        if (excludeTypeSet.has(job.type)) return false;
        if (
            job.type === 'scheduler.custom' &&
            job.payload !== null &&
            typeof job.payload.name === 'string' &&
            excludeCustomSet.has(job.payload.name)
        ) {
            return false;
        }
        return true;
    });
}

/**
 * Default schedule filter selection: built-in schedules start unchecked (ignored in
 * Queue Jobs); all other schedules start checked.
 */
export function defaultSelectedSchedules(schedules: readonly SchedulerScheduleRow[]): Set<string> {
    const selected = new Set<string>();
    for (const s of schedules) {
        if (s.source !== 'builtin') {
            selected.add(s.name);
        }
    }
    return selected;
}

/**
 * Partition unchecked schedules into built-in `queue_jobs.type` exclusions and
 * configured `scheduler.custom` payload name exclusions.
 */
export function computeExcludedSchedules(
    schedules: readonly SchedulerScheduleRow[] | null,
    selected: ReadonlySet<string>,
): { excludeTypes: string[]; excludeCustomNames: string[] } {
    if (!schedules || schedules.length === 0) {
        return { excludeTypes: [], excludeCustomNames: [] };
    }
    const excludeTypes: string[] = [];
    const excludeCustomNames: string[] = [];
    for (const s of schedules) {
        if (selected.has(s.name)) continue;
        if (s.source === 'builtin') {
            excludeTypes.push(s.name);
        } else {
            excludeCustomNames.push(s.name);
        }
    }
    excludeTypes.sort();
    excludeCustomNames.sort();
    return { excludeTypes, excludeCustomNames };
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    if (a.size !== b.size) return false;
    for (const item of a) {
        if (!b.has(item)) return false;
    }
    return true;
}

function mapFilterToStatus(filter: JobStatusFilter): string | undefined {
    switch (filter) {
        case 'failed':
            return 'failed';
        case 'running':
            return 'processing';
        case 'completed':
            return 'completed';
        default:
            return undefined;
    }
}

function jobStatusBadgeVariant(status: string): 'neutral' | 'info' | 'success' | 'warning' | 'error' {
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

interface ActiveSchedulesCardProps {
    schedules: SchedulerScheduleRow[] | null;
    loading: boolean;
    error: string | null;
    selectedSchedules: ReadonlySet<string>;
    onToggleSchedule: (name: string) => void;
    onSelectAll: () => void;
    onResetDefaults: () => void;
}

const ActiveSchedulesCard: FC<ActiveSchedulesCardProps> = ({
    schedules,
    loading,
    error,
    selectedSchedules,
    onToggleSchedule,
    onSelectAll,
    onResetDefaults,
}) => {
    const defaultSelection = useMemo(
        () => (schedules ? defaultSelectedSchedules(schedules) : new Set<string>()),
        [schedules],
    );
    const selectedCount = useMemo(
        () => (schedules ? schedules.filter((s) => selectedSchedules.has(s.name)).length : 0),
        [schedules, selectedSchedules],
    );
    const hasSchedules = schedules !== null && schedules.length > 0;
    const allSelected = hasSchedules && selectedCount === schedules.length;
    const isDefaultSelection = hasSchedules && setsEqual(selectedSchedules, defaultSelection);

    return (
        <div
            className="p-4 rounded-xl border border-base-content/10 bg-base-200/80 shadow-xs space-y-3"
            data-testid="active-schedules-card"
        >
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                        Active Schedules
                    </span>
                    {schedules && (
                        <Badge size="xs" variant="outline">
                            {hasSchedules ? `${selectedCount}/${schedules.length}` : 0}
                        </Badge>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[11px] text-base-content/50">Filter Queue Jobs</span>
                    {hasSchedules && !allSelected && (
                        <Button variant="ghost" size="xs" onClick={onSelectAll} data-testid="schedules-select-all">
                            Select all
                        </Button>
                    )}
                    {hasSchedules && !isDefaultSelection && (
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={onResetDefaults}
                            data-testid="schedules-reset-defaults"
                        >
                            Defaults
                        </Button>
                    )}
                </div>
            </div>

            {loading ? (
                <div className="text-xs text-base-content/50 py-2">Loading schedules…</div>
            ) : error ? (
                <div className="text-xs text-error/80 py-1" data-testid="schedules-error">
                    Schedules unavailable: {error}
                </div>
            ) : !schedules || schedules.length === 0 ? (
                <div className="text-xs text-base-content/50 py-2 italic">No active schedules registered.</div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 font-mono text-xs">
                    {schedules.map((s) => {
                        const isChecked = selectedSchedules.has(s.name);
                        const checkboxId = `schedule-filter-${s.name}`;
                        return (
                            <label
                                key={s.name}
                                htmlFor={checkboxId}
                                className={`p-2.5 rounded-lg border flex flex-col gap-1.5 cursor-pointer select-none transition-colors focus-within:ring-2 focus-within:ring-primary/50 ${
                                    isChecked
                                        ? 'border-primary/40 bg-base-100 hover:border-primary/60'
                                        : 'border-base-content/10 bg-base-100/40 opacity-55 hover:opacity-80 hover:border-base-content/25'
                                }`}
                                data-testid={`schedule-item-${s.name}`}
                                data-checked={isChecked ? 'true' : 'false'}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <Checkbox
                                            id={checkboxId}
                                            size="xs"
                                            variant="primary"
                                            checked={isChecked}
                                            onChange={() => onToggleSchedule(s.name)}
                                            aria-label={`Include ${s.name} jobs`}
                                            data-testid={checkboxId}
                                        />
                                        <span className="font-semibold text-base-content truncate">{s.name}</span>
                                    </div>
                                    <Badge size="xs" variant={s.source === 'builtin' ? 'neutral' : 'info'}>
                                        {s.source}
                                    </Badge>
                                </div>
                                <div className="flex items-center justify-between text-[11px] text-base-content/60">
                                    <span>{s.cadence}</span>
                                    <span className="text-base-content/40">{s.cron}</span>
                                </div>
                                <div className="flex items-center justify-between text-[10px] text-base-content/50 border-t border-base-content/5 pt-1 mt-0.5">
                                    <span>
                                        {s.nextFireAt === null
                                            ? 'next run: cron (unknown)'
                                            : `next: ${new Date(s.nextFireAt).toLocaleTimeString()}`}
                                    </span>
                                    <span>{s.lastStatus === 'none' ? 'never run' : s.lastStatus}</span>
                                </div>
                            </label>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default function JobsTab({ timeRange, onNavigate }: ObservabilityTabProps) {
    const [statusFilter, setStatusFilter] = useState<JobStatusFilter>('all');
    const [schedules, setSchedules] = useState<SchedulerScheduleRow[] | null>(null);
    const [schedulesLoading, setSchedulesLoading] = useState(true);
    const [schedulesError, setSchedulesError] = useState<string | null>(null);
    const [selectedSchedules, setSelectedSchedules] = useState<Set<string>>(() => new Set());
    const [jobs, setJobs] = useState<QueueJobRow[]>([]);
    const [counts, setCounts] = useState<QueueJobStatusCounts>({
        all: 0,
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
    });
    const [hasMore, setHasMore] = useState(false);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
    const [selectedJob, setSelectedJob] = useState<QueueJobRow | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        (async () => {
            try {
                const res = await fetchWithTimeout(
                    new Request(`${resolveApiUrl()}/jobs/schedules`, { signal: controller.signal }),
                );
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = (await res.json()) as SchedulerSchedulesResponse;
                if (controller.signal.aborted) return;
                setSchedules(data.schedules);
                setSelectedSchedules(defaultSelectedSchedules(data.schedules));
            } catch (err) {
                if (controller.signal.aborted) return;
                setSchedulesError(err instanceof Error ? err.message : String(err));
            } finally {
                if (!controller.signal.aborted) {
                    setSchedulesLoading(false);
                }
            }
        })();
        return () => controller.abort();
    }, []);

    const excluded = useMemo(
        () => computeExcludedSchedules(schedules, selectedSchedules),
        [schedules, selectedSchedules],
    );
    const excludeKey = `${excluded.excludeTypes.join('\0')}|${excluded.excludeCustomNames.join('\0')}`;
    const excludedCount = excluded.excludeTypes.length + excluded.excludeCustomNames.length;

    const fetchIdRef = useRef(0);
    const prevQueryRef = useRef({ timeRange, statusFilter, excludeKey });

    useEffect(() => {
        if (schedulesLoading) return;

        const controller = new AbortController();
        const fetchId = ++fetchIdRef.current;
        setLoading(true);
        setError(null);

        (async () => {
            try {
                const queryChanged =
                    prevQueryRef.current.timeRange !== timeRange ||
                    prevQueryRef.current.statusFilter !== statusFilter ||
                    prevQueryRef.current.excludeKey !== excludeKey;
                if (queryChanged) {
                    prevQueryRef.current = { timeRange, statusFilter, excludeKey };
                }
                const effectiveOffset = queryChanged ? 0 : offset;
                if (queryChanged && offset !== 0) {
                    setOffset(0);
                }

                const since = timeRangeSince(timeRange);
                const params = new URLSearchParams();
                const statusParam = mapFilterToStatus(statusFilter);
                if (statusParam) params.set('status', statusParam);
                if (since) params.set('since', since);
                for (const typeName of excluded.excludeTypes) {
                    params.append('excludeType', typeName);
                }
                for (const customName of excluded.excludeCustomNames) {
                    params.append('excludeCustomName', customName);
                }
                params.set('limit', '100');
                params.set('offset', String(effectiveOffset));

                const res = await fetchWithTimeout(
                    new Request(`${resolveApiUrl()}/jobs?${params.toString()}`, { signal: controller.signal }),
                );
                if (!res.ok) {
                    const text = await res.text();
                    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
                }

                const data = (await res.json()) as QueueJobListResponse;
                if (controller.signal.aborted || fetchId !== fetchIdRef.current) return;

                if (effectiveOffset === 0) {
                    setJobs(data.jobs);
                } else {
                    setJobs((prev) => [...prev, ...data.jobs]);
                }
                setCounts(data.countsByStatus);
                setHasMore(data.hasMore);
                setLoading(false);
            } catch (err) {
                if (controller.signal.aborted || fetchId !== fetchIdRef.current) return;
                setError(err instanceof Error ? err.message : String(err));
                setLoading(false);
            }
        })();

        return () => controller.abort();
    }, [timeRange, statusFilter, offset, schedulesLoading, excludeKey, excluded]);

    const handleToggleSchedule = (name: string) => {
        setSelectedSchedules((prev) => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
    };

    const handleSelectAll = () => {
        if (!schedules) return;
        setSelectedSchedules(new Set(schedules.map((s) => s.name)));
    };

    const handleResetDefaults = () => {
        if (!schedules) return;
        setSelectedSchedules(defaultSelectedSchedules(schedules));
    };

    const toggleErrorExpanded = (jobId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpandedErrors((prev) => {
            const next = new Set(prev);
            if (next.has(jobId)) next.delete(jobId);
            else next.add(jobId);
            return next;
        });
    };

    const visibleJobs = useMemo(() => filterJobsBySchedules(jobs, excluded), [jobs, excluded]);
    const displayCounts = useMemo<QueueJobStatusCounts>(() => {
        if (visibleJobs.length === jobs.length) {
            return counts;
        }
        let hiddenAll = 0;
        let hiddenPending = 0;
        let hiddenProcessing = 0;
        let hiddenCompleted = 0;
        let hiddenFailed = 0;
        for (const job of jobs) {
            if (jobMatchesScheduleFilter(job, excluded)) continue;
            hiddenAll += 1;
            if (job.status === 'pending') hiddenPending += 1;
            else if (job.status === 'processing') hiddenProcessing += 1;
            else if (job.status === 'completed') hiddenCompleted += 1;
            else if (job.status === 'failed') hiddenFailed += 1;
        }
        return {
            all: Math.max(0, counts.all - hiddenAll),
            pending: Math.max(0, counts.pending - hiddenPending),
            processing: Math.max(0, counts.processing - hiddenProcessing),
            completed: Math.max(0, counts.completed - hiddenCompleted),
            failed: Math.max(0, counts.failed - hiddenFailed),
        };
    }, [jobs, visibleJobs.length, counts, excluded]);

    const chips: { id: JobStatusFilter; label: string; count: number }[] = [
        { id: 'all', label: 'All', count: displayCounts.all },
        { id: 'failed', label: 'Failed', count: displayCounts.failed },
        { id: 'running', label: 'Running', count: displayCounts.processing },
        { id: 'completed', label: 'Completed', count: displayCounts.completed },
    ];

    return (
        <div className="flex flex-col gap-4" data-jobs-tab data-testid="observability-jobs-tab">
            {/* Controls Bar: Status Filter Chips & Retention Notice */}
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-1.5" data-testid="job-status-chips">
                    {chips.map((chip) => {
                        const active = statusFilter === chip.id;
                        return (
                            <button
                                key={chip.id}
                                type="button"
                                onClick={() => setStatusFilter(chip.id)}
                                data-testid={`status-chip-${chip.id}`}
                                className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full transition-colors cursor-pointer ${
                                    active
                                        ? chip.id === 'failed'
                                            ? 'bg-error text-error-content'
                                            : 'bg-neutral text-neutral-content'
                                        : 'bg-base-100 text-base-content/70 hover:bg-base-200 border border-base-content/10'
                                }`}
                            >
                                <span>{chip.label}</span>
                                <span
                                    className={`px-1.5 py-0.2 text-[10px] rounded-full ${
                                        active ? 'bg-base-100/20' : 'bg-base-200 text-base-content/70'
                                    }`}
                                >
                                    {chip.count.toLocaleString()}
                                </span>
                            </button>
                        );
                    })}
                </div>
                <RetentionBadge />
            </div>

            {/* Failure Warning Banner */}
            {displayCounts.failed > 0 && (
                <div
                    className="p-3 rounded-xl bg-error/10 border border-error/20 flex items-center justify-between text-xs text-error font-medium"
                    data-testid="jobs-failure-banner"
                >
                    <span>
                        ⚠️ {displayCounts.failed} {displayCounts.failed === 1 ? 'job' : 'jobs'} failed in this window
                    </span>
                    <button
                        type="button"
                        className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-error text-error hover:bg-error hover:text-error-content transition-colors cursor-pointer"
                        data-testid="filter-to-failed-btn"
                        onClick={() => setStatusFilter('failed')}
                    >
                        Filter to Failed
                    </button>
                </div>
            )}

            {/* Active Schedules Card */}
            <ActiveSchedulesCard
                schedules={schedules}
                loading={schedulesLoading}
                error={schedulesError}
                selectedSchedules={selectedSchedules}
                onToggleSchedule={handleToggleSchedule}
                onSelectAll={handleSelectAll}
                onResetDefaults={handleResetDefaults}
            />

            {/* Jobs Table */}
            <div className="rounded-xl border border-base-content/10 bg-base-200/50 shadow-xs overflow-hidden flex flex-col">
                <div className="px-4 py-3 border-b border-base-content/10 bg-base-200 flex items-center justify-between flex-wrap gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                        Queue Jobs
                    </span>
                    <span className="text-xs text-base-content/50 font-mono">
                        Showing {visibleJobs.length} of {displayCounts.all} job(s)
                        {excludedCount > 0 ? ` · ${excludedCount} schedule(s) hidden` : ''}
                    </span>
                </div>

                {error ? (
                    <div className="p-4 text-xs text-error" role="alert" data-testid="jobs-table-error">
                        Failed to load jobs: {error}
                    </div>
                ) : loading && jobs.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-base-content/50 text-sm">
                        <Loading size="sm" /> Loading jobs…
                    </div>
                ) : visibleJobs.length === 0 ? (
                    <EmptyState testId="jobs-empty-state">
                        {excludedCount > 0
                            ? 'No jobs found in this time range with the current schedule filters.'
                            : 'No jobs found in this time range.'}
                    </EmptyState>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="table table-xs w-full font-mono text-xs" data-testid="queue-jobs-table">
                            <thead>
                                <tr className="border-b border-base-content/10 text-base-content/60">
                                    <th>Status</th>
                                    <th>Job</th>
                                    <th>Command</th>
                                    <th className="text-right">Started At</th>
                                    <th className="text-right">Ended At</th>
                                    <th className="text-right">Duration (ms)</th>
                                    <th className="text-right">Attempts</th>
                                    <th>Error</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleJobs.map((job) => {
                                    const isExpanded = expandedErrors.has(job.id);
                                    const jobName = resolveJobName(job);
                                    const jobCommand = resolveJobCommand(job);
                                    const startedTooltip = job.startedAt
                                        ? `Started: ${new Date(job.startedAt).toLocaleString()} · Enqueued: ${new Date(job.queuedAt).toLocaleString()}`
                                        : `Not started · Enqueued: ${new Date(job.queuedAt).toLocaleString()}`;
                                    return (
                                        <tr
                                            key={job.id}
                                            className="hover:bg-base-300/40 cursor-pointer transition-colors"
                                            onClick={() => setSelectedJob(job)}
                                            data-testid={`job-row-${job.id}`}
                                        >
                                            <td>
                                                <Badge size="xs" variant={jobStatusBadgeVariant(job.status)}>
                                                    {job.status}
                                                </Badge>
                                            </td>
                                            <td
                                                className="font-semibold text-base-content whitespace-nowrap"
                                                title={jobName !== job.type ? `${jobName} (${job.type})` : job.type}
                                            >
                                                {jobName}
                                            </td>
                                            <td
                                                className="max-w-xs truncate text-base-content/70"
                                                title={jobCommand ?? undefined}
                                            >
                                                {jobCommand ?? <span className="text-base-content/30">—</span>}
                                            </td>
                                            <td
                                                className="text-right tabular-nums whitespace-nowrap text-base-content/60"
                                                title={startedTooltip}
                                            >
                                                {formatJobTimestamp(job.startedAt)}
                                            </td>
                                            <td
                                                className="text-right tabular-nums whitespace-nowrap text-base-content/60"
                                                title={job.endedAt ? new Date(job.endedAt).toLocaleString() : undefined}
                                            >
                                                {formatJobTimestamp(job.endedAt)}
                                            </td>
                                            <td className="text-right tabular-nums whitespace-nowrap text-base-content/80">
                                                {formatDurationMs(job.durationMs)}
                                            </td>
                                            <td className="text-right tabular-nums whitespace-nowrap text-base-content/60">
                                                {job.attempts} / {job.maxRetries}
                                            </td>
                                            <td className="max-w-xs">
                                                {job.lastError ? (
                                                    <div className="flex flex-col gap-1">
                                                        <div
                                                            className={`text-error ${
                                                                isExpanded ? 'whitespace-pre-wrap' : 'truncate'
                                                            }`}
                                                            data-testid={`job-error-${job.id}`}
                                                        >
                                                            {job.lastError}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className="text-[10px] text-base-content/60 hover:text-base-content underline self-start"
                                                            data-testid={`expand-error-btn-${job.id}`}
                                                            onClick={(e) => toggleErrorExpanded(job.id, e)}
                                                        >
                                                            {isExpanded ? 'Hide' : 'Details'}
                                                        </button>
                                                    </div>
                                                ) : null}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Load More Button */}
                {hasMore && (
                    <div className="p-3 border-t border-base-content/10 flex justify-center bg-base-200/30">
                        <Button
                            variant="ghost"
                            size="xs"
                            disabled={loading}
                            onClick={() => setOffset((prev) => prev + 100)}
                            data-testid="jobs-load-more-btn"
                        >
                            {loading ? 'Loading…' : 'Load more'}
                        </Button>
                    </div>
                )}
            </div>

            {/* Detail Drawer */}
            <JobDetailDrawer job={selectedJob} onClose={() => setSelectedJob(null)} onNavigate={onNavigate} />
        </div>
    );
}
