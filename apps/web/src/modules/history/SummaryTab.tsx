import type { HistoryDimension, HistorySummaryResponse } from '@gobing-ai/spur-contracts';
import type React from 'react';
import { type ChartSeries, fmtInt, fmtPct, fmtTok, type StackedColumnBucket, StackedColumnsChart } from './charts';

export interface SummaryTabProps {
    data?: HistorySummaryResponse['data'];
    loading?: boolean;
    error?: string | null;
    dimension?: HistoryDimension;
    onDimensionChange?: (dimension: HistoryDimension) => void;
}

export const SummaryTab: React.FC<SummaryTabProps> = ({
    data,
    loading,
    error,
    dimension = 'model',
    onDimensionChange,
}) => {
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

    const { kpis, timeSeries, topModels, topSources, topTools, skillsUsed, cacheEfficiency } = data;

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
            label,
            v: b.series,
            lineValue: b.cacheHitRatio,
        };
    });

    return (
        <div className="flex flex-col gap-6">
            {/* 4 KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Billed Tokens */}
                <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-base-content/60">
                        Total Billed Tokens
                    </div>
                    <div className="text-2xl font-bold font-mono text-primary mt-1">
                        {fmtTok(kpis.totalBilledTokens)}
                    </div>
                    <div className="text-xs text-base-content/60 mt-1">Fresh input & output tokens</div>
                </div>

                {/* Cache-Saved Tokens */}
                <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-4">
                    <div className="flex justify-between items-center">
                        <span className="text-xs font-semibold uppercase tracking-wider text-base-content/60">
                            Cache-Saved Tokens
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            {kpis.cacheSavedPercent}% saved
                        </span>
                    </div>
                    <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">
                        {fmtTok(kpis.cacheSavedTokens)}
                    </div>
                    <div className="text-xs text-base-content/60 mt-1">Served via prompt cache</div>
                </div>

                {/* Sessions */}
                <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-base-content/60">Sessions</div>
                    <div className="text-2xl font-bold font-mono mt-1">{fmtInt(kpis.sessionsCount)}</div>
                    <div className="text-xs text-base-content/60 mt-1">Recorded agent conversations</div>
                </div>

                {/* Tool Calls */}
                <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-4">
                    <div className="flex justify-between items-center">
                        <span className="text-xs font-semibold uppercase tracking-wider text-base-content/60">
                            Tool Calls
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            {fmtPct(kpis.errorRate)} err
                        </span>
                    </div>
                    <div className="text-2xl font-bold font-mono mt-1">{fmtInt(kpis.toolCallsCount)}</div>
                    <div className="text-xs text-base-content/60 mt-1">CLI and file system operations</div>
                </div>
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

                    {/* Dimension Switcher */}
                    <div className="flex items-center bg-base-300 p-0.5 rounded-lg text-xs">
                        {(['model', 'source', 'tool', 'skill'] as const).map((dim) => (
                            <button
                                key={dim}
                                type="button"
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

                <div className="pt-3">
                    <StackedColumnsChart buckets={buckets} series={activeSeries} height={260} />
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
                                    <th className="py-1.5 text-right">Calls</th>
                                    <th className="py-1.5 text-right">Errors</th>
                                    <th className="py-1.5 text-right">Error Rate</th>
                                </tr>
                            </thead>
                            <tbody>
                                {topTools.map((t) => (
                                    <tr key={t.id} className="border-b border-base-content/5 hover:bg-base-300/30">
                                        <td className="py-1.5 font-bold">{t.id}</td>
                                        <td className="py-1.5 text-right">{fmtInt(t.count)}</td>
                                        <td className="py-1.5 text-right">{t.errors > 0 ? fmtInt(t.errors) : '0'}</td>
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
                <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5 flex flex-col justify-between">
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
                    </div>

                    {skillsUsed.length > 0 && (
                        <div>
                            <h5 className="font-bold text-xs mb-2">Skills Invocation Mix</h5>
                            <div className="flex flex-wrap gap-2">
                                {skillsUsed.map((sk) => (
                                    <div
                                        key={sk.id}
                                        className="inline-flex items-center px-2 py-0.5 rounded-full bg-base-300 border border-base-content/10 gap-1.5 font-mono text-[11px]"
                                    >
                                        <span className="w-2 h-2 rounded-full" style={{ background: sk.color }} />
                                        <span>{sk.label}:</span>
                                        <span className="font-bold">{fmtInt(sk.count)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
export default SummaryTab;
