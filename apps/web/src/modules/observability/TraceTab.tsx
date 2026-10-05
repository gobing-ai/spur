import { type WorkflowProgressProjectionDto, workflowProgressProjectionSchema } from '@gobing-ai/spur-contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, CardBody, Loading } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import { timeRangeSince } from './ObservabilityFilters';
import { CopyValueButton, formatDuration } from './SystemEventsTab';
import type { ObservabilityNavIntent, ObservabilityTabProps } from './tabs';

// ---------------------------------------------------------------------------
// Wire types (mirror RunStore* interfaces from run-store-service.ts)
// ---------------------------------------------------------------------------

/** One run-list row from `GET /api/runs`. */
export interface TraceRunEntry {
    id: string;
    workflowName: string | null;
    status: string;
    mode: string | null;
    agent: string | null;
    startedAt: string;
    completedAt: string | null;
}

interface RunListResult {
    runs: TraceRunEntry[];
    count: number;
    nextCursor: string | null;
    hasMore: boolean;
}

/** Run status vocabulary persisted in `runs.status` (see the run DAO). */
export const TRACE_STATUS_FILTERS = [
    'all',
    'pending',
    'running',
    'paused',
    'interrupted',
    'done',
    'failed',
    'cancelled',
] as const;

export type TraceStatusFilter = (typeof TRACE_STATUS_FILTERS)[number];

const RUNS_LIMIT = 50;

// ---------------------------------------------------------------------------
// Narrowing guards - return null on any shape mismatch
// ---------------------------------------------------------------------------

function isStr(v: unknown): v is string {
    return typeof v === 'string';
}

function isOptStr(v: unknown): v is string | null {
    return v === null || typeof v === 'string';
}

function isOptNum(v: unknown): v is number | null {
    return v === null || (typeof v === 'number' && Number.isFinite(v));
}

