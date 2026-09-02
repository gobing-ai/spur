import type {
    HistoryBucket,
    HistoryDimension,
    HistorySummaryResponse,
    HistoryTopItem,
} from '@gobing-ai/spur-contracts';
import type React from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import {
    type ChartSeries,
    fmtBucketLabel,
    fmtBucketTooltip,
    fmtInt,
    fmtPct,
    fmtTok,
    SparkBar,
    Sparkline,
    StackedAreaChart,
    type StackedColumnBucket,
    StackedColumnsChart,
} from './charts';

export interface SummaryTabProps {
    data?: HistorySummaryResponse['data'];
    loading?: boolean;
    error?: string | null;
    dimension?: HistoryDimension;
    onDimensionChange?: (dimension: HistoryDimension) => void;
    bucket?: HistoryBucket;
    onBucketChange?: (bucket: HistoryBucket) => void;
    loopSummary?: { count: number; redundantCalls: number; wastedTokens: number };
}

const BUCKET_OPTIONS: HistoryBucket[] = ['auto', '1m', '3m', '5m', '10m', '30m', '1h', '4h', '1d'];
const SERIES_COLORS = [
    '#3987e5',
    '#199e70',
    '#d95926',
    '#9085e9',
    '#c98500',
    '#ec4899',
    '#8b5cf6',
    '#06b6d4',
    '#f59e0b',
    '#10b981',
];

const deltaPct = (current: number, previous: number | undefined): number | null => {
    if (previous === undefined || previous === 0) return null;
    return ((current - previous) / Math.abs(previous)) * 100;
};

