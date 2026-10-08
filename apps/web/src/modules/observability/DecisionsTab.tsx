import type { DecisionLogListResponse, DecisionLogRow } from '@gobing-ai/spur-contracts';
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Input, Loading, Select } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import DecisionDetailDrawer from './DecisionDetailDrawer';
import { DECISION_RETENTION_COPY, RetentionBadge, SegmentedToggle, timeRangeSince } from './ObservabilityFilters';
import { KpiCard } from './SummaryTab';
import { formatDuration } from './SystemEventsTab';
import type { ObservabilityTabProps } from './tabs';

type OutcomeFilter = 'all' | 'accepted' | 'fallback' | 'rejected';

function outcomeBadgeVariant(outcome: string): 'success' | 'warning' | 'error' {
    switch (outcome) {
        case 'accepted':
            return 'success';
        case 'fallback':
            return 'warning';
        default:
            return 'error';
    }
}

function pct(rate: number): string {
    return `${Math.round(rate * 100)}%`;
}

/** Compact rendered value: parsed JSON is re-stringified compactly, raw text truncates. */
function valueSnippet(value: string | null): string {
    if (value === null || value === '') return '—';
    let text = value;
    try {
        text = JSON.stringify(JSON.parse(value));
    } catch {
        /* raw text */
    }
    return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

const FacetSelect: FC<{
    label: string;
    value: string;
    options: string[];
    onChange: (next: string) => void;
}> = ({ label, value, options, onChange }) => (
    <Select value={value} onChange={(e) => onChange(e.target.value)} size="sm" aria-label={label}>
        <option value="">{label}: all</option>
        {options.map((opt) => (
            <option key={opt} value={opt}>
                {opt}
            </option>
        ))}
    </Select>
);

/** Caller values the decisions API accepts (apps/server observability route validation). */
const DECISION_CALLERS = ['cli', 'workflow', 'gate'];

/** Board Decisions tab (task 1100 §3.6): decision log KPIs, filters, newest-first list. */
export default function DecisionsTab({ timeRange, onNavigate }: ObservabilityTabProps) {
    const [data, setData] = useState<DecisionLogListResponse | null>(null);
    const [rows, setRows] = useState<DecisionLogRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [outcome, setOutcome] = useState<OutcomeFilter>('all');
    const [decisionId, setDecisionId] = useState('');
    const [maker, setMaker] = useState('');
    const [caller, setCaller] = useState('');
    const [runId, setRunId] = useState('');
    const [selected, setSelected] = useState<DecisionLogRow | null>(null);
    // Bumped by the Refresh button (DESIGN.md:462-466); see `listQuery`.
    const [refreshKey, setRefreshKey] = useState(0);
    const fetchIdRef = useRef(0);
    const nextCursorRef = useRef<string | null>(null);
    const openerRef = useRef<HTMLTableRowElement | null>(null);

    /** Open a row's drawer, remembering the activating row for focus return (DESIGN.md:493). */
    const openDetail = (row: DecisionLogRow, opener: HTMLTableRowElement) => {
        openerRef.current = opener;
        setSelected(row);
    };

    const closeDrawer = useCallback(() => {
        setSelected(null);
        openerRef.current?.focus();
    }, []);

    /**
     * The list fetch's inputs. `generation` makes a Refresh click a real input to the effect
     * (same idiom as FeatureDetail's `loadTarget`): it refetches with the current filters.
     */
    const listQuery = useMemo(
        () => ({ timeRange, outcome, decisionId, maker, caller, runId, generation: refreshKey }),
        [timeRange, outcome, decisionId, maker, caller, runId, refreshKey],
    );

    useEffect(() => {
        const { timeRange, outcome, decisionId, maker, caller, runId } = listQuery;
        const controller = new AbortController();
        const fetchId = ++fetchIdRef.current;
        setLoading(true);
        setError(null);

        (async () => {
            try {
                const params = new URLSearchParams();
                const since = timeRangeSince(timeRange);
                if (since) params.set('since', since);
                if (outcome !== 'all') params.set('outcome', outcome);
                if (decisionId !== '') params.set('decision', decisionId);
                if (maker !== '') params.set('maker', maker);
                if (caller !== '') params.set('caller', caller);
                if (runId !== '') params.set('run', runId);
                params.set('limit', '100');

                const res = await fetchWithTimeout(
                    new Request(`${resolveApiUrl()}/observability/decisions?${params.toString()}`, {
                        signal: controller.signal,
                    }),
                );
                if (!res.ok) {
                    const text = await res.text();
                    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
                }
                const payload = (await res.json()) as DecisionLogListResponse;
                if (controller.signal.aborted || fetchId !== fetchIdRef.current) return;
                setRows(payload.rows);
                setData(payload);
                nextCursorRef.current = payload.nextCursor;
            } catch (err) {
                if (controller.signal.aborted || fetchId !== fetchIdRef.current) return;
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                if (!controller.signal.aborted && fetchId === fetchIdRef.current) setLoading(false);
            }
        })();

        return () => controller.abort();
    }, [listQuery]);

    const loadOlder = async () => {
        if (nextCursorRef.current === null || loadingOlder) return;
        const controller = new AbortController();
        setLoadingOlder(true);
        try {
            const params = new URLSearchParams();
            const since = timeRangeSince(timeRange);
            if (since) params.set('since', since);
            if (outcome !== 'all') params.set('outcome', outcome);
            if (decisionId !== '') params.set('decision', decisionId);
            if (maker !== '') params.set('maker', maker);
            if (caller !== '') params.set('caller', caller);
            if (runId !== '') params.set('run', runId);
            params.set('limit', '100');
            params.set('before', nextCursorRef.current);
            const res = await fetchWithTimeout(
                new Request(`${resolveApiUrl()}/observability/decisions?${params.toString()}`, {
                    signal: controller.signal,
                }),
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const payload = (await res.json()) as DecisionLogListResponse;
            if (controller.signal.aborted) return;
            setRows((prev) => [...prev, ...payload.rows]);
            nextCursorRef.current = payload.nextCursor;
        } catch (err) {
            if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
        } finally {
            if (!controller.signal.aborted) setLoadingOlder(false);
        }
    };

    const summary = data?.summary;

    return (
        <div className="flex flex-col gap-4" data-testid="observability-decisions-tab">
            {/* Controls bar */}
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                    <SegmentedToggle
                        label="Outcome"
                        value={outcome}
                        onChange={setOutcome}
                        options={[
                            { value: 'all', label: 'All' },
                            { value: 'accepted', label: 'Accepted' },
                            { value: 'fallback', label: 'Fallback' },
                            { value: 'rejected', label: 'Rejected' },
                        ]}
                    />
                    <FacetSelect
                        label="Decision"
                        value={decisionId}
                        options={data?.facets.decisionIds ?? []}
                        onChange={setDecisionId}
                    />
                    <FacetSelect label="Maker" value={maker} options={data?.facets.makers ?? []} onChange={setMaker} />
                    <FacetSelect label="Caller" value={caller} options={DECISION_CALLERS} onChange={setCaller} />
                    <Input
                        type="text"
                        placeholder="Run id"
                        aria-label="Filter by run id"
                        value={runId}
                        onChange={(e) => setRunId(e.target.value)}
                        size="xs"
                        className="w-40 font-mono"
                    />
                    <Button
                        variant="ghost"
                        size="xs"
                        disabled={loading}
                        onClick={() => setRefreshKey((k) => k + 1)}
                        aria-label="Refresh decisions"
                        data-testid="decisions-refresh-btn"
                    >
                        Refresh
                    </Button>
                </div>
                <RetentionBadge copy={DECISION_RETENTION_COPY} />
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="decisions-kpi-strip">
                <KpiCard
                    label="Invocations"
                    value={(summary?.count ?? 0).toLocaleString()}
                    sub="in window"
                    current={0}
                    previous={undefined}
                    testId="kpi-card-decision-invocations"
                />
                <KpiCard
                    label="Accepted"
                    value={pct(summary?.acceptedRate ?? 0)}
                    sub="model answered"
                    current={0}
                    previous={undefined}
                    testId="kpi-card-decision-accepted-rate"
                />
                <KpiCard
                    label="Fallback"
                    value={pct(summary?.fallbackRate ?? 0)}
                    sub="declared fallback used"
                    current={0}
                    previous={undefined}
                    invert
                    testId="kpi-card-decision-fallback-rate"
                />
                <KpiCard
                    label="p95 Duration"
                    value={
                        summary?.p95DurationMs !== null && summary?.p95DurationMs !== undefined
                            ? (formatDuration(summary.p95DurationMs) ?? '—')
                            : '—'
                    }
                    sub="per invocation"
                    current={0}
                    previous={undefined}
                    testId="kpi-card-decision-p95"
                />
            </div>

            {/* Decisions table */}
            <div className="rounded-xl border border-base-content/10 bg-base-200/50 shadow-xs overflow-hidden flex flex-col">
                <div className="px-4 py-3 border-b border-base-content/10 bg-base-200 flex items-center justify-between flex-wrap gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                        Decision Invocations
                    </span>
                    <span className="text-xs text-base-content/50 font-mono">
                        Showing {rows.length} of {summary?.count ?? 0} row(s)
                    </span>
                </div>

                {error ? (
                    <div className="p-4 text-xs text-error" role="alert" data-testid="decisions-table-error">
                        Failed to load decisions: {error}
                    </div>
                ) : loading && rows.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-base-content/50 text-sm">
                        <Loading size="md" />
                    </div>
                ) : rows.length === 0 ? (
                    <div className="p-8 text-center text-sm text-base-content/50" data-testid="decisions-empty">
                        No decision invocations recorded in this window.
                        <div className="mt-1 text-xs">
                            Hint: run <code className="font-mono">spur decision run</code> to record one.
                        </div>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="table table-sm" data-testid="decisions-table">
                            <thead>
                                <tr className="text-xs text-base-content/60 border-base-content/10">
                                    <th>Decision</th>
                                    <th>Outcome</th>
                                    <th>Value</th>
                                    <th>Maker</th>
                                    <th>Reason</th>
                                    <th className="text-right">Duration</th>
                                    <th>Started</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr
                                        key={row.id}
                                        tabIndex={0}
                                        aria-haspopup="dialog"
                                        className="hover:bg-base-200/70 cursor-pointer border-base-content/10 focus:outline-none focus:bg-base-200/70"
                                        onClick={(e) => openDetail(row, e.currentTarget)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                openDetail(row, e.currentTarget);
                                            }
                                        }}
                                        data-testid="decision-row"
                                    >
                                        <td className="font-mono text-xs font-semibold">{row.decisionId}</td>
                                        <td>
                                            <Badge variant={outcomeBadgeVariant(row.outcome)} size="sm">
                                                {row.outcome}
                                            </Badge>
                                        </td>
                                        <td
                                            className="font-mono text-xs max-w-[16rem] truncate"
                                            title={row.value ?? ''}
                                        >
                                            {valueSnippet(row.value)}
                                        </td>
                                        <td className="text-xs">{row.makerName ?? '—'}</td>
                                        <td className="text-xs text-base-content/60">{row.reason ?? '—'}</td>
                                        <td className="text-right font-mono text-xs">
                                            {formatDuration(row.durationMs) ?? '—'}
                                        </td>
                                        <td className="text-xs text-base-content/60 whitespace-nowrap">
                                            {new Date(row.startedAt).toLocaleString()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {nextCursorRef.current !== null && rows.length > 0 && (
                    <div className="p-3 border-t border-base-content/10 flex justify-center">
                        <button
                            type="button"
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-base-content/20 hover:bg-base-200 transition-colors cursor-pointer"
                            data-testid="load-older-decisions"
                            onClick={() => void loadOlder()}
                            disabled={loadingOlder}
                        >
                            {loadingOlder ? 'Loading…' : 'Load older'}
                        </button>
                    </div>
                )}
            </div>

            <DecisionDetailDrawer row={selected} onClose={closeDrawer} onNavigate={onNavigate} />
        </div>
    );
}
