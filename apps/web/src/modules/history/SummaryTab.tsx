import type { HistoryBucket, HistoryDimension, HistorySummaryResponse } from '@gobing-ai/spur-contracts';
import type React from 'react';
import { useState } from 'react';
import {
    type ChartSeries,
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

const BUCKET_OPTIONS: HistoryBucket[] = ['auto', '5m', '10m', '30m', '1h', '4h', '1d'];
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

const DeltaBadge: React.FC<{ current: number; previous: number | undefined; invert?: boolean }> = ({
    current,
    previous,
    invert = false,
}) => {
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
};

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
}> = ({ label, value, sub, trend, trendColor, current, previous, invert, badge }) => (
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
);

interface SummaryDimensionBlockProps {
    title: string;
    description: string;
    series: ChartSeries[];
    buckets: StackedColumnBucket[];
    chartMode: 'chart' | 'table';
    onToggleChartMode: () => void;
    testId?: string;
}

const SummaryDimensionBlock: React.FC<SummaryDimensionBlockProps> = ({
    title,
    description,
    series,
    buckets,
    chartMode,
    onToggleChartMode,
    testId,
}) => {
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
                {!hasData ? (
                    <div className="flex flex-col items-center justify-center h-[220px] text-base-content/40 text-xs font-mono border border-dashed border-base-content/10 rounded-xl bg-base-100/30">
                        <span>No {title.toLowerCase()} token activity recorded for this time range.</span>
                    </div>
                ) : chartMode === 'chart' ? (
                    <StackedColumnsChart buckets={buckets} series={series} height={220} />
                ) : (
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
                                                {(b.id ?? b.label).slice(0, 16).replace('T', ' ')}
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
};

export const SummaryTab: React.FC<SummaryTabProps> = ({
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

    if (!data) return null;

    const {
        kpis,
        previousKpis,
        kpiTrend,
        timeSeries,
        topModels,
        topSources,
        topTools,
        skillsUsed,
        skillTimeSeries,
        modelTimeSeries,
        sourceTimeSeries,
        toolTimeSeries,
        cacheEfficiency,
    } = data;
    const prev = previousKpis ?? undefined;
    const trend = {
        billed: kpiTrend.map((p) => p.totalBilledTokens),
        cacheSaved: kpiTrend.map((p) => p.cacheSavedTokens),
        sessions: kpiTrend.map((p) => p.sessionsCount),
        toolCalls: kpiTrend.map((p) => p.toolCallsCount),
    };

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

    const rawModelPoints =
        modelTimeSeries && modelTimeSeries.length > 0 ? modelTimeSeries : dimension === 'model' ? timeSeries : [];
    const rawSourcePoints =
        sourceTimeSeries && sourceTimeSeries.length > 0 ? sourceTimeSeries : dimension === 'source' ? timeSeries : [];
    const rawToolPoints =
        toolTimeSeries && toolTimeSeries.length > 0 ? toolTimeSeries : dimension === 'tool' ? timeSeries : [];
    const rawSkillPoints =
        skillTimeSeries && skillTimeSeries.length > 0 ? skillTimeSeries : dimension === 'skill' ? timeSeries : [];

    const modelSeries = buildSeries(topModels, rawModelPoints, SERIES_COLORS);
    const sourceSeries = buildSeries(topSources, rawSourcePoints, SERIES_COLORS);
    const toolSeries = buildSeries(
        topTools.map((t, i) => ({ id: t.id, label: t.id, color: toolColors[i % toolColors.length] })),
        rawToolPoints,
        toolColors,
    );
    const skillSeries = buildSeries(skillsUsed, rawSkillPoints, SERIES_COLORS);

    const toBuckets = (
        points: Array<{ bucketStart: string; series: Record<string, number>; cacheHitRatio?: number }>,
    ): StackedColumnBucket[] =>
        points.map((b) => ({
            id: b.bucketStart,
            label: b.bucketStart.length > 10 ? b.bucketStart.slice(11, 16) : b.bucketStart.slice(5, 10),
            v: b.series,
            lineValue: b.cacheHitRatio,
        }));

    // 4 Bucket collections
    const modelBuckets = toBuckets(rawModelPoints);
    const sourceBuckets = toBuckets(rawSourcePoints);
    const toolBuckets = toBuckets(rawToolPoints);
    const skillBuckets = toBuckets(rawSkillPoints);

    const skillAreaBuckets = skillTimeSeries.map((b) => ({
        id: b.bucketStart,
        label: b.bucketStart.length > 10 ? b.bucketStart.slice(11, 16) : b.bucketStart.slice(5, 10),
        v: b.series,
    }));

    const maxToolCalls = Math.max(...topTools.map((t) => t.count), 1);
    const avgBilledPerSession = kpis.sessionsCount > 0 ? kpis.totalBilledTokens / kpis.sessionsCount : 0;
    const avgBilledPerCall = kpis.toolCallsCount > 0 ? kpis.totalBilledTokens / kpis.toolCallsCount : 0;
    const prevAvgPerSession = prev && prev.sessionsCount > 0 ? prev.totalBilledTokens / prev.sessionsCount : undefined;
    const prevAvgPerCall = prev && prev.toolCallsCount > 0 ? prev.totalBilledTokens / prev.toolCallsCount : undefined;
    const freshInputTokens = Math.max(0, cacheEfficiency.totalRead - cacheEfficiency.savedTokens);
    const outputTokens = Math.max(0, kpis.totalBilledTokens - freshInputTokens);
    const skillTokenTotals = skillTimeSeries.reduce<Record<string, number>>((totals, point) => {
        for (const [skill, tokens] of Object.entries(point.series)) totals[skill] = (totals[skill] ?? 0) + tokens;
        return totals;
    }, {});

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
                            4-block breakdown across Model, Source, Tool, and Skill (Stacked token bars with Cache Hit %
                            line overlay)
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
                        onToggleChartMode={() =>
                            setBlockModes((prev) => ({ ...prev, model: prev.model === 'chart' ? 'table' : 'chart' }))
                        }
                        testId="summary-block-model"
                    />
                    <SummaryDimensionBlock
                        title="By Source"
                        description="Token load by agent platform with cache hit ratio overlay"
                        series={sourceSeries}
                        buckets={sourceBuckets}
                        chartMode={blockModes.source}
                        onToggleChartMode={() =>
                            setBlockModes((prev) => ({ ...prev, source: prev.source === 'chart' ? 'table' : 'chart' }))
                        }
                        testId="summary-block-source"
                    />
                    <SummaryDimensionBlock
                        title="By Tool"
                        description="Token load by tool execution with cache hit ratio overlay"
                        series={toolSeries}
                        buckets={toolBuckets}
                        chartMode={blockModes.tool}
                        onToggleChartMode={() =>
                            setBlockModes((prev) => ({ ...prev, tool: prev.tool === 'chart' ? 'table' : 'chart' }))
                        }
                        testId="summary-block-tool"
                    />
                    <SummaryDimensionBlock
                        title="By Skill"
                        description="Token load by specialized skill with cache hit ratio overlay"
                        series={skillSeries}
                        buckets={skillBuckets}
                        chartMode={blockModes.skill}
                        onToggleChartMode={() =>
                            setBlockModes((prev) => ({ ...prev, skill: prev.skill === 'chart' ? 'table' : 'chart' }))
                        }
                        testId="summary-block-skill"
                    />
                </div>
            </div>

            {/* Breakdowns Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Models */}
                <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5">
                    <h4 className="font-bold text-sm mb-3">Top Models by Billed Tokens</h4>
                    <div className="flex flex-col gap-3">
                        {topModels.map((m) => (
                            <div key={m.id} className="flex flex-col gap-1">
                                <div className="flex justify-between text-xs font-mono">
                                    <span className="flex items-center gap-1.5">
                                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: m.color }} />
                                        {m.label}
                                    </span>
                                    <span>
                                        {fmtTok(m.tokens)} ({m.share}%)
                                    </span>
                                </div>
                                <div className="w-full bg-base-300 h-2 rounded-full overflow-hidden">
                                    <div
                                        className="h-full rounded-full"
                                        style={{ width: `${m.share}%`, background: m.color }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Top Sources */}
                <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5">
                    <h4 className="font-bold text-sm mb-3">Top Agent Sources by Billed Tokens</h4>
                    <div className="flex flex-col gap-3">
                        {topSources.map((s) => (
                            <div key={s.id} className="flex flex-col gap-1">
                                <div className="flex justify-between text-xs">
                                    <span className="flex items-center gap-1.5 font-medium">
                                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                                        {s.label}
                                    </span>
                                    <span className="font-mono">
                                        {fmtTok(s.tokens)} ({s.share}%)
                                    </span>
                                </div>
                                <div className="w-full bg-base-300 h-2 rounded-full overflow-hidden">
                                    <div
                                        className="h-full rounded-full"
                                        style={{ width: `${s.share}%`, background: s.color }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Top Tools Table */}
                <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5">
                    <h4 className="font-bold text-sm mb-2">Top Tools & Error Rates</h4>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left font-mono">
                            <thead>
                                <tr className="border-b border-base-content/10 text-base-content/60">
                                    <th className="py-1.5">Tool</th>
                                    <th className="py-1.5">Share</th>
                                    <th className="py-1.5 text-right">Calls</th>
                                    <th className="py-1.5 text-right">Errors</th>
                                    <th className="py-1.5 text-right">Error Rate</th>
                                </tr>
                            </thead>
                            <tbody>
                                {topTools.map((t) => (
                                    <tr key={t.id} className="border-b border-base-content/5 hover:bg-base-300/30">
                                        <td className="py-1.5 font-bold">{t.id}</td>
                                        <td className="py-1.5 w-28">
                                            <SparkBar value={t.count} max={maxToolCalls} color="#3987e5" />
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
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Cache Efficiency & Skills Area */}
                <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5 flex flex-col gap-4">
                    <div>
                        <h4 className="font-bold text-sm mb-2">Cache Efficiency Overview</h4>
                        <div className="bg-base-300/60 p-3.5 rounded-xl border border-base-content/5 mb-4">
                            <div className="flex justify-between items-center mb-1.5 text-xs font-semibold">
                                <span>Global Cache Hit Ratio</span>
                                <span className="text-cyan-400 font-mono text-sm">{cacheEfficiency.hitRatio}%</span>
                            </div>
                            <div className="w-full bg-base-100 h-2.5 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-cyan-400 rounded-full"
                                    style={{ width: `${cacheEfficiency.hitRatio}%` }}
                                />
                            </div>
                            <div className="flex justify-between text-[11px] text-base-content/60 mt-2 font-mono">
                                <span>Saved: {fmtTok(cacheEfficiency.savedTokens)}</span>
                                <span>Total Read: {fmtTok(cacheEfficiency.totalRead)}</span>
                            </div>
                        </div>
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
                                <span className="font-bold">{fmtInt(loopSummary?.redundantCalls ?? 0)} redundant</span>
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
                                        <span className="font-bold">{fmtTok(skillTokenTotals[sk.id] ?? 0)} tokens</span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const activeSeriesFor = (skills: Array<{ id: string; label: string; color: string }>): ChartSeries[] =>
    skills.map((sk) => ({ id: sk.id, label: sk.label, color: sk.color }));

export default SummaryTab;
