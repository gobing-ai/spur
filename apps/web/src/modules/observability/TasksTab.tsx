import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Card, CardBody, Loading } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import { formatDuration, parseHistoryResponse, type SystemEventRow } from './SystemEventsTab';

// ---------------------------------------------------------------------------
// Wire types (mirror RunStore* interfaces from run-store-service.ts)
// ---------------------------------------------------------------------------

interface RunListEntry {
    id: string;
    workflowName: string | null;
    status: string;
    mode: string | null;
    agent: string | null;
    startedAt: string;
    completedAt: string | null;
}

interface RunPhase {
    phase: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
}

interface RunTransition {
    from: string;
    to: string;
    trigger: string | null;
}

interface RunAction {
    id: string;
    node: string;
    kind: string;
    status: string;
    durationMs: number | null;
    ok: boolean | null;
    resultSummary: unknown;
    startedAt: string | null;
    completedAt: string | null;
}

interface RunDetail {
    run: RunListEntry;
    phases: RunPhase[];
    transitions: RunTransition[];
    actions: RunAction[];
}

interface RunListResult {
    runs: RunListEntry[];
    count: number;
    nextCursor: string | null;
    hasMore: boolean;
}

interface WbsLink {
    runId: string;
    kind: string;
    linkedAt: string;
    run: RunListEntry | null;
}

// ---------------------------------------------------------------------------
// Narrowing guards (R7) - return null on any shape mismatch
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
function isOptBool(v: unknown): v is boolean | null {
    return v === null || typeof v === 'boolean';
}

