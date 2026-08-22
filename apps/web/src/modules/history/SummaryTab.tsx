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

export const SummaryTab: React.FC<SummaryTabProps> = ({
    data,
    loading,
    error,
    dimension = 'model',
    onDimensionChange,
    bucket = 'auto',
    onBucketChange,
    loopSummary,
}) => {
    const [chartMode, setChartMode] = useState<'chart' | 'table'>('chart');

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
        cacheEfficiency,
    } = data;
    const prev = previousKpis ?? undefined;
    const trend = {
        billed: kpiTrend.map((p) => p.totalBilledTokens),
        cacheSaved: kpiTrend.map((p) => p.cacheSavedTokens),
        sessions: kpiTrend.map((p) => p.sessionsCount),
        toolCalls: kpiTrend.map((p) => p.toolCallsCount),
    };

    // Build series & buckets according to active dimension
    let activeSeries: ChartSeries[] = [];
    if (dimension === 'model') {
        activeSeries = topModels.map((m) => ({ id: m.id, label: m.label, color: m.color }));
    } else if (dimension === 'source') {
        activeSeries = topSources.map((s) => ({ id: s.id, label: s.label, color: s.color }));
    } else if (dimension === 'tool') {
        const colors = ['#199e70', '#3987e5', '#d95926', '#9085e9', '#c98500', '#ec4899', '#8b5cf6'];
        activeSeries = topTools.slice(0, 6).map((t, i) => ({
            id: t.id,
            label: t.id,
            color: colors[i % colors.length] ?? '#3987e5',
        }));
    } else {
        activeSeries = skillsUsed.map((sk) => ({ id: sk.id, label: sk.label, color: sk.color }));
    }

    const buckets: StackedColumnBucket[] = timeSeries.map((b) => {
        const label = b.bucketStart.slice(5, 10);
        return {
            id: b.bucketStart,
            label,
            v: b.series,
            lineValue: b.cacheHitRatio,
        };
    });

    const skillAreaBuckets = skillTimeSeries.map((b) => ({
        id: b.bucketStart,
        label: b.bucketStart.slice(5, 10),
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

            {/* Main Token Chart with Dual-Axis Cache Hit Ratio */}
            <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5">
                <div className="flex flex-wrap justify-between items-center gap-3 pb-2 border-b border-base-content/10">
                    <div>
                        <h3 className="font-bold text-base">Token Activity & Cache Hit Ratio</h3>
                        <p className="text-xs text-base-content/60">
                            Stacked token bars (left) with Cache Hit % line overlay (right)
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
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

                        {/* Chart/Table toggle */}
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
                                    onClick={() => setChartMode(m)}
                                >
                                    {m === 'chart' ? 'Chart' : 'Table'}
                                </button>
                            ))}
                        </div>

                        {/* Dimension Switcher */}
                        <div className="flex items-center bg-base-300 p-0.5 rounded-lg text-xs">
                            {(['model', 'source', 'tool', 'skill'] as const).map((dim) => (
                                <button
                                    key={dim}
                                    type="button"
                                    aria-pressed={dimension === dim}
                                    className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                                        dimension === dim
                                            ? 'bg-primary text-primary-content font-bold'
                                            : 'text-base-content/70 hover:bg-base-content/10'
                                    }`}
                                    onClick={() => onDimensionChange?.(dim)}
                                >
                                    By {dim.charAt(0).toUpperCase() + dim.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="pt-3">
                    {chartMode === 'chart' ? (
                        <StackedColumnsChart buckets={buckets} series={activeSeries} height={260} />
                    ) : (
                        <div className="overflow-x-auto max-h-80 overflow-y-auto">
                            <table className="w-full text-xs text-left font-mono" data-testid="summary-bucket-table">
                                <thead className="sticky top-0 bg-base-200">
                                    <tr className="border-b border-base-content/10 text-base-content/60">
                                        <th className="py-1.5 pr-2">Bucket</th>
                                        {activeSeries.map((s) => (
                                            <th key={s.id} className="py-1.5 pr-2 text-right">
                                                <span className="inline-flex items-center gap-1">
                                                    <span
                                                        className="w-2 h-2 rounded-full inline-block"
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
                                            <tr key={b.id ?? b.label} className="border-b border-base-content/5">
                                                <td className="py-1.5 pr-2 font-bold">
                                                    {(b.id ?? b.label).slice(0, 16).replace('T', ' ')}
                                                </td>
                                                {activeSeries.map((s) => (
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