const DeltaBadge: React.FC<{ current: number; previous: number | undefined; invert?: boolean }> = memo(
    ({ current, previous, invert = false }) => {
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

const KpiCard: React.FC<{
    label: string;
    value: string;
    sub: string;
    trend: number[];
    trendColor: string;
    current: number;
    previous: number | undefined;
    invert?: boolean;
    badge?: React.ReactNode;
}> = memo(({ label, value, sub, trend, trendColor, current, previous, invert, badge }) => (
    <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-4">
        <div className="flex justify-between items-center">
            <span className="text-xs font-semibold uppercase tracking-wider text-base-content/60">{label}</span>
            {badge}
        </div>
        <div className="flex items-end justify-between gap-2 mt-1">
            <div>
                <div className="text-2xl font-bold font-mono text-primary">{value}</div>
                <div className="flex items-center gap-1.5 mt-1">
                    <DeltaBadge current={current} previous={previous} invert={invert} />
                    <span className="text-xs text-base-content/60">{sub}</span>
                </div>
            </div>
            {trend.length > 1 && <Sparkline values={trend} color={trendColor} width={100} height={34} />}
        </div>
    </div>
));

interface SummaryDimensionBlockProps {
    title: string;
    description: string;
    series: ChartSeries[];
    buckets: StackedColumnBucket[];
    chartMode: 'chart' | 'table';
    onToggleChartMode: () => void;
    testId?: string;
}

const SummaryDimensionBlock: React.FC<SummaryDimensionBlockProps> = memo(
    ({ title, description, series, buckets, chartMode, onToggleChartMode, testId }) => {
        const hasData =
            buckets.length > 0 && series.length > 0 && buckets.some((b) => Object.values(b.v).some((v) => v > 0));

        return (
            <div
                className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5 flex flex-col gap-3 w-full"
                data-testid={testId}
            >
                <div className="flex flex-wrap justify-between items-center gap-2 pb-2 border-b border-base-content/10">
                    <div>
                        <h4 className="font-bold text-sm text-base-content flex items-center gap-2">
                            {title}
                            <span className="text-[11px] font-normal text-base-content/60 font-mono">
                                ({series.length} {series.length === 1 ? 'tracked' : 'tracked'})
                            </span>
                        </h4>
                        <p className="text-[11px] text-base-content/60">{description}</p>
                    </div>
                    <div className="flex items-center gap-1 bg-base-300 p-0.5 rounded-lg text-xs">
                        <button
                            type="button"
                            aria-pressed={chartMode === 'chart'}
                            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                                chartMode === 'chart'
                                    ? 'bg-base-100 text-base-content font-bold shadow-xs'
                                    : 'text-base-content/60 hover:bg-base-content/10'
                            }`}
                            onClick={() => chartMode !== 'chart' && onToggleChartMode()}
                        >
                            Chart
                        </button>
                        <button
                            type="button"
                            aria-pressed={chartMode === 'table'}
                            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                                chartMode === 'table'
                                    ? 'bg-base-100 text-base-content font-bold shadow-xs'
                                    : 'text-base-content/60 hover:bg-base-content/10'
                            }`}
                            onClick={() => chartMode !== 'table' && onToggleChartMode()}
                        >
                            Table
                        </button>
                    </div>
                </div>

                {/* Chart or Table or Empty State */}
                <div className="min-h-[220px]">
                    {chartMode === 'table' && buckets.length > 0 && series.length > 0 ? (
                        <div className="overflow-x-auto max-h-72 overflow-y-auto">
                            <table className="w-full text-xs text-left font-mono" data-testid="summary-bucket-table">
                                <thead className="sticky top-0 bg-base-200">
                                    <tr className="border-b border-base-content/10 text-base-content/60">
                                        <th className="py-1.5 pr-2">Bucket</th>
                                        {series.map((s) => (
                                            <th key={s.id} className="py-1.5 pr-2 text-right">
                                                <span className="inline-flex items-center gap-1">
                                                    <span
                                                        className="w-2 h-2 rounded-full inline-block shrink-0"
                                                        style={{ background: s.color }}
                                                    />
                                                    {s.label}
                                                </span>
                                            </th>
                                        ))}
                                        <th className="py-1.5 pr-2 text-right">Total</th>
                                        <th className="py-1.5 text-right">Cache Hit %</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {buckets.map((b) => {
                                        const total = Object.values(b.v).reduce((sum, v) => sum + v, 0);
                                        return (
                                            <tr
                                                key={b.id ?? b.label}
                                                className="border-b border-base-content/5 hover:bg-base-300/30"
                                            >
                                                <td className="py-1.5 pr-2 font-bold">
                                                    {fmtBucketTooltip(b.id ?? b.label)}
                                                </td>
                                                {series.map((s) => (
                                                    <td key={s.id} className="py-1.5 pr-2 text-right tabular-nums">
                                                        {b.v[s.id] !== undefined ? fmtTok(b.v[s.id] ?? 0) : '—'}
                                                    </td>
                                                ))}
                                                <td className="py-1.5 pr-2 text-right tabular-nums font-bold">
                                                    {fmtTok(total)}
                                                </td>
                                                <td className="py-1.5 text-right tabular-nums">
                                                    {b.lineValue !== undefined ? `${b.lineValue.toFixed(1)}%` : '—'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : hasData ? (
                        <StackedColumnsChart buckets={buckets} series={series} height={220} />
                    ) : buckets.length > 0 && series.length > 0 ? (
                        <div className="flex flex-col items-center justify-center h-[220px] text-base-content/50 text-xs font-mono border border-dashed border-base-content/10 rounded-xl bg-base-100/30 text-center px-4 gap-1">
                            <span className="font-semibold text-base-content/70">
                                No token or call activity recorded for {title.toLowerCase()} in this time range.
                            </span>
                            <span className="text-[11px] text-base-content/40">
                                Activity is unmeasured or zero in this window. Adjust the time range filter or switch to
                                Table view.
                            </span>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-[220px] text-base-content/40 text-xs font-mono border border-dashed border-base-content/10 rounded-xl bg-base-100/30">
                            <span>No {title.toLowerCase()} activity recorded for this time range.</span>
                        </div>
                    )}
                </div>

                {/* Series legend chips */}
                {series.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1.5 border-t border-base-content/5">
                        {series.map((s) => (
                            <span
                                key={s.id}
                                className="inline-flex items-center px-2 py-0.5 rounded-md bg-base-300/80 border border-base-content/5 gap-1.5 font-mono text-[10px] text-base-content/80"
                            >
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                                <span className="truncate max-w-[150px]">{s.label}</span>
                            </span>
                        ))}
                    </div>
                )}
            </div>
        );
    },
);

// Helper to build series from top items + any keys present in the time series buckets
const buildSeries = (
    topItems: Array<{ id: string; label: string; color?: string }>,
    bucketPoints: Array<{ series: Record<string, number> }>,
    palette: string[],
): ChartSeries[] => {
    const map = new Map<string, ChartSeries>();
    topItems.forEach((item, i) => {
        map.set(item.id, {
            id: item.id,
            label: item.label || item.id,
            color: item.color || palette[i % palette.length] || '#3987e5',
        });
    });
    let colorIdx = map.size;
    for (const point of bucketPoints) {
        for (const key of Object.keys(point.series)) {
            if (key && !map.has(key)) {
                map.set(key, {
                    id: key,
                    label: key,
                    color: palette[colorIdx % palette.length] || '#3987e5',
                });
                colorIdx++;
            }
        }
    }
    return Array.from(map.values());
};

const toBuckets = (
    points: Array<{ bucketStart: string; series: Record<string, number>; cacheHitRatio?: number }>,
): StackedColumnBucket[] =>
    points.map((b) => ({
        id: b.bucketStart,
        label: fmtBucketLabel(b.bucketStart),
        v: b.series,
        lineValue: b.cacheHitRatio,
    }));

const toolColors = [
    '#199e70',
    '#3987e5',
    '#d95926',
    '#9085e9',
    '#c98500',
    '#ec4899',
    '#8b5cf6',
    '#06b6d4',
    '#f59e0b',
    '#10b981',
];

export const SummaryTab: React.FC<SummaryTabProps> = memo(
    ({
        data,
        loading,
        error,
        dimension = 'model',
        onDimensionChange: _onDimensionChange,
        bucket = 'auto',
        onBucketChange,
        loopSummary,
    }) => {
        const [chartMode, setChartMode] = useState<'chart' | 'table'>('chart');
        const [blockModes, setBlockModes] = useState<Record<'model' | 'source' | 'tool' | 'skill', 'chart' | 'table'>>({
            model: 'chart',
            source: 'chart',
            tool: 'chart',
            skill: 'chart',
        });

        const toggleModelMode = useCallback(
            () => setBlockModes((prev) => ({ ...prev, model: prev.model === 'chart' ? 'table' : 'chart' })),
            [],
        );
        const toggleSourceMode = useCallback(
            () => setBlockModes((prev) => ({ ...prev, source: prev.source === 'chart' ? 'table' : 'chart' })),
            [],
        );
        const toggleToolMode = useCallback(
            () => setBlockModes((prev) => ({ ...prev, tool: prev.tool === 'chart' ? 'table' : 'chart' })),
            [],
        );
        const toggleSkillMode = useCallback(
            () => setBlockModes((prev) => ({ ...prev, skill: prev.skill === 'chart' ? 'table' : 'chart' })),
            [],
        );

        const kpis = data?.kpis;
        const previousKpis = data?.previousKpis;
        const kpiTrend = data?.kpiTrend ?? [];
        const timeSeries = data?.timeSeries ?? [];
        const topModels = data?.topModels ?? [];
        const topSources = data?.topSources ?? [];
        const topTools = data?.topTools ?? [];
        // Universal bar scale for both the Token-by-Model and Token-by-Agent stacked breakdowns:
        // the widest total (fresh + cached + output) across all shown models and agent sources,
        // ensuring consistent and directly comparable bar scales across both cards.
        const tokenBarMax = useMemo(
            () =>
                Math.max(
                    0,
                    ...topModels.map(
                        (m) => (m.freshInputTokens ?? 0) + (m.cacheReadTokens ?? 0) + (m.outputTokens ?? 0),
                    ),
                    ...topSources.map(
                        (s) => (s.freshInputTokens ?? 0) + (s.cacheReadTokens ?? 0) + (s.outputTokens ?? 0),
                    ),
                ),
            [topModels, topSources],
        );
        const skillsUsed = data?.skillsUsed ?? [];
        const skillTimeSeries = data?.skillTimeSeries ?? [];
        const modelTimeSeries = data?.modelTimeSeries ?? [];
        const sourceTimeSeries = data?.sourceTimeSeries ?? [];
        const toolTimeSeries = data?.toolTimeSeries ?? [];
        const cacheEfficiency = data?.cacheEfficiency ?? {
            savedTokens: 0,
            hitRatio: 0,
            totalRead: 0,
            bySource: [],
            byModel: [],
            byAgentModel: [],
        };
        const prev = previousKpis ?? undefined;

        const agentModelCells = cacheEfficiency.byAgentModel ?? [];
        // Correlation-matrix layout: agents as rows, models as columns (first-appearance
        // order matches the API's agent-ASC / model-token-DESC ordering), cells keyed by pair.
        const modelOrder = useMemo(() => Array.from(new Set(agentModelCells.map((c) => c.model))), [agentModelCells]);
        const agentOrder = useMemo(() => Array.from(new Set(agentModelCells.map((c) => c.source))), [agentModelCells]);
        const agentModelCellMap = useMemo(
            () => new Map(agentModelCells.map((c) => [`${c.source}\u0000${c.model}`, c])),
            [agentModelCells],
        );
        const sourceNameById = useMemo(() => new Map(topSources.map((s) => [s.id, s.label])), [topSources]);

        const trend = useMemo(
            () => ({
                billed: kpiTrend.map((p) => p.totalBilledTokens),
                cacheSaved: kpiTrend.map((p) => p.cacheSavedTokens),
                sessions: kpiTrend.map((p) => p.sessionsCount),
                toolCalls: kpiTrend.map((p) => p.toolCallsCount),
            }),
            [kpiTrend],
        );

        const validTopTools = useMemo(
            () =>
                topTools.map((t) => ({
                    ...t,
                    id: t.id && t.id.trim() !== '' ? t.id.trim() : 'unknown',
                })),
            [topTools],
        );

        const validSkillsUsed = useMemo(
            () => skillsUsed.filter((s) => s.id && s.id.trim() !== '' && s.id !== 'unknown'),
            [skillsUsed],
        );

        const rawModelPoints = useMemo(
            () =>
                modelTimeSeries && modelTimeSeries.length > 0
                    ? modelTimeSeries
                    : dimension === 'model'
                      ? timeSeries
                      : [],
            [modelTimeSeries, dimension, timeSeries],
        );
        const rawSourcePoints = useMemo(
            () =>
                sourceTimeSeries && sourceTimeSeries.length > 0
                    ? sourceTimeSeries
                    : dimension === 'source'
                      ? timeSeries
                      : [],
            [sourceTimeSeries, dimension, timeSeries],
        );
        const rawToolPoints = useMemo(
            () =>
                toolTimeSeries && toolTimeSeries.length > 0 ? toolTimeSeries : dimension === 'tool' ? timeSeries : [],
            [toolTimeSeries, dimension, timeSeries],
        );
        const rawSkillPoints = useMemo(
            () =>
                skillTimeSeries && skillTimeSeries.length > 0
                    ? skillTimeSeries
                    : dimension === 'skill'
                      ? timeSeries
                      : [],
            [skillTimeSeries, dimension, timeSeries],
        );

        const modelSeries = useMemo(
            () => buildSeries(topModels, rawModelPoints, SERIES_COLORS),
            [topModels, rawModelPoints],
        );
        const sourceSeries = useMemo(
            () => buildSeries(topSources, rawSourcePoints, SERIES_COLORS),
            [topSources, rawSourcePoints],
        );
        const toolSeries = useMemo(
            () =>
                buildSeries(
                    validTopTools.map((t, i) => ({ id: t.id, label: t.id, color: toolColors[i % toolColors.length] })),
                    rawToolPoints,
                    toolColors,
                ),
            [validTopTools, rawToolPoints],
        );
        const skillSeries = useMemo(
            () => buildSeries(validSkillsUsed, rawSkillPoints, SERIES_COLORS),
            [validSkillsUsed, rawSkillPoints],
        );

        const modelBuckets = useMemo(() => toBuckets(rawModelPoints), [rawModelPoints]);
        const sourceBuckets = useMemo(() => toBuckets(rawSourcePoints), [rawSourcePoints]);
        const toolBuckets = useMemo(() => toBuckets(rawToolPoints), [rawToolPoints]);
        const skillBuckets = useMemo(() => toBuckets(rawSkillPoints), [rawSkillPoints]);

        const skillAreaBuckets = useMemo(
            () =>
                skillTimeSeries.map((b) => ({
                    id: b.bucketStart,
                    label: fmtBucketLabel(b.bucketStart),
                    v: b.series,
                })),
            [skillTimeSeries],
        );

        const {
            toolCallTotal,
            toolTimeTotal,
            toolTokenTotal,
            avgBilledPerSession,
            avgBilledPerCall,
            prevAvgPerSession,
            prevAvgPerCall,
            freshInputTokens,
            outputTokens,
            skillTokenTotals,
        } = useMemo(() => {
            // Displayed-set totals: share fallbacks normalize over the rows shown, not per-row maxima.
            const toolCallTotal = validTopTools.reduce((sum, t) => sum + t.count, 0);
            const toolTimeTotal = validTopTools.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
            const toolTokenTotal = validTopTools.reduce((sum, t) => sum + (t.tokens ?? 0), 0);
            const totalBilled = kpis?.totalBilledTokens ?? 0;
            const sessionsCount = kpis?.sessionsCount ?? 0;
            const toolCallsCount = kpis?.toolCallsCount ?? 0;
            const avgSess = sessionsCount > 0 ? totalBilled / sessionsCount : 0;
            const avgCall = toolCallsCount > 0 ? totalBilled / toolCallsCount : 0;
            const prevSess = prev && prev.sessionsCount > 0 ? prev.totalBilledTokens / prev.sessionsCount : undefined;
            const prevCall = prev && prev.toolCallsCount > 0 ? prev.totalBilledTokens / prev.toolCallsCount : undefined;
            const fresh = Math.max(0, cacheEfficiency.totalRead - cacheEfficiency.savedTokens);
            const out = Math.max(0, totalBilled - fresh);
            const skTotals = skillTimeSeries.reduce<Record<string, number>>((totals, point) => {
                for (const [skill, tokens] of Object.entries(point.series))
                    totals[skill] = (totals[skill] ?? 0) + tokens;
                return totals;
            }, {});

            return {
                toolCallTotal,
                toolTimeTotal,
                toolTokenTotal,
                avgBilledPerSession: avgSess,
                avgBilledPerCall: avgCall,
                prevAvgPerSession: prevSess,
                prevAvgPerCall: prevCall,
                freshInputTokens: fresh,
                outputTokens: out,
                skillTokenTotals: skTotals,
            };
        }, [validTopTools, kpis, prev, cacheEfficiency, skillTimeSeries]);

        if (loading) {
            return (
                <div className="flex items-center justify-center p-16">
                    <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                </div>
            );
        }

        if (error) {
            return (
                <div className="p-4 rounded-lg bg-error/10 border border-error/20 text-error">
                    <span>Failed to load history summary: {error}</span>
                </div>
            );
        }

        if (!data || !kpis) return null;

        return (
            <div className="flex flex-col gap-6">
                {/* 4 KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <KpiCard
                        label="Total Billed Tokens"
                        value={fmtTok(kpis.totalBilledTokens)}
                        sub={`Fresh ${fmtTok(freshInputTokens)} · Output ${fmtTok(outputTokens)}`}
                        trend={trend.billed}
                        trendColor="#3987e5"
                        current={kpis.totalBilledTokens}
                        previous={prev?.totalBilledTokens}
                    />
                    <KpiCard
                        label="Cache-Saved Tokens"
                        value={fmtTok(kpis.cacheSavedTokens)}
                        sub={`Share ${fmtPct(kpis.cacheSavedPercent)} · Hit ${fmtPct(cacheEfficiency.hitRatio)}`}
                        trend={trend.cacheSaved}
                        trendColor="#22d3ee"
                        current={kpis.cacheSavedTokens}
                        previous={prev?.cacheSavedTokens}
                        badge={
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                {kpis.cacheSavedPercent}% saved
                            </span>
                        }
                    />
                    <KpiCard
                        label="Sessions"
                        value={fmtInt(kpis.sessionsCount)}
                        sub={`${fmtInt(kpis.sessionsCount > 0 ? kpis.toolCallsCount / kpis.sessionsCount : 0)} calls / session`}
                        trend={trend.sessions}
                        trendColor="#9085e9"
                        current={kpis.sessionsCount}
                        previous={prev?.sessionsCount}
                    />
                    <KpiCard
                        label="Tool Calls"
                        value={fmtInt(kpis.toolCallsCount)}
                        sub={`${fmtTok(avgBilledPerCall)} billed / step`}
                        trend={trend.toolCalls}
                        trendColor="#c98500"
                        current={kpis.toolCallsCount}
                        previous={prev?.toolCallsCount}
                        badge={
                            <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                {fmtPct(kpis.errorRate)} err
                            </span>
                        }
                    />
                </div>

                {/* Token Activity & Cache Hit Ratio Overview Header */}
                <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap justify-between items-center gap-3">
                        <div>
                            <h3 className="font-bold text-base text-base-content">Token Activity & Cache Hit Ratio</h3>
                            <p className="text-xs text-base-content/60">
                                4-block breakdown across Model, Source, Tool, and Skill (Stacked token bars with Cache
                                Hit % line overlay)
                            </p>
                        </div>

                        <div className="flex items-center gap-3">
                            {/* Bucket Interval Control */}
                            <fieldset className="flex items-center bg-base-300 p-0.5 rounded-lg text-xs border-0">
                                <legend className="sr-only">Bucket interval</legend>
                                {BUCKET_OPTIONS.map((b) => (
                                    <button
                                        key={b}
                                        type="button"
                                        aria-pressed={bucket === b}
                                        className={`px-2 py-1 rounded font-medium transition-colors ${
                                            bucket === b
                                                ? 'bg-base-100 text-base-content font-bold shadow-sm'
                                                : 'text-base-content/60 hover:bg-base-content/10'
                                        }`}
                                        onClick={() => onBucketChange?.(b)}
                                    >
                                        {b}
                                    </button>
                                ))}
                            </fieldset>

                            {/* Global Chart/Table Switcher */}
                            <div className="flex items-center bg-base-300 p-0.5 rounded-lg text-xs">
                                {(['chart', 'table'] as const).map((m) => (
                                    <button
                                        key={m}
                                        type="button"
                                        aria-pressed={chartMode === m}
                                        className={`px-2.5 py-1 rounded font-medium transition-colors ${
                                            chartMode === m
                                                ? 'bg-base-100 text-base-content font-bold shadow-sm'
                                                : 'text-base-content/60 hover:bg-base-content/10'
                                        }`}
                                        onClick={() => {
                                            setChartMode(m);
                                            setBlockModes({ model: m, source: m, tool: m, skill: m });
                                        }}
                                    >
                                        {m === 'chart' ? 'All Charts' : 'All Tables'}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* 4 Dimension Blocks on 4 Lines (Full Width) */}
                    <div className="flex flex-col gap-6 w-full">
                        <SummaryDimensionBlock
                            title="By Model"
                            description="Token load by LLM model with cache hit ratio overlay"
                            series={modelSeries}
                            buckets={modelBuckets}
                            chartMode={blockModes.model}
                            onToggleChartMode={toggleModelMode}
                            testId="summary-block-model"
                        />
                        <SummaryDimensionBlock
                            title="By Source"
                            description="Token load by agent platform with cache hit ratio overlay"
                            series={sourceSeries}
                            buckets={sourceBuckets}
                            chartMode={blockModes.source}
                            onToggleChartMode={toggleSourceMode}
                            testId="summary-block-source"
                        />
                        <SummaryDimensionBlock
                            title="By Tool"
                            description="Token load (or call volume when unmeasured) by tool execution with cache hit ratio overlay"
                            series={toolSeries}
                            buckets={toolBuckets}
                            chartMode={blockModes.tool}
                            onToggleChartMode={toggleToolMode}
                            testId="summary-block-tool"
                        />
                        <SummaryDimensionBlock
                            title="By Skill"
                            description="Token load by specialized skill with cache hit ratio overlay"
                            series={skillSeries}
                            buckets={skillBuckets}
                            chartMode={blockModes.skill}
                            onToggleChartMode={toggleSkillMode}
                            testId="summary-block-skill"
                        />
                    </div>
                </div>

                {/* Breakdowns Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Token by Model */}
                    <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5">
                        <h4 className="font-bold text-sm mb-3">Token by Model</h4>
                        <div className="flex flex-col gap-3">
                            {topModels.map((m) => (
                                <TokenBreakdownBar key={m.id} item={m} maxTotal={tokenBarMax} />
                            ))}
                        </div>
                    </div>

                    {/* Token by Agent Source */}
                    <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5">
                        <h4 className="font-bold text-sm mb-3">Token by Agent Source</h4>
                        <div className="flex flex-col gap-3">
                            {topSources.map((s) => (
                                <TokenBreakdownBar key={s.id} item={s} maxTotal={tokenBarMax} />
                            ))}
                        </div>
                    </div>

                    {/* Cache Efficiency By Agent */}
                    <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5">
                        <h4 className="font-bold text-sm mb-3">Cache Efficiency By Agent</h4>
                        {((cacheEfficiency.bySource && cacheEfficiency.bySource.length > 0) ||
                            topSources.length > 0) && (
                            <CacheEfficiencyBars
                                items={(cacheEfficiency.bySource && cacheEfficiency.bySource.length > 0
                                    ? cacheEfficiency.bySource
                                    : topSources.map((s) => ({
                                          source: s.id,
                                          sourceName: s.label,
                                          color: s.color,
                                          hitRatio: cacheEfficiency.hitRatio,
                                          savedTokens: Math.round(cacheEfficiency.savedTokens * (s.share / 100)),
                                          totalRead: Math.round(cacheEfficiency.totalRead * (s.share / 100)),
                                          billedTokens: s.tokens,
                                      }))
                                ).map((s) => ({
                                    id: s.source,
                                    label: s.sourceName,
                                    color: s.color,
                                    hitRatio: s.hitRatio,
                                    savedTokens: s.savedTokens,
                                    totalRead: s.totalRead,
                                    billedTokens: s.billedTokens,
                                }))}
                            />
                        )}
                    </div>

                    {/* Cache Efficiency By Model */}
                    <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5">
                        <h4 className="font-bold text-sm mb-3">Cache Efficiency By Model</h4>
                        {cacheEfficiency.byModel && cacheEfficiency.byModel.length > 0 && (
                            <CacheEfficiencyBars
                                items={cacheEfficiency.byModel.map((m) => ({
                                    id: m.model,
                                    label: m.modelName,
                                    color: m.color,
                                    hitRatio: m.hitRatio,
                                    savedTokens: m.savedTokens,
                                    totalRead: m.totalRead,
                                    billedTokens: m.billedTokens,
                                }))}
                            />
                        )}
                    </div>

                    {/* Agent × Model Correlation Matrix */}
                    <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5">
                        <h4 className="font-bold text-sm mb-3">Agent × Model Correlation Matrix</h4>
                        {modelOrder.length > 0 && agentOrder.length > 0 && (
                            <div className="flex flex-col gap-2">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs font-mono">
                                        <thead>
                                            <tr>
                                                <th className="text-left pr-2 py-1 text-base-content/60 sticky left-0 bg-base-200 z-10">
                                                    Model \ Agent
                                                </th>
                                                {agentOrder.map((src) => (
                                                    <th
                                                        key={src}
                                                        className="px-1 py-1 text-base-content/60 whitespace-nowrap"
                                                        title={sourceNameById.get(src) ?? src}
                                                    >
                                                        {sourceNameById.get(src) ?? src}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {modelOrder.map((m) => (
                                                <tr key={m}>
                                                    <td className="pr-2 py-1 font-bold text-base-content/80 whitespace-nowrap sticky left-0 bg-base-200">
                                                        {m}
                                                    </td>
                                                    {agentOrder.map((src) => {
                                                        const cell = agentModelCellMap.get(`${src}\u0000${m}`);
                                                        return (
                                                            <td key={src} className="p-0.5">
                                                                {cell ? (
                                                                    <div
                                                                        className="h-8 min-w-[3rem] rounded-md flex items-center justify-center text-[10px] font-bold border border-base-content/10 cursor-default"
                                                                        style={{
                                                                            background: `rgba(6, 182, 212, ${
                                                                                0.08 + 0.5 * (cell.hitRatio / 100)
                                                                            })`,
                                                                        }}
                                                                        title={`${cell.sourceName} × ${cell.modelName}: ${cell.hitRatio}% hit · saved ${fmtTok(
                                                                            cell.savedTokens,
                                                                        )} / read ${fmtTok(
                                                                            cell.totalRead,
                                                                        )} / billed ${fmtTok(cell.billedTokens)}`}
                                                                    >
                                                                        {cell.hitRatio}%
                                                                    </div>
                                                                ) : (
                                                                    <div className="h-8 min-w-[3rem] rounded-md flex items-center justify-center text-[10px] text-base-content/25 bg-base-300/40">
                                                                        —
                                                                    </div>
                                                                )}
                                                            </td>
                                                        );
                                                    })}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="flex items-center gap-2 text-[10px] font-mono text-base-content/60">
                                    <span>0%</span>
                                    <div className="h-1.5 w-32 rounded-full bg-gradient-to-r from-base-300 to-cyan-400" />
                                    <span>100% cache hit ratio</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Top Tools Table */}
                    <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5">
                        <h4 className="font-bold text-sm mb-2">Top Tools & Error Rates</h4>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs text-left font-mono">
                                <thead>
                                    <tr className="border-b border-base-content/10 text-base-content/60">
                                        <th className="py-1.5">Tool</th>
                                        <th className="py-1.5 min-w-[120px]">Usage Share</th>
                                        <th className="py-1.5 min-w-[120px]">Time Share</th>
                                        <th className="py-1.5 min-w-[120px]">Token Share</th>
                                        <th className="py-1.5 text-right">Calls</th>
                                        <th className="py-1.5 text-right">Errors</th>
                                        <th className="py-1.5 text-right">Error Rate</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {validTopTools.map((t) => {
                                        const usagePct =
                                            t.usageShare ??
                                            (toolCallTotal > 0 ? Math.round((t.count / toolCallTotal) * 1000) / 10 : 0);
                                        const timePct =
                                            t.timeShare ??
                                            (toolTimeTotal > 0
                                                ? Math.round(((t.durationMs ?? 0) / toolTimeTotal) * 1000) / 10
                                                : 0);
                                        const tokenPct =
                                            t.tokenShare ??
                                            (toolTokenTotal > 0
                                                ? Math.round(((t.tokens ?? 0) / toolTokenTotal) * 1000) / 10
                                                : 0);

                                        return (
                                            <tr
                                                key={t.id}
                                                className="border-b border-base-content/5 hover:bg-base-300/30"
                                            >
                                                <td className="py-1.5 font-bold">{t.id}</td>
                                                <td className="py-1.5">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-16">
                                                            <SparkBar value={usagePct} max={100} color="#3987e5" />
                                                        </div>
                                                        <span className="tabular-nums text-[10px] text-base-content/70">
                                                            {fmtPct(usagePct)}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="py-1.5">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-16">
                                                            <SparkBar value={timePct} max={100} color="#10b981" />
                                                        </div>
                                                        <span className="tabular-nums text-[10px] text-base-content/70">
                                                            {timePct > 0 ? fmtPct(timePct) : '—'}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="py-1.5">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-16">
                                                            <SparkBar value={tokenPct} max={100} color="#f59e0b" />
                                                        </div>
                                                        <span className="tabular-nums text-[10px] text-base-content/70">
                                                            {tokenPct > 0 ? fmtPct(tokenPct) : '—'}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="py-1.5 text-right tabular-nums">{fmtInt(t.count)}</td>
                                                <td className="py-1.5 text-right tabular-nums">
                                                    {t.errors > 0 ? fmtInt(t.errors) : '0'}
                                                </td>
                                                <td className="py-1.5 text-right">
                                                    <span
                                                        className={`px-1.5 py-0.5 rounded text-[10px] ${
                                                            t.errorRate > 1
                                                                ? 'bg-error/20 text-error font-bold'
                                                                : 'bg-base-300 text-base-content/70'
                                                        }`}
                                                    >
                                                        {fmtPct(t.errorRate)}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Efficiency Stats & Skills */}
                    <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5 flex flex-col gap-4">
                        <h4 className="font-bold text-sm mb-3">Efficiency Stats & Skills</h4>
                        <div>
                            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-base-content/60 text-[10px] uppercase tracking-wider">
                                        Avg Billed / Session
                                    </span>
                                    <span className="font-bold">{fmtTok(avgBilledPerSession)}</span>
                                    <DeltaBadge current={avgBilledPerSession} previous={prevAvgPerSession} invert />
                                </div>
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-base-content/60 text-[10px] uppercase tracking-wider">
                                        Avg Billed / Step
                                    </span>
                                    <span className="font-bold">{fmtTok(avgBilledPerCall)}</span>
                                    <DeltaBadge current={avgBilledPerCall} previous={prevAvgPerCall} invert />
                                </div>
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-base-content/60 text-[10px] uppercase tracking-wider">
                                        Loop Detection Findings
                                    </span>
                                    <span className="font-bold">
                                        {fmtInt(loopSummary?.redundantCalls ?? 0)} redundant
                                    </span>
                                    <span className="text-[10px] text-base-content/60">
                                        {fmtTok(loopSummary?.wastedTokens ?? 0)} wasted
                                    </span>
                                </div>
                            </div>
                        </div>

                        {skillsUsed.length > 0 && (
                            <div>
                                <h5 className="font-bold text-xs mb-2">Skills Invocation Mix</h5>
                                <StackedAreaChart
                                    buckets={skillAreaBuckets}
                                    series={activeSeriesFor(skillsUsed)}
                                    height={150}
                                />
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {skillsUsed.map((sk) => (
                                        <span
                                            key={sk.id}
                                            className="inline-flex items-center px-2 py-0.5 rounded-full bg-base-300 border border-base-content/10 gap-1.5 font-mono text-[11px]"
                                        >
                                            <span className="w-2 h-2 rounded-full" style={{ background: sk.color }} />
                                            <span>{sk.label}:</span>
                                            <span className="font-bold">
                                                {fmtTok(skillTokenTotals[sk.id] ?? 0)} tokens
                                            </span>
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    },
);

const activeSeriesFor = (skills: Array<{ id: string; label: string; color: string }>): ChartSeries[] =>
    skills.map((sk) => ({ id: sk.id, label: sk.label, color: sk.color }));

/**
 * Stacked fresh / cached / output token bar for the Token by Model / Token by Agent Source
 * cards. The headline value is billed (fresh + output) — consistent with the Token Activity
 * chart — while the bar and breakdown expose cached reads as a lighter input segment, so
 * reused-context volume is visible without inflating the ranking.
 */
const TokenBreakdownBar: React.FC<{ item: HistoryTopItem; maxTotal: number }> = memo(({ item, maxTotal }) => {
    const fresh = item.freshInputTokens ?? 0;
    const cache = item.cacheReadTokens ?? 0;
    const output = item.outputTokens ?? 0;
    const scale = maxTotal > 0 ? maxTotal : 1;
    const seg = (value: number) => `${Math.round((value / scale) * 1000) / 10}%`;
    return (
        <div className="flex flex-col gap-1">
            <div className="flex justify-between text-xs font-mono">
                <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: item.color }} />
                    {item.label}
                </span>
                <span>{fmtTok(item.tokens)}</span>
            </div>
            <div className="w-full bg-base-300 h-3 rounded-full overflow-hidden flex">
                {fresh > 0 && <div className="h-full" style={{ width: seg(fresh), background: '#3987e5' }} />}
                {cache > 0 && (
                    <div className="h-full" style={{ width: seg(cache), background: 'rgba(57, 135, 229, 0.35)' }} />
                )}
                {output > 0 && <div className="h-full" style={{ width: seg(output), background: '#f59e0b' }} />}
            </div>
            <div className="flex justify-between text-[10px] text-base-content/60 font-mono">
                <span>
                    Fresh {fmtTok(fresh)} · Cached {fmtTok(cache)} · Output {fmtTok(output)}
                </span>
                <span>Total {fmtTok(fresh + cache + output)}</span>
            </div>
        </div>
    );
});

interface CacheBarItem {
    id: string;
    label: string;
    color: string;
    hitRatio: number;
    savedTokens: number;
    totalRead: number;
    billedTokens: number;
}

/** Shared per-item cache-efficiency bar list (used by the By Agent and By Model charts). */
const CacheEfficiencyBars: React.FC<{ items: CacheBarItem[] }> = memo(({ items }) => (
    <div className="flex flex-col gap-2">
        {items.map((item) => (
            <div
                key={item.id}
                className="flex flex-col gap-1 bg-base-300/40 p-2.5 rounded-lg border border-base-content/5"
            >
                <div className="flex justify-between items-center text-xs">
                    <span className="flex items-center gap-1.5 font-medium">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: item.color }} />
                        {item.label}
                    </span>
                    <span className="font-mono font-bold text-cyan-400">{item.hitRatio}%</span>
                </div>
                <div className="w-full bg-base-100 h-1.5 rounded-full overflow-hidden">
                    <div
                        className="h-full rounded-full"
                        style={{ width: `${item.hitRatio}%`, background: item.color }}
                    />
                </div>
                <div className="flex justify-between text-[10px] text-base-content/60 font-mono">
                    <span>Saved: {fmtTok(item.savedTokens)}</span>
                    <span>
                        Total Read: {fmtTok(item.totalRead)} · Billed: {fmtTok(item.billedTokens)}
                    </span>
                </div>
            </div>
        ))}
    </div>
));

export default SummaryTab;