function parseRunListEntry(v: unknown): RunListEntry | null {
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
    const runs: RunListEntry[] = [];
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

function parseRunPhase(v: unknown): RunPhase | null {
    if (v === null || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (!isStr(o.phase) || !isStr(o.status) || !isOptStr(o.startedAt) || !isOptStr(o.completedAt)) return null;
    return { phase: o.phase, status: o.status, startedAt: o.startedAt, completedAt: o.completedAt };
}

function parseRunTransition(v: unknown): RunTransition | null {
    if (v === null || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (!isStr(o.from) || !isStr(o.to) || !isOptStr(o.trigger)) return null;
    return { from: o.from, to: o.to, trigger: o.trigger };
}

function parseRunAction(v: unknown): RunAction | null {
    if (v === null || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (
        !isStr(o.id) ||
        !isStr(o.node) ||
        !isStr(o.kind) ||
        !isStr(o.status) ||
        !isOptNum(o.durationMs) ||
        !isOptBool(o.ok) ||
        !isOptStr(o.startedAt) ||
        !isOptStr(o.completedAt)
    ) {
        return null;
    }
    return {
        id: o.id,
        node: o.node,
        kind: o.kind,
        status: o.status,
        durationMs: o.durationMs,
        ok: o.ok,
        resultSummary: o.resultSummary,
        startedAt: o.startedAt,
        completedAt: o.completedAt,
    };
}

function parseRunDetail(v: unknown): RunDetail | null {
    if (v === null || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    const run = parseRunListEntry(o.run);
    if (!run) return null;
    if (!Array.isArray(o.phases) || !Array.isArray(o.transitions) || !Array.isArray(o.actions)) return null;
    const phases: RunPhase[] = [];
    for (const p of o.phases) {
        const parsed = parseRunPhase(p);
        if (parsed) phases.push(parsed);
    }
    const transitions: RunTransition[] = [];
    for (const t of o.transitions) {
        const parsed = parseRunTransition(t);
        if (parsed) transitions.push(parsed);
    }
    const actions: RunAction[] = [];
    for (const a of o.actions) {
        const parsed = parseRunAction(a);
        if (parsed) actions.push(parsed);
    }
    return { run, phases, transitions, actions };
}

function parseWbsLinksResponse(v: unknown): WbsLink[] | null {
    if (!Array.isArray(v)) return null;
    const links: WbsLink[] = [];
    for (const item of v) {
        if (item === null || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        if (!isStr(o.runId) || !isStr(o.kind) || !isStr(o.linkedAt)) continue;
        links.push({ runId: o.runId, kind: o.kind, linkedAt: o.linkedAt, run: parseRunListEntry(o.run) });
    }
    return links;
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
    if (s === 'completed' || s === 'done' || s === 'succeeded') return 'success';
    if (s === 'failed' || s === 'error' || s === 'cancelled') return 'error';
    if (s === 'running' || s === 'active' || s === 'processing') return 'info';
    if (s === 'paused' || s === 'pending' || s === 'waiting') return 'warning';
    return 'neutral';
}

function isTerminalPhase(status: string): boolean {
    const s = status.toLowerCase();
    return s === 'completed' || s === 'failed' || s === 'skipped' || s === 'cancelled';
}

function isFailedPhase(status: string): boolean {
    const s = status.toLowerCase();
    return s === 'failed' || s === 'error' || s === 'cancelled';
}

/** Extract a failure reason string from the action's resultSummary (R3). */
function extractFailureReason(summary: unknown): string | null {
    if (summary === null || summary === undefined) return null;
    if (typeof summary === 'string') return summary.length > 0 ? summary : null;
    if (typeof summary === 'object') {
        const o = summary as Record<string, unknown>;
        const msg = o.error ?? o.message ?? o.reason ?? o.summary;
        if (typeof msg === 'string' && msg.length > 0) return msg;
    }
    return null;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface TasksTabState {
    runs: RunListEntry[];
    hasMore: boolean;
    nextCursor: string | null;
    wbsIndex: Map<string, string>;
    corpusEvents: SystemEventRow[];
}

interface RunDetailState {
    detail: RunDetail | null;
    error: string | null;
    loading: boolean;
}

const RUNS_LIMIT = 50;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TasksTab() {
    const [state, setState] = useState<TasksTabState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
    const [detailCache, setDetailCache] = useState<Map<string, RunDetailState>>(new Map());

    // --- List fetch + WBS index + corpus lane (R1, R4) ---
    useEffect(() => {
        const controller = new AbortController();
        (async () => {
            try {
                const runsUrl = `${resolveApiUrl()}/runs?limit=${RUNS_LIMIT}`;
                const corpusTaskUrl = `${resolveApiUrl()}/events/history?prefix=task&limit=50`;
                const corpusFeatureUrl = `${resolveApiUrl()}/events/history?prefix=feature&limit=50`;

                const [runsRes, taskRes, featureRes] = await Promise.all([
                    fetchWithTimeout(new Request(runsUrl, { signal: controller.signal })),
                    fetchWithTimeout(new Request(corpusTaskUrl, { signal: controller.signal })),
                    fetchWithTimeout(new Request(corpusFeatureUrl, { signal: controller.signal })),
                ]);

                if (!runsRes.ok) throw new Error(`runs fetch failed: ${runsRes.status}`);
                const runsBody = parseRunListResponse(await runsRes.json());
                if (!runsBody) throw new Error('runs response failed schema validation');

                // Corpus lane (R4) - degrade silently if malformed
                const corpusEvents: SystemEventRow[] = [];
                if (taskRes.ok) {
                    const taskBody = parseHistoryResponse(await taskRes.json());
                    if (taskBody) corpusEvents.push(...taskBody.events);
                }
                if (featureRes.ok) {
                    const featureBody = parseHistoryResponse(await featureRes.json());
                    if (featureBody) corpusEvents.push(...featureBody.events);
                }

                // Build runId->wbs index (R1 linked WBS)
                // Fetch /api/runs/by-wbs/:wbs for each task WBS via the oRPC client
                const wbsIndex = new Map<string, string>();
                try {
                    const wbsLinksUrl = `${resolveApiUrl()}/runs/by-wbs/`;
                    // We don't have a task list endpoint via fetch directly - use /api/tasks
                    const tasksRes = await fetchWithTimeout(
                        new Request(`${resolveApiUrl()}/tasks?limit=200`, { signal: controller.signal }),
                    );
                    if (tasksRes.ok) {
                        const tasksBody = (await tasksRes.json()) as unknown;
                        if (tasksBody !== null && typeof tasksBody === 'object') {
                            const tasksObj = tasksBody as Record<string, unknown>;
                            const items = tasksObj.items ?? tasksObj.tasks ?? tasksObj.data;
                            if (Array.isArray(items)) {
                                for (const item of items) {
                                    if (item === null || typeof item !== 'object') continue;
                                    const wbs = (item as Record<string, unknown>).wbs;
                                    if (typeof wbs !== 'string') continue;
                                    try {
                                        const linkRes = await fetchWithTimeout(
                                            new Request(`${wbsLinksUrl}${wbs}`, { signal: controller.signal }),
                                        );
                                        if (!linkRes.ok) continue;
                                        const links = parseWbsLinksResponse(await linkRes.json());
                                        if (!links) continue;
                                        for (const link of links) {
                                            wbsIndex.set(link.runId, wbs);
                                        }
                                    } catch {
                                        // per-WBS failure is non-fatal
                                    }
                                }
                            }
                        }
                    }
                } catch {
                    // WBS index build failure is non-fatal - runs just show "unlinked"
                }

                setState({
                    runs: runsBody.runs,
                    hasMore: runsBody.hasMore,
                    nextCursor: runsBody.nextCursor,
                    wbsIndex,
                    corpusEvents,
                });
            } catch (err) {
                if (controller.signal.aborted) return;
                setError(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => controller.abort();
    }, []);

    // --- Expand a run -> fetch detail (R2, R3, R5) ---
    const toggleExpand = useCallback(
        (runId: string) => {
            if (expandedRunId === runId) {
                setExpandedRunId(null);
                return;
            }
            setExpandedRunId(runId);

            // If already cached (success or error), don't refetch
            const cached = detailCache.get(runId);
            if (cached) return;

            // Mark loading
            setDetailCache((prev) => {
                const next = new Map(prev);
                next.set(runId, { detail: null, error: null, loading: true });
                return next;
            });

            (async () => {
                try {
                    const res = await fetchWithTimeout(new Request(`${resolveApiUrl()}/runs/${runId}`));
                    if (!res.ok) {
                        const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
                        const msg = body?.error ?? `run detail fetch failed: ${res.status}`;
                        setDetailCache((prev) => {
                            const next = new Map(prev);
                            next.set(runId, {
                                detail: null,
                                error: typeof msg === 'string' ? msg : String(msg),
                                loading: false,
                            });
                            return next;
                        });
                        return;
                    }
                    const detail = parseRunDetail(await res.json());
                    if (!detail) {
                        setDetailCache((prev) => {
                            const next = new Map(prev);
                            next.set(runId, {
                                detail: null,
                                error: 'run detail failed schema validation',
                                loading: false,
                            });
                            return next;
                        });
                        return;
                    }
                    setDetailCache((prev) => {
                        const next = new Map(prev);
                        next.set(runId, { detail, error: null, loading: false });
                        return next;
                    });
                } catch (err) {
                    setDetailCache((prev) => {
                        const next = new Map(prev);
                        next.set(runId, {
                            detail: null,
                            error: err instanceof Error ? err.message : String(err),
                            loading: false,
                        });
                        return next;
                    });
                }
            })();
        },
        [expandedRunId, detailCache],
    );

    // --- Render ---

    if (error) {
        return (
            <div className="p-4 text-sm text-error" role="alert">
                Failed to load runs: {error}
            </div>
        );
    }
    if (state === null) {
        return (
            <div className="flex items-center justify-center h-32 text-spur-text-muted text-sm">
                <Loading size="sm" /> Loading runs…
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden" data-tasks-tab>
            {/* Run list (R1) */}
            <div className="px-4 py-2 border-b border-spur-border bg-base-200 shrink-0">
                <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">Pipeline Runs</span>
                <span className="ml-2 text-xs text-spur-text-muted">{state.runs.length} run(s)</span>
            </div>
            {state.runs.length === 0 ? (
                <div className="p-4 text-sm text-spur-text-muted italic" data-tasks-empty>
                    No pipeline runs yet.
                </div>
            ) : (
                <ul className="flex-1 overflow-y-auto p-2 space-y-1">
                    {state.runs.map((run) => {
                        const wbs = state.wbsIndex.get(run.id);
                        const detailState = expandedRunId === run.id ? detailCache.get(run.id) : undefined;
                        return (
                            <RunRow
                                key={run.id}
                                run={run}
                                wbs={wbs}
                                expanded={expandedRunId === run.id}
                                detailState={detailState}
                                onToggle={toggleExpand}
                            />
                        );
                    })}
                </ul>
            )}

            {/* Secondary corpus lane (R4) */}
            {state.corpusEvents.length > 0 && (
                <div
                    className="border-t-2 border-dashed border-spur-border bg-base-300/50 shrink-0 max-h-64 overflow-y-auto"
                    data-corpus-lane
                >
                    <div className="px-4 py-2 border-b border-spur-border sticky top-0 bg-base-300/90 backdrop-blur">
                        <span className="text-xs font-semibold text-spur-text-muted uppercase tracking-wide">
                            Corpus Activity
                        </span>
                        <Badge variant="outline" size="xs" className="ml-2">
                            corpus-only
                        </Badge>
                        <span className="ml-2 text-xs text-spur-text-muted">{state.corpusEvents.length} event(s)</span>
                    </div>
                    <ul className="p-2 space-y-1">
                        {state.corpusEvents.map((evt) => (
                            <CorpusEventRow key={evt.id} evt={evt} />
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// RunRow - one pipeline run with expand (R1, R2, R3, R5)
// ---------------------------------------------------------------------------

function RunRow({
    run,
    wbs,
    expanded,
    detailState,
    onToggle,
}: {
    run: RunListEntry;
    wbs: string | undefined;
    expanded: boolean;
    detailState: RunDetailState | undefined;
    onToggle: (runId: string) => void;
}) {
    return (
        <li>
            <Card variant="compact" className="bg-base-200 border border-spur-border">
                <CardBody className="p-2 gap-1">
                    <button
                        type="button"
                        onClick={() => onToggle(run.id)}
                        className="w-full text-left flex items-center gap-2 flex-wrap cursor-pointer"
                        aria-expanded={expanded}
                    >
                        <span className="text-[10px] text-spur-text-muted">{expanded ? '▼' : '▶'}</span>
                        {wbs !== undefined ? (
                            <Badge variant="info" size="xs">
                                {wbs}
                            </Badge>
                        ) : (
                            <Badge variant="neutral" size="xs">
                                unlinked
                            </Badge>
                        )}
                        <span className="text-xs font-mono text-spur-text font-semibold">
                            {run.workflowName ?? 'unknown'}
                        </span>
                        <Badge variant={statusBadgeVariant(run.status)} size="xs">
                            {run.status}
                        </Badge>
                        {run.mode && (
                            <Badge variant="outline" size="xs">
                                {run.mode}
                            </Badge>
                        )}
                        {run.agent && <span className="text-[10px] text-spur-text-muted">{run.agent}</span>}
                        <span className="text-[10px] text-spur-text-muted ml-auto font-mono">
                            {formatLocalTime(run.startedAt)}
                        </span>
                    </button>

                    {/* Expanded detail (R2, R3, R5) */}
                    {expanded && detailState && (
                        <div className="mt-2 pl-4 border-l-2 border-spur-border">
                            {detailState.loading && (
                                <div className="flex items-center gap-2 text-xs text-spur-text-muted py-2">
                                    <Loading size="xs" /> Loading run detail…
                                </div>
                            )}
                            {detailState.error && (
                                <div className="text-xs text-error py-2" role="alert">
                                    Failed to load run detail: {detailState.error}
                                </div>
                            )}
                            {detailState.detail && <RunDetailPanel detail={detailState.detail} />}
                        </div>
                    )}
                </CardBody>
            </Card>
        </li>
    );
}

// ---------------------------------------------------------------------------
// RunDetailPanel - phases + transitions + actions (R2, R3)
// ---------------------------------------------------------------------------

function RunDetailPanel({ detail }: { detail: RunDetail }) {
    // Determine active phase: last non-terminal (R2)
    const activePhaseIdx = useMemo(() => {
        for (let i = detail.phases.length - 1; i >= 0; i--) {
            const phase = detail.phases[i];
            if (phase && !isTerminalPhase(phase.status)) return i;
        }
        return -1;
    }, [detail.phases]);

    return (
        <div className="space-y-3">
            {/* Phase progress (R2) */}
            {detail.phases.length > 0 && (
                <div>
                    <div className="text-[10px] uppercase text-spur-text-muted font-semibold mb-1">Phases</div>
                    <ol className="space-y-1">
                        {detail.phases.map((phase, idx) => {
                            const isActive = idx === activePhaseIdx;
                            const isFailed = isFailedPhase(phase.status);
                            const isDone = isTerminalPhase(phase.status);
                            return (
                                <li
                                    key={`phase:${phase.phase}`}
                                    className={`text-[11px] flex items-center gap-2 ${
                                        isFailed
                                            ? 'text-error'
                                            : isActive
                                              ? 'text-info font-semibold'
                                              : isDone
                                                ? 'text-spur-text-muted'
                                                : 'text-spur-text'
                                    }`}
                                >
                                    <span className="font-mono">
                                        {isDone ? (isFailed ? '✗' : '✓') : isActive ? '●' : '○'}
                                    </span>
                                    <span>{phase.phase}</span>
                                    <Badge
                                        variant={
                                            isFailed ? 'error' : isActive ? 'info' : isDone ? 'neutral' : 'warning'
                                        }
                                        size="xs"
                                    >
                                        {phase.status}
                                    </Badge>
                                    {phase.startedAt && (
                                        <span className="text-[10px] text-spur-text-muted font-mono">
                                            {formatLocalTime(phase.startedAt)}
                                        </span>
                                    )}
                                    {phase.completedAt && phase.startedAt && (
                                        <span className="text-[10px] text-spur-text-muted">
                                            → {formatLocalTime(phase.completedAt)}
                                        </span>
                                    )}
                                </li>
                            );
                        })}
                    </ol>
                </div>
            )}

            {/* Transitions strip */}
            {detail.transitions.length > 0 && (
                <div>
                    <div className="text-[10px] uppercase text-spur-text-muted font-semibold mb-1">Transitions</div>
                    <div className="flex items-center gap-1 flex-wrap text-[11px]">
                        {detail.transitions.map((tr, idx) => (
                            <span key={`tr:${tr.from}->${tr.to}`} className="flex items-center gap-1">
                                {idx > 0 && <span className="text-spur-text-muted">→</span>}
                                <Badge variant="outline" size="xs">
                                    {tr.from} → {tr.to}
                                </Badge>
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Action log (R3) */}
            {detail.actions.length > 0 && (
                <div>
                    <div className="text-[10px] uppercase text-spur-text-muted font-semibold mb-1">Action Log</div>
                    <ul className="space-y-1" data-action-log>
                        {detail.actions.map((action) => {
                            const dur = formatDuration(action.durationMs);
                            const failureReason =
                                action.ok === false ? extractFailureReason(action.resultSummary) : null;
                            return (
                                <li key={action.id} className="text-[11px] flex items-center gap-2 flex-wrap">
                                    <span className="font-mono text-spur-text">{action.node}</span>
                                    <Badge variant="outline" size="xs">
                                        {action.kind}
                                    </Badge>
                                    <Badge
                                        variant={
                                            action.ok === false ? 'error' : action.ok === true ? 'success' : 'neutral'
                                        }
                                        size="xs"
                                    >
                                        {action.status}
                                    </Badge>
                                    {dur !== null && <span className="text-spur-text-muted font-mono">{dur}</span>}
                                    {failureReason !== null && (
                                        <span className="text-error truncate max-w-md" title={failureReason}>
                                            {failureReason}
                                        </span>
                                    )}
                                    {action.startedAt && (
                                        <span className="text-[10px] text-spur-text-muted font-mono ml-auto">
                                            {formatLocalTime(action.startedAt)}
                                        </span>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            {detail.phases.length === 0 && detail.actions.length === 0 && detail.transitions.length === 0 && (
                <div className="text-xs text-spur-text-muted italic">No phase or action detail available.</div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// CorpusEventRow - secondary lane entry (R4)
// ---------------------------------------------------------------------------

function CorpusEventRow({ evt }: { evt: SystemEventRow }) {
    const entity = useMemo(() => {
        if (!evt.payload) return null;
        const entity = evt.payload.entity;
        if (entity !== null && typeof entity === 'object') {
            const id = (entity as Record<string, unknown>).id;
            if (typeof id === 'string') return id;
        }
        const id = evt.payload.id ?? evt.payload.wbs;
        return typeof id === 'string' ? id : null;
    }, [evt.payload]);

    return (
        <li className="text-[11px] flex items-center gap-2 flex-wrap text-spur-text-muted">
            <span className="font-mono text-[10px]">{formatLocalTime(evt.occurredAt)}</span>
            <Badge variant="outline" size="xs">
                {evt.eventName}
            </Badge>
            {entity !== null && <span className="font-mono">{entity}</span>}
            {evt.actor && <span className="text-[10px]">{evt.actor}</span>}
        </li>
    );
}
