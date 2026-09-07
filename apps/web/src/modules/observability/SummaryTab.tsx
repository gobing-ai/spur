import type { ObservabilitySummaryResponse } from '@gobing-ai/spur-contracts';
import { type FC, memo, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import {
    type ChartSeries,
    fmtBucketLabel,
    fmtInt,
    Sparkline,
    type StackedColumnBucket,
    StackedColumnsChart,
} from '../history/charts';
import { timeRangeSince } from './ObservabilityFilters';
import type { ObservabilityTabProps } from './tabs';

// ─── Color Palettes ──────────────────────────────────────────────────────────

const PREFIX_COLORS: Record<string, string> = {
    system: '#38bdf8',
    task: '#818cf8',
    feature: '#a78bfa',
    queue: '#f59e0b',
    scheduler: '#10b981',
    rule: '#ec4899',
    agent: '#06b6d4',
    history: '#64748b',
};

const PALETTE = ['#38bdf8', '#818cf8', '#a78bfa', '#f59e0b', '#10b981', '#ec4899', '#06b6d4', '#f43f5e', '#64748b'];

function getPrefixColor(prefix: string): string {
    const direct = PREFIX_COLORS[prefix];
    if (direct) return direct;
    let hash = 0;
    for (let i = 0; i < prefix.length; i++) {
        hash = (hash << 5) - hash + prefix.charCodeAt(i);
        hash |= 0;
    }
    const idx = Math.abs(hash) % PALETTE.length;
    return PALETTE[idx] ?? '#38bdf8';
}

// ─── Delta Badge & KPI Card ──────────────────────────────────────────────────

const deltaPct = (current: number, previous: number | undefined): number | null => {
    if (previous === undefined || previous === 0) return null;
    return ((current - previous) / Math.abs(previous)) * 100;
};

export const DeltaBadge: FC<{ current: number; previous: number | undefined; invert?: boolean }> = memo(
    ({ current, previous, invert = false }) => {
        if (previous === undefined) {
            return <span className="text-[10px] text-base-content/40">No prior baseline</span>;
        }
        if (previous === 0) {
            return (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold font-mono bg-info/15 text-info">new</span>
            );
        }
        const delta = deltaPct(current, previous);
        if (delta === null) {
            return <span className="text-[10px] text-base-content/40">No prior baseline</span>;
        }
        const up = delta >= 0;
        const good = invert ? !up : up;
        return (
            <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                    good ? 'bg-emerald-500/15 text-emerald-400' : 'bg-error/15 text-error'
                }`}
            >
                {up ? '↑ +' : '↓ '}
                {Math.abs(delta).toFixed(1)}% vs previous period
            </span>
        );
    },
);

const KpiCard: FC<{
    label: string;
    value: string;
    sub: string;
    trend?: number[];
    trendColor?: string;
    current: number;
    previous: number | undefined;
    invert?: boolean;
    testId?: string;
}> = memo(({ label, value, sub, trend, trendColor = '#38bdf8', current, previous, invert, testId }) => (
    <div className="bg-base-200 rounded-xl shadow-xs border border-base-content/10 p-4" data-testid={testId}>
        <div className="flex justify-between items-center">
            <span className="text-xs font-semibold uppercase tracking-wider text-base-content/60">{label}</span>
        </div>
        <div className="flex items-end justify-between gap-2 mt-1">
            <div>
                <div className="text-2xl font-bold font-mono text-primary">{value}</div>
                <div className="flex items-center gap-1.5 mt-1">
                    <DeltaBadge current={current} previous={previous} invert={invert} />
                    <span className="text-xs text-base-content/60">{sub}</span>
                </div>
            </div>
            {trend && trend.length > 1 ? <Sparkline values={trend} color={trendColor} width={100} height={34} /> : null}
        </div>
    </div>
));

// ─── Main Component ──────────────────────────────────────────────────────────

export default function SummaryTab(props: ObservabilityTabProps) {
    const fetchIdRef = useRef(0);
    const [data, setData] = useState<ObservabilitySummaryResponse | null>(null);
    const [prevData, setPrevData] = useState<ObservabilitySummaryResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const timeRange = props.timeRange ?? '4h';

    useEffect(() => {
        const fetchId = ++fetchIdRef.current;
        const controller = new AbortController();
        setLoading(true);
        setError(null);

        async function fetchSummary() {
            try {
                const nowMs = Date.now();
                const sinceIso = timeRangeSince(timeRange, nowMs);
                const untilIso = new Date(nowMs).toISOString();

                let currentUrl = `${resolveApiUrl()}/observability/summary`;
                if (sinceIso) {
                    const params = new URLSearchParams({ since: sinceIso, until: untilIso });
                    currentUrl += `?${params.toString()}`;
                }

                const currentPromise = fetchWithTimeout(new Request(currentUrl, { signal: controller.signal }), 10_000);

                // Previous window request (best-effort)
                let prevPromise: Promise<Response | null> = Promise.resolve(null);
                if (sinceIso) {
                    const sinceMs = new Date(sinceIso).getTime();
                    const widthMs = nowMs - sinceMs;
                    const prevSinceIso = new Date(sinceMs - widthMs).toISOString();
                    const prevUntilIso = sinceIso;
                    const prevParams = new URLSearchParams({
                        since: prevSinceIso,
                        until: prevUntilIso,
                        period: 'previous',
                    });
                    const prevUrl = `${resolveApiUrl()}/observability/summary?${prevParams.toString()}`;
                    prevPromise = fetchWithTimeout(new Request(prevUrl, { signal: controller.signal }), 10_000).catch(
                        () => null,
                    );
                }

                const [currentRes, prevRes] = await Promise.all([currentPromise, prevPromise]);

                if (fetchId !== fetchIdRef.current) return;

                if (!currentRes.ok) {
                    const errText = await currentRes.text();
                    throw new Error(`HTTP ${currentRes.status}: ${errText || currentRes.statusText}`);
                }

                const currentJson = (await currentRes.json()) as ObservabilitySummaryResponse;
                let prevJson: ObservabilitySummaryResponse | null = null;
                if (prevRes?.ok) {
                    try {
                        prevJson = (await prevRes.json()) as ObservabilitySummaryResponse;
                    } catch {
                        // ignore malformed previous window
                    }
                }

                if (fetchId !== fetchIdRef.current) return;

                setData(currentJson);
                setPrevData(prevJson);
                setLoading(false);
            } catch (err: unknown) {
                if (controller.signal.aborted) return;
                if (fetchId !== fetchIdRef.current) return;
                setError(err instanceof Error ? err.message : String(err));
                setLoading(false);
            }
        }

        fetchSummary();

        return () => {
            controller.abort();
        };
    }, [timeRange]);

    // Stacked chart series & buckets derivation
    const { series, chartBuckets } = useMemo(() => {
        const buckets = data?.eventVolumeBuckets ?? [];
        const prefixTotals: Record<string, number> = {};
        for (const b of buckets) {
            for (const [p, count] of Object.entries(b.byPrefix)) {
                prefixTotals[p] = (prefixTotals[p] ?? 0) + count;
            }
        }
        const sortedPrefixes = Object.keys(prefixTotals).sort(
            (a, b) => (prefixTotals[b] ?? 0) - (prefixTotals[a] ?? 0),
        );
        const s: ChartSeries[] = sortedPrefixes.map((prefix) => ({
            id: prefix,
            label: prefix,
            color: getPrefixColor(prefix),
        }));
        const cb: StackedColumnBucket[] = buckets.map((b) => ({
            id: b.timestamp,
            label: fmtBucketLabel(b.timestamp),
            v: b.byPrefix,
        }));
        return { series: s, chartBuckets: cb };
    }, [data?.eventVolumeBuckets]);

    // Severity distribution aggregates
    const totalSeverity = useMemo(() => {
        const counts = { info: 0, warning: 0, error: 0, unknown: 0 };
        for (const b of data?.eventVolumeBuckets ?? []) {
            counts.info += b.bySeverity.info;
            counts.warning += b.bySeverity.warning;
            counts.error += b.bySeverity.error;
            counts.unknown += b.bySeverity.unknown;
        }
        const sum = counts.info + counts.warning + counts.error + counts.unknown;
        return { counts, sum };
    }, [data?.eventVolumeBuckets]);

    if (loading) {
        return (
            <div className="flex flex-col gap-6 animate-pulse" data-testid="observability-summary-tab" data-summary-tab>
                <div
                    data-testid="observability-summary-skeleton"
                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
                >
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-24 bg-base-200/60 rounded-xl" />
                    ))}
                </div>
                <div className="h-64 bg-base-200/60 rounded-xl" />
            </div>
        );
    }

    if (error) {
        return (
            <div
                className="p-4 rounded-lg bg-error/10 border border-error/20 text-error"
                data-testid="observability-summary-error"
                data-summary-tab
            >
                <span>Failed to load observability summary: {error}</span>
            </div>
        );
    }

    const kpis = data?.kpis ?? {
        totalEvents: 0,
        activeJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        successRatePct: 0,
        errorEventCount: 0,
        warningEventCount: 0,
    };
    const prevKpis = prevData?.kpis;

    // `data?.X.map(...)` only guards `data` itself; a malformed summary payload
    // (e.g. a catch-all mock returning `[]`) leaves `eventVolumeBuckets` undefined
    // and crashes on `.map`. Normalize to an array first so the render never throws.
    const volumeBuckets = data?.eventVolumeBuckets ?? [];
    const eventSparkline = volumeBuckets.map((b) => b.total);
    const errorWarningSparkline = volumeBuckets.map((b) => b.bySeverity.error + b.bySeverity.warning);

    const handleNavigateToJob = (jobId: string) => {
        props.onNavigate?.({ tab: 'jobs', jobId });
    };

    const handleNavigateToEvent = (name: string, refId?: string) => {
        props.onNavigate?.({ tab: 'system-events', eventName: name, runId: refId });
    };

    return (
        <div className="flex flex-col gap-6" data-testid="observability-summary-tab" data-summary-tab>
            {/* 4 KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                    label="Total Events"
                    value={fmtInt(kpis.totalEvents)}
                    sub="events in window"
                    trend={eventSparkline}
                    trendColor="#38bdf8"
                    current={kpis.totalEvents}
                    previous={prevKpis?.totalEvents}
                    testId="kpi-card-total-events"
                />
                <KpiCard
                    label="Active In-Flight Jobs"
                    value={fmtInt(kpis.activeJobs)}
                    sub="pending & processing"
                    current={kpis.activeJobs}
                    previous={prevKpis?.activeJobs}
                    testId="kpi-card-active-jobs"
                />
                <KpiCard
                    label="Success Rate"
                    value={`${kpis.successRatePct}%`}
                    sub={`${kpis.completedJobs} ok / ${kpis.failedJobs} fail`}
                    current={kpis.successRatePct}
                    previous={prevKpis?.successRatePct}
                    testId="kpi-card-success-rate"
                />
                <KpiCard
                    label="Errors & Warnings"
                    value={`${kpis.errorEventCount} / ${kpis.warningEventCount}`}
                    sub="error / warning events"
                    trend={errorWarningSparkline}
                    trendColor="#ef4444"
                    current={kpis.errorEventCount + kpis.warningEventCount}
                    previous={prevKpis ? prevKpis.errorEventCount + prevKpis.warningEventCount : undefined}
                    invert
                    testId="kpi-card-errors-warnings"
                />
            </div>

            {/* Event Volume Trend Stacked Column Chart */}
            <div className="bg-base-200 rounded-xl border border-base-content/10 p-4 flex flex-col gap-3">
                <div className="flex justify-between items-center">
                    <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-base-content/60">
                            Event Volume Over Time
                        </h3>
                        <p className="text-xs text-base-content/60 mt-0.5">Distribution stacked by event prefix</p>
                    </div>
                </div>
                {chartBuckets.length > 0 && series.length > 0 ? (
                    <div className="mt-2" data-testid="stacked-event-volume-chart">
                        <StackedColumnsChart buckets={chartBuckets} series={series} height={240} />
                    </div>
                ) : (
                    <div className="p-8 text-center text-xs text-base-content/50" data-testid="empty-chart-fallback">
                        No event activity recorded in this time range.
                    </div>
                )}
            </div>

            {/* Severity Distribution Bar */}
            <div className="bg-base-200 rounded-xl border border-base-content/10 p-4 flex flex-col gap-2">
                <div className="flex justify-between items-center text-xs font-semibold uppercase tracking-wider text-base-content/60">
                    <span>Severity Distribution</span>
                    <span>{totalSeverity.sum.toLocaleString()} classified events</span>
                </div>
                <div
                    className="w-full h-3 rounded-full bg-base-300 overflow-hidden flex"
                    data-testid="severity-distribution-bar"
                >
                    {totalSeverity.sum > 0 ? (
                        <>
                            {totalSeverity.counts.info > 0 && (
                                <div
                                    style={{ width: `${(totalSeverity.counts.info / totalSeverity.sum) * 100}%` }}
                                    className="bg-info h-full"
                                    title={`Info: ${totalSeverity.counts.info}`}
                                    data-testid="severity-bar-info"
                                />
                            )}
                            {totalSeverity.counts.warning > 0 && (
                                <div
                                    style={{ width: `${(totalSeverity.counts.warning / totalSeverity.sum) * 100}%` }}
                                    className="bg-warning h-full"
                                    title={`Warning: ${totalSeverity.counts.warning}`}
                                    data-testid="severity-bar-warning"
                                />
                            )}
                            {totalSeverity.counts.error > 0 && (
                                <div
                                    style={{ width: `${(totalSeverity.counts.error / totalSeverity.sum) * 100}%` }}
                                    className="bg-error h-full"
                                    title={`Error: ${totalSeverity.counts.error}`}
                                    data-testid="severity-bar-error"
                                />
                            )}
                            {totalSeverity.counts.unknown > 0 && (
                                <div
                                    style={{ width: `${(totalSeverity.counts.unknown / totalSeverity.sum) * 100}%` }}
                                    className="bg-base-content/20 h-full"
                                    title={`Unknown: ${totalSeverity.counts.unknown}`}
                                    data-testid="severity-bar-unknown"
                                />
                            )}
                        </>
                    ) : (
                        <div className="w-full h-full bg-base-content/10" />
                    )}
                </div>
                <div className="flex flex-wrap gap-4 text-xs text-base-content/70 mt-1">
                    <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-info inline-block" /> Info:{' '}
                        {totalSeverity.counts.info.toLocaleString()}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-warning inline-block" /> Warning:{' '}
                        {totalSeverity.counts.warning.toLocaleString()}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-error inline-block" /> Error:{' '}
                        {totalSeverity.counts.error.toLocaleString()}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-base-content/20 inline-block" /> Unknown:{' '}
                        {totalSeverity.counts.unknown.toLocaleString()}
                    </span>
                </div>
            </div>

            {/* Hotspots: Top Event Types & Recent Failures */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Top Event Types */}
                <div className="bg-base-200 rounded-xl border border-base-content/10 p-4 flex flex-col gap-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-base-content/60">
                        Top Event Types
                    </h3>
                    <div className="overflow-x-auto">
                        <table className="table table-xs w-full font-mono text-xs" data-testid="top-event-types-table">
                            <thead>
                                <tr className="border-b border-base-content/10 text-base-content/60">
                                    <th>Event Name</th>
                                    <th>Prefix</th>
                                    <th className="text-right">Count</th>
                                    <th className="text-right">Latest</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(data?.topEventTypes ?? []).map((t) => (
                                    <tr key={t.name} className="hover:bg-base-300/40">
                                        <td className="font-semibold text-base-content">{t.name}</td>
                                        <td>
                                            <span
                                                className="px-1.5 py-0.5 rounded text-[10px] font-bold border"
                                                style={{
                                                    color: getPrefixColor(t.prefix),
                                                    borderColor: getPrefixColor(t.prefix),
                                                }}
                                            >
                                                {t.prefix}
                                            </span>
                                        </td>
                                        <td className="text-right text-base-content/80">{t.count.toLocaleString()}</td>
                                        <td className="text-right text-base-content/50">
                                            {new Date(t.latestAt).toLocaleTimeString()}
                                        </td>
                                    </tr>
                                ))}
                                {(!data || (data.topEventTypes ?? []).length === 0) && (
                                    <tr>
                                        <td colSpan={4} className="text-center text-base-content/40 py-4">
                                            No events recorded
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Recent Failures */}
                <div className="bg-base-200 rounded-xl border border-base-content/10 p-4 flex flex-col gap-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-base-content/60">
                        Recent Failures
                    </h3>
                    <div
                        className="flex flex-col gap-2 max-h-[320px] overflow-y-auto"
                        data-testid="recent-failures-feed"
                    >
                        {(data?.recentErrors ?? []).map((err) => {
                            const isClickable = Boolean(props.onNavigate);
                            const handleClick = () => {
                                if (err.source === 'job') {
                                    handleNavigateToJob(err.id);
                                } else {
                                    handleNavigateToEvent(err.name, err.refId);
                                }
                            };

                            const rowContent = (
                                <>
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-1.5">
                                            <Badge size="xs" variant={err.source === 'job' ? 'warning' : 'error'}>
                                                {err.source}
                                            </Badge>
                                            <span className="font-mono text-xs font-semibold text-base-content">
                                                {err.name}
                                            </span>
                                        </div>
                                        <span className="text-[11px] text-base-content/50 font-mono">
                                            {new Date(err.occurredAt).toLocaleTimeString()}
                                        </span>
                                    </div>
                                    <p className="text-xs text-error font-mono truncate">{err.message}</p>
                                </>
                            );

                            if (isClickable) {
                                return (
                                    <button
                                        type="button"
                                        key={`${err.source}-${err.id}-${err.occurredAt}`}
                                        className="w-full text-left p-2.5 rounded-lg border border-base-content/10 bg-base-100 flex flex-col gap-1 transition-colors hover:bg-base-200/80 cursor-pointer"
                                        onClick={handleClick}
                                        data-testid={`failure-row-${err.source}-${err.id}`}
                                    >
                                        {rowContent}
                                    </button>
                                );
                            }

                            return (
                                <div
                                    key={`${err.source}-${err.id}-${err.occurredAt}`}
                                    className="p-2.5 rounded-lg border border-base-content/10 bg-base-100 flex flex-col gap-1"
                                    data-testid={`failure-row-${err.source}-${err.id}`}
                                >
                                    {rowContent}
                                </div>
                            );
                        })}
                        {(!data || (data.recentErrors ?? []).length === 0) && (
                            <div className="p-8 text-center text-xs text-base-content/50">
                                No recent failures in this time range.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