function parseRunListEntry(v: unknown): TraceRunEntry | null {
    if (v === null || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (
        !isStr(o.id) ||
        !isOptStr(o.workflowName) ||
        !isStr(o.status) ||
        !isOptStr(o.mode) ||
        !isOptStr(o.agent) ||
        !isStr(o.startedAt) ||
        !isOptStr(o.completedAt)
    ) {
        return null;
    }
    return {
        id: o.id,
        workflowName: o.workflowName,
        status: o.status,
        mode: o.mode,
        agent: o.agent,
        startedAt: o.startedAt,
        completedAt: o.completedAt,
    };
}

function parseRunListResponse(v: unknown): RunListResult | null {
    if (v === null || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (!Array.isArray(o.runs) || typeof o.count !== 'number') return null;
    const runs: TraceRunEntry[] = [];
    for (const r of o.runs) {
        const parsed = parseRunListEntry(r);
        if (parsed) runs.push(parsed);
    }
    return {
        runs,
        count: o.count,
        nextCursor: isStr(o.nextCursor) ? o.nextCursor : null,
        hasMore: typeof o.hasMore === 'boolean' ? o.hasMore : false,
    };
}

/** Wire shape of GET /api/observability/run-record/:runId (0929 R2). */
type RunRecordOutcome =
    | { status: 'record'; markdown: string; state: Record<string, unknown> }
    | { status: 'incomplete'; markdown: string; reason: string }
    | { status: 'legacy'; content: string }
    | { status: 'oversized'; sizeBytes: number }
    | { status: 'missing' };

function parseRunRecordOutcome(v: unknown): RunRecordOutcome | null {
    if (v === null || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (o.status === 'missing') return { status: 'missing' };
    if (o.status === 'oversized') {
        return isOptNum(o.sizeBytes) && o.sizeBytes !== null ? { status: 'oversized', sizeBytes: o.sizeBytes } : null;
    }
    if (o.status === 'legacy') return isStr(o.content) ? { status: 'legacy', content: o.content } : null;
    if (o.status === 'incomplete') {
        if (!isStr(o.markdown) || !isStr(o.reason)) return null;
        return { status: 'incomplete', markdown: o.markdown, reason: o.reason };
    }
    if (o.status === 'record') {
        if (!isStr(o.markdown)) return null;
        if (o.state === null || typeof o.state !== 'object' || Array.isArray(o.state)) return null;
        return { status: 'record', markdown: o.markdown, state: o.state as Record<string, unknown> };
    }
    return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatLocalTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const mo = MONTHS[d.getMonth()];
    const day = d.getDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${mo} ${day} ${hh}:${mm}:${ss}`;
}

function statusBadgeVariant(status: string): 'neutral' | 'info' | 'success' | 'warning' | 'error' {
    const s = status.toLowerCase();
    if (s === 'completed' || s === 'done' || s === 'succeeded' || s === 'passed') return 'success';
    if (s === 'failed' || s === 'error' || s === 'cancelled') return 'error';
    if (s === 'running' || s === 'active' || s === 'processing') return 'info';
    if (s === 'paused' || s === 'pending' || s === 'waiting' || s === 'interrupted') return 'warning';
    return 'neutral';
}

/** Filter shape of the run list query, exported for URL-level tests. */
export interface TraceRunsQuery {
    status?: string;
    workflow?: string;
    since?: string;
    cursor?: string;
    limit: number;
}

/** Build the run-list request URL; `all` ranges contribute no `since`. */
export function buildRunsUrl(base: string, query: TraceRunsQuery): string {
    const params = new URLSearchParams();
    if (query.status !== undefined) params.set('status', query.status);
    if (query.workflow !== undefined) params.set('workflow', query.workflow);
    if (query.since !== undefined) params.set('since', query.since);
    if (query.cursor !== undefined) params.set('cursor', query.cursor);
    params.set('limit', String(query.limit));
    return `${base}/runs?${params.toString()}`;
}

/**
 * The History time window as copyable CLI text (E72 R7).
 *
 * History has no URL/searchParams contract, so the window is handed over as the
 * `spur history analyze` invocation the user can run for the same window.
 */
export function historyCommand(run: { startedAt: string; completedAt: string | null }): string {
    const since = `--since ${run.startedAt}`;
    return run.completedAt === null
        ? `spur history analyze ${since}`
        : `spur history analyze ${since} --until ${run.completedAt}`;
}

/** Ids of the `n` slowest attempts with a measured duration (E72 R3). */
export function slowestAttemptIds(projection: WorkflowProgressProjectionDto, n = 3): Set<string> {
    const measured: { actionRunId: string; durationMs: number }[] = [];
    for (const state of projection.states) {
        for (const action of state.actions) {
            for (const attempt of action.attempts) {
                if (attempt.durationMs !== null && Number.isFinite(attempt.durationMs)) {
                    measured.push({ actionRunId: attempt.actionRunId, durationMs: attempt.durationMs });
                }
            }
        }
    }
    measured.sort((a, b) => b.durationMs - a.durationMs);
    return new Set(measured.slice(0, n).map((attempt) => attempt.actionRunId));
}

/** Wall-clock duration of a run row, or "running" while `completedAt` is null. */
function runDuration(run: TraceRunEntry): string {
    if (run.completedAt === null) return 'running';
    const ms = Date.parse(run.completedAt) - Date.parse(run.startedAt);
    if (!Number.isFinite(ms) || ms < 0) return 'running';
    return formatDuration(ms) ?? 'running';
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

interface RunDetailState {
    projection: WorkflowProgressProjectionDto | null;
    error: string | null;
    loading: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Trace tab (feature E72): workflow runs, newest first, with a per-run progress
 * detail read from the shared `GET /api/runs/:runId/progress` projection.
 *
 * The shell owns `timeRange`; this tab only reads it. Filters are server-side so
 * paging stays consistent (E72 R2).
 */
export default function TraceTab({ timeRange, onNavigate }: ObservabilityTabProps) {
    const [statusFilter, setStatusFilter] = useState<TraceStatusFilter>('all');
    const [workflowFilter, setWorkflowFilter] = useState('');
    const [runs, setRuns] = useState<TraceRunEntry[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [listStatus, setListStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const [listError, setListError] = useState<string | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
    const [detailCache, setDetailCache] = useState<Map<string, RunDetailState>>(new Map());
    const listAbortRef = useRef<AbortController | null>(null);

    const since = useMemo(() => timeRangeSince(timeRange), [timeRange]);
    const queryFilters = useMemo(
        () => ({
            ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
            ...(workflowFilter !== '' ? { workflow: workflowFilter } : {}),
            ...(since !== undefined ? { since } : {}),
        }),
        [statusFilter, workflowFilter, since],
    );

    // First page. Re-running it resets paging, so the effect keys on this
    // callback: every filter and the shell `timeRange` change its identity
    // (E72 R2), and Retry invokes it again after a failed fetch.
    const loadFirstPage = useCallback(() => {
        listAbortRef.current?.abort();
        const controller = new AbortController();
        listAbortRef.current = controller;
        setListStatus('loading');
        setListError(null);
        void (async () => {
            try {
                const url = buildRunsUrl(resolveApiUrl(), { ...queryFilters, limit: RUNS_LIMIT });
                const res = await fetchWithTimeout(new Request(url, { signal: controller.signal }));
                if (!res.ok) throw new Error(`runs fetch failed: ${res.status}`);
                const body = parseRunListResponse(await res.json());
                if (!body) throw new Error('runs response failed schema validation');
                if (controller.signal.aborted) return;
                setRuns(body.runs);
                setNextCursor(body.nextCursor);
                setHasMore(body.hasMore);
                setListStatus('ready');
            } catch (err) {
                if (controller.signal.aborted) return;
                setListError(err instanceof Error ? err.message : String(err));
                setListStatus('error');
            }
        })();
    }, [queryFilters]);

    useEffect(() => {
        loadFirstPage();
        return () => listAbortRef.current?.abort();
    }, [loadFirstPage]);

    // Load more: same filters, opaque keyset cursor (E72 R2).
    const loadMore = useCallback(async () => {
        if (nextCursor === null || !hasMore || loadingMore) return;
        setLoadingMore(true);
        try {
            const url = buildRunsUrl(resolveApiUrl(), { ...queryFilters, cursor: nextCursor, limit: RUNS_LIMIT });
            const res = await fetchWithTimeout(new Request(url));
            if (!res.ok) throw new Error(`runs fetch failed: ${res.status}`);
            const body = parseRunListResponse(await res.json());
            if (!body) throw new Error('runs response failed schema validation');
            setRuns((prev) => {
                const seen = new Set(prev.map((run) => run.id));
                return [...prev, ...body.runs.filter((run) => !seen.has(run.id))];
            });
            setNextCursor(body.nextCursor);
            setHasMore(body.hasMore);
        } catch (err) {
            setListError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoadingMore(false);
        }
    }, [nextCursor, hasMore, loadingMore, queryFilters]);

    // Detail is cached per runId for the lifetime of the mounted tab (E72 R3).
    const toggleRun = useCallback(
        (runId: string) => {
            if (expandedRunId === runId) {
                setExpandedRunId(null);
                return;
            }
            setExpandedRunId(runId);
            if (detailCache.has(runId)) return;

            setDetailCache((prev) => {
                const next = new Map(prev);
                next.set(runId, { projection: null, error: null, loading: true });
                return next;
            });

            void (async () => {
                const store = (state: RunDetailState) => {
                    setDetailCache((prev) => {
                        const next = new Map(prev);
                        next.set(runId, state);
                        return next;
                    });
                };
                try {
                    const res = await fetchWithTimeout(new Request(`${resolveApiUrl()}/runs/${runId}/progress`));
                    if (res.status === 404) {
                        store({ projection: null, error: 'Run not found', loading: false });
                        return;
                    }
                    if (!res.ok) {
                        store({ projection: null, error: `run progress fetch failed: ${res.status}`, loading: false });
                        return;
                    }
                    const parsed = workflowProgressProjectionSchema.safeParse(await res.json());
                    if (!parsed.success) {
                        store({
                            projection: null,
                            error: 'progress response failed schema validation',
                            loading: false,
                        });
                        return;
                    }
                    store({ projection: parsed.data, error: null, loading: false });
                } catch (err) {
                    store({
                        projection: null,
                        error: err instanceof Error ? err.message : String(err),
                        loading: false,
                    });
                }
            })();
        },
        [expandedRunId, detailCache],
    );

    // Workflow options come from the names already loaded, plus the active
    // selection so a chosen workflow stays selectable after filtering (E72 R2).
    const workflowOptions = useMemo(() => {
        const names = new Set<string>();
        for (const run of runs) {
            if (run.workflowName !== null && run.workflowName !== '') names.add(run.workflowName);
        }
        const options = Array.from(names).sort();
        if (workflowFilter !== '' && !options.includes(workflowFilter)) options.unshift(workflowFilter);
        return options;
    }, [runs, workflowFilter]);

    const expandedRun = runs.find((run) => run.id === expandedRunId) ?? null;
    const detailState = expandedRunId === null ? undefined : detailCache.get(expandedRunId);
    const slowestIds = useMemo(
        () => (detailState?.projection ? slowestAttemptIds(detailState.projection) : new Set<string>()),
        [detailState],
    );

    if (listStatus === 'loading' && runs.length === 0) {
        return (
            <div className="flex items-center justify-center h-32 text-spur-text-muted text-sm">
                <Loading size="sm" /> Loading runs…
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3" data-trace-tab>
            {/* Filter bar (E72 R2) */}
            <div className="flex flex-wrap items-center gap-3 bg-base-200 rounded-xl border border-base-content/10 p-3">
                <div className="flex items-center gap-2">
                    <label htmlFor="trace-status-filter" className="text-xs font-semibold text-spur-text-muted">
                        Status
                    </label>
                    <select
                        id="trace-status-filter"
                        className="bg-base-100 border border-base-content/20 rounded px-2 py-1 text-xs cursor-pointer"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as TraceStatusFilter)}
                    >
                        {TRACE_STATUS_FILTERS.map((status) => (
                            <option key={status} value={status}>
                                {status}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <label htmlFor="trace-workflow-filter" className="text-xs font-semibold text-spur-text-muted">
                        Workflow
                    </label>
                    <select
                        id="trace-workflow-filter"
                        className="bg-base-100 border border-base-content/20 rounded px-2 py-1 text-xs cursor-pointer"
                        value={workflowFilter}
                        onChange={(e) => setWorkflowFilter(e.target.value)}
                    >
                        <option value="">All workflows</option>
                        {workflowOptions.map((name) => (
                            <option key={name} value={name}>
                                {name}
                            </option>
                        ))}
                    </select>
                </div>
                <span className="text-xs text-spur-text-muted ml-auto">{runs.length} run(s)</span>
            </div>

            {listError !== null && (
                <div className="text-xs text-error" role="alert">
                    Failed to load runs: {listError}
                    <Button variant="ghost" size="xs" className="ml-2" onClick={loadFirstPage}>
                        Retry
                    </Button>
                </div>
            )}

            {runs.length === 0 && listStatus === 'ready' && (
                <div className="p-4 text-sm text-spur-text-muted italic" data-trace-empty>
                    No workflow runs in this window
                </div>
            )}

            {runs.length > 0 && (
                <ul className="flex flex-col gap-1" data-trace-run-list>
                    {runs.map((run) => {
                        const expanded = run.id === expandedRunId;
                        return (
                            <li key={run.id}>
                                <Card variant="compact" className="bg-base-200 border border-base-content/10">
                                    <CardBody className="p-2 gap-1">
                                        <button
                                            type="button"
                                            aria-expanded={expanded}
                                            onClick={() => toggleRun(run.id)}
                                            className="w-full text-left flex items-center gap-2 flex-wrap cursor-pointer"
                                            data-run-row
                                        >
                                            <span aria-hidden="true">{expanded ? '▼' : '▶'}</span>
                                            <span className="text-xs font-mono font-semibold">
                                                {run.workflowName ?? 'unknown'}
                                            </span>
                                            <Badge variant={statusBadgeVariant(run.status)} size="xs">
                                                {run.status}
                                            </Badge>
                                            <span className="text-[10px] text-spur-text-muted font-mono">
                                                {formatLocalTime(run.startedAt)}
                                            </span>
                                            <span className="text-[10px] text-spur-text-muted font-mono">
                                                {runDuration(run)}
                                            </span>
                                            {run.agent !== null && (
                                                <span className="text-[10px] text-spur-text-muted ml-auto">
                                                    {run.agent}
                                                </span>
                                            )}
                                        </button>

                                        {expanded && detailState !== undefined && (
                                            <div className="mt-2 pl-4 border-l-2 border-base-content/10">
                                                {detailState.loading && (
                                                    <div className="flex items-center gap-2 text-xs text-spur-text-muted py-2">
                                                        <Loading size="xs" /> Loading run detail…
                                                    </div>
                                                )}
                                                {detailState.error !== null && (
                                                    <div
                                                        className="text-xs text-error py-2"
                                                        role="alert"
                                                        data-run-detail-error
                                                    >
                                                        {detailState.error}
                                                    </div>
                                                )}
                                                {detailState.projection !== null && expandedRun !== null && (
                                                    <RunDetailPanel
                                                        run={expandedRun}
                                                        projection={detailState.projection}
                                                        slowestIds={slowestIds}
                                                        onNavigate={onNavigate}
                                                    />
                                                )}
                                            </div>
                                        )}
                                    </CardBody>
                                </Card>
                            </li>
                        );
                    })}
                </ul>
            )}

            {hasMore && (
                <div className="flex justify-center">
                    <Button variant="outline" size="xs" onClick={() => void loadMore()} disabled={loadingMore}>
                        Load more
                    </Button>
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// RunDetailPanel - header, states, transitions, diagnostics, record, links
// ---------------------------------------------------------------------------

function RunDetailPanel({
    run,
    projection,
    slowestIds,
    onNavigate,
}: {
    run: TraceRunEntry;
    projection: WorkflowProgressProjectionDto;
    slowestIds: Set<string>;
    onNavigate?: (intent: ObservabilityNavIntent) => void;
}) {
    const command = historyCommand(run);
    return (
        <div className="space-y-3" data-run-detail>
            {/* Header (E72 R3) */}
            <div className="flex items-center gap-2 flex-wrap text-[11px]" data-run-detail-header>
                <span className="font-mono font-semibold">{projection.workflow}</span>
                <Badge variant={statusBadgeVariant(projection.status)} size="xs">
                    {projection.status}
                </Badge>
                {projection.currentState !== null && (
                    <span className="text-spur-text-muted">
                        current state:{' '}
                        <span className="font-mono" data-current-state>
                            {projection.currentState}
                        </span>
                    </span>
                )}
                {projection.definitionDigest !== null && (
                    <span className="font-mono text-spur-text-muted" title={projection.definitionDigest}>
                        {projection.definitionDigest.slice(0, 12)}
                    </span>
                )}
            </div>

            {/* States, in projection order (E72 R3) */}
            {projection.states.length > 0 && (
                <div>
                    <div className="text-[10px] uppercase text-spur-text-muted font-semibold mb-1">States</div>
                    <ol className="space-y-2">
                        {projection.states.map((state) => (
                            <li
                                key={`${state.state}:${state.visit}`}
                                data-state
                                className="text-[11px] flex flex-col gap-1"
                            >
                                <span className="flex items-center gap-2">
                                    <span className="font-mono font-semibold">{state.state}</span>
                                    <Badge variant="outline" size="xs">
                                        visit {state.visit}
                                    </Badge>
                                    <Badge variant={statusBadgeVariant(state.status)} size="xs">
                                        {state.status}
                                    </Badge>
                                </span>
                                <ul className="pl-4 space-y-1">
                                    {state.actions.map((action) => (
                                        <li key={action.actionKey} className="flex flex-col gap-0.5">
                                            <span className="flex items-center gap-2 flex-wrap">
                                                <span className="font-mono">{action.actionKey}</span>
                                                <Badge variant="outline" size="xs">
                                                    {action.kind}
                                                </Badge>
                                                <Badge variant={statusBadgeVariant(action.status)} size="xs">
                                                    {action.status}
                                                </Badge>
                                            </span>
                                            {action.attempts.length > 0 && (
                                                <ul className="pl-4 space-y-0.5">
                                                    {action.attempts.map((attempt) => {
                                                        const duration = formatDuration(attempt.durationMs);
                                                        const isSlowest = slowestIds.has(attempt.actionRunId);
                                                        return (
                                                            <li
                                                                key={attempt.actionRunId}
                                                                data-attempt={attempt.actionRunId}
                                                                data-slowest={isSlowest ? 'true' : undefined}
                                                                className={`flex items-center gap-2 flex-wrap ${
                                                                    isSlowest
                                                                        ? 'text-warning font-semibold'
                                                                        : 'text-spur-text-muted'
                                                                }`}
                                                            >
                                                                <Badge
                                                                    variant={statusBadgeVariant(attempt.status)}
                                                                    size="xs"
                                                                >
                                                                    {attempt.status}
                                                                </Badge>
                                                                {duration !== null && (
                                                                    <span className="font-mono">{duration}</span>
                                                                )}
                                                                {attempt.provenance === 'host-reported' && (
                                                                    <Badge variant="info" size="xs">
                                                                        host-reported
                                                                    </Badge>
                                                                )}
                                                                {attempt.estimated && (
                                                                    <Badge variant="warning" size="xs">
                                                                        estimated
                                                                    </Badge>
                                                                )}
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </li>
                        ))}
                    </ol>
                </div>
            )}

            {/* Transitions (E72 R3) */}
            {projection.transitions.length > 0 && (
                <div>
                    <div className="text-[10px] uppercase text-spur-text-muted font-semibold mb-1">Transitions</div>
                    <ul className="space-y-0.5">
                        {projection.transitions.map((transition) => (
                            <li
                                key={`${transition.from}:${transition.to}:${transition.at}`}
                                className="text-[11px] flex items-center gap-2 flex-wrap"
                                data-transition
                            >
                                <span className="font-mono">
                                    {transition.from} → {transition.to}
                                </span>
                                {transition.trigger !== null && (
                                    <span className="text-spur-text-muted">{transition.trigger}</span>
                                )}
                                <span className="text-[10px] text-spur-text-muted font-mono ml-auto">
                                    {formatLocalTime(transition.at)}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Diagnostics (E72 R3) */}
            {projection.diagnostics.length > 0 && (
                <div data-diagnostics>
                    <div className="text-[10px] uppercase text-spur-text-muted font-semibold mb-1">Diagnostics</div>
                    <ul className="space-y-0.5">
                        {projection.diagnostics.map((diagnostic) => (
                            <li key={`${diagnostic.code}:${diagnostic.message}`} className="text-[11px] text-warning">
                                <span className="font-mono">{diagnostic.code}</span> {diagnostic.message}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Bounded run-record text (E72 R4) */}
            <RunRecordSection runId={run.id} traceStatus={projection.status} />

            {/* Cross-module links (E72 R6/R7) */}
            <div className="flex flex-col gap-1 border-t border-base-content/10 pt-2">
                <div>
                    <Button
                        variant="outline"
                        size="xs"
                        onClick={() => onNavigate?.({ tab: 'system-events', runId: run.id })}
                    >
                        System events for this run
                    </Button>
                </div>
                <div className="text-[11px] flex items-center gap-2 flex-wrap">
                    <span className="text-spur-text-muted">History window:</span>
                    <span className="font-mono" data-history-window>
                        {formatLocalTime(run.startedAt)} →{' '}
                        {run.completedAt === null ? 'running' : formatLocalTime(run.completedAt)}
                    </span>
                    <code className="font-mono text-[10px] text-spur-text-muted" data-history-command>
                        {command}
                    </code>
                    <CopyValueButton value={command} label="history analyze command" />
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// RunRecordSection - bounded run-record inspection (0929 R1-R3)
// ---------------------------------------------------------------------------

function RunRecordSection({ runId, traceStatus }: { runId: string; traceStatus: string }) {
    const [outcome, setOutcome] = useState<RunRecordOutcome | null>(null);
    const [phase, setPhase] = useState<'idle' | 'loading' | 'error'>('idle');
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(() => {
        setPhase('loading');
        setError(null);
        (async () => {
            try {
                const res = await fetchWithTimeout(new Request(`${resolveApiUrl()}/observability/run-record/${runId}`));
                const body = (await res.json().catch(() => null)) as unknown;
                if (!res.ok) {
                    const msg =
                        body !== null && typeof body === 'object' ? (body as Record<string, unknown>).error : null;
                    throw new Error(typeof msg === 'string' ? msg : `run record fetch failed: ${res.status}`);
                }
                const parsed = parseRunRecordOutcome(body);
                if (!parsed) throw new Error('run record response failed schema validation');
                setOutcome(parsed);
                setPhase('idle');
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
                setPhase('error');
            }
        })();
    }, [runId]);

    return (
        <div data-run-record>
            <div className="text-[10px] uppercase text-spur-text-muted font-semibold mb-1">
                Run Record{' '}
                <span className="normal-case font-normal">
                    — status (DB trace):{' '}
                    <Badge variant={statusBadgeVariant(traceStatus)} size="xs">
                        {traceStatus}
                    </Badge>
                </span>
            </div>
            {phase === 'idle' && outcome === null && (
                <Button variant="outline" size="xs" onClick={load} aria-label={`View run record for run ${runId}`}>
                    View run record
                </Button>
            )}
            {phase === 'loading' && (
                <div
                    className="flex items-center gap-2 text-xs text-spur-text-muted py-1"
                    aria-live="polite"
                    aria-busy="true"
                >
                    <Loading size="xs" /> Loading run record…
                </div>
            )}
            {phase === 'error' && (
                <div className="text-xs text-error py-1" role="alert">
                    Failed to load run record: {error}
                    <Button variant="ghost" size="xs" className="ml-2" onClick={load}>
                        Retry
                    </Button>
                </div>
            )}
            {outcome !== null && (
                <div aria-live="polite">
                    {outcome.status === 'record' && (
                        <>
                            <pre
                                data-run-record-text
                                className="text-[11px] bg-base-300 rounded p-2 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap"
                            >
                                {outcome.markdown}
                            </pre>
                            <details className="text-[11px]">
                                <summary className="cursor-pointer text-spur-text-muted">Machine state</summary>
                                <pre className="bg-base-300 rounded p-2 overflow-x-auto max-h-64 overflow-y-auto">
                                    {JSON.stringify(outcome.state, null, 2)}
                                </pre>
                            </details>
                        </>
                    )}
                    {outcome.status === 'incomplete' && (
                        <>
                            <p className="text-xs text-warning py-1">
                                Run record is incomplete ({outcome.reason}); the human log is shown, but completion is
                                only proven by the DB trace.
                            </p>
                            <pre
                                data-run-record-text
                                className="text-[11px] bg-base-300 rounded p-2 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap"
                            >
                                {outcome.markdown}
                            </pre>
                        </>
                    )}
                    {outcome.status === 'legacy' && (
                        <>
                            <p className="text-xs text-spur-text-muted py-1">
                                Legacy .log record (re-redacted on read).
                            </p>
                            <pre
                                data-run-record-text
                                className="text-[11px] bg-base-300 rounded p-2 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap"
                            >
                                {outcome.content}
                            </pre>
                        </>
                    )}
                    {outcome.status === 'oversized' && (
                        <p className="text-xs text-warning py-1">
                            Run record is too large to display ({outcome.sizeBytes} bytes).
                        </p>
                    )}
                    {outcome.status === 'missing' && (
                        <p className="text-xs text-spur-text-muted italic py-1">No run record found on disk.</p>
                    )}
                </div>
            )}
        </div>
    );
}
