import type { HistoryInsightsResponse, HistoryKpiTrendPoint } from '@gobing-ai/spur-contracts';
import type React from 'react';
import { useState } from 'react';
import { fmtInt, fmtMs, fmtPct, fmtTok, LineChart, RadarChart, type RadarSeries, SparkBar } from './charts';

export interface InsightsTabProps {
    data?: HistoryInsightsResponse['data'];
    loading?: boolean;
    error?: string | null;
    cacheHitTrend?: readonly HistoryKpiTrendPoint[];
    onSelectSession?: (sessionId: string, source?: string) => void;
}
export const InsightsTab: React.FC<InsightsTabProps> = ({ data, loading, error, cacheHitTrend, onSelectSession }) => {
    type ModelSortKey = 'model' | 'speedMsMean' | 'cacheRatio' | 'reliability' | 'outputRatio';
    const [modelSortKey, setModelSortKey] = useState<ModelSortKey>('model');
    const [modelSortDir, setModelSortDir] = useState<'asc' | 'desc'>('asc');

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
                <span>Failed to load insights: {error}</span>
            </div>
        );
    }

    if (!data) return null;

    const { loops, cacheWaste, heavySessions, largestTokenSteps, slowSteps, modelComparison } = data;

    const handleModelSort = (key: ModelSortKey) => {
        if (modelSortKey === key) {
            setModelSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setModelSortKey(key);
            setModelSortDir(key === 'model' ? 'asc' : 'desc');
        }
    };

    const sortedModelComparison = [...modelComparison].sort((a, b) => {
        const mult = modelSortDir === 'asc' ? 1 : -1;
        if (modelSortKey === 'model') {
            return mult * a.model.localeCompare(b.model);
        }
        return mult * ((a[modelSortKey] ?? 0) - (b[modelSortKey] ?? 0));
    });

    const sortIndicator = (key: ModelSortKey) => {
        if (modelSortKey !== key) return <span className="opacity-30 ml-1 text-[10px]">↕</span>;
        return <span className="text-primary ml-1 text-[10px]">{modelSortDir === 'asc' ? '▲' : '▼'}</span>;
    };

    const maxHeavyTokens = Math.max(1, ...heavySessions.map((s) => s.tokens));
    const maxSlowDuration = Math.max(1, ...slowSteps.map((s) => s.durationMs ?? 0));

    // Radar Series: Map model comparisons (Speed, Cache ratio, Reliability, Output ratio)
    const radarAxes = ['Speed', 'Cache Ratio', 'Reliability', 'Output Ratio'];
    const modelColors: Record<string, string> = {
        'claude-opus-4.6': '#3987e5',
        'claude-sonnet-4.6': '#199e70',
        'gpt-5.6-sol': '#9085e9',
        'grok-4.6': '#d95926',
        other: '#898781',
    };
    // Cohort-normalized radar: Speed INVERTED so fastest model scores highest.
    const speeds = modelComparison.map((m) => m.speedMsMean);
    const minSpeed = Math.min(...speeds);
    const maxSpeed = Math.max(...speeds);
    const speedScore = (ms: number): number => {
        if (maxSpeed === minSpeed) return 100;
        return Math.max(0, Math.min(100, Math.round(((maxSpeed - ms) / (maxSpeed - minSpeed)) * 100)));
    };
    const percentageScore = (ratio: number): number => Math.max(0, Math.min(100, Math.round(ratio * 100)));

    const radarSeries: RadarSeries[] = modelComparison.map((m) => {
        const speedNorm = speedScore(m.speedMsMean);
        const cacheNorm = percentageScore(m.cacheRatio);
        const relNorm = percentageScore(m.reliability);
        const outNorm = percentageScore(m.outputRatio * 5); // scale 0.2 to 100
        return {
            label: m.model,
            color: modelColors[m.model] ?? '#3987e5',
            values: [speedNorm, cacheNorm, relNorm, outNorm],
        };
    });

    return (
        <div className="flex flex-col gap-6">
            {/* Cache Waste & Heaviest Sessions Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Cache Wasting Steps */}
                <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5">
                    <h4 className="font-bold text-sm mb-1">Top Cache-Wasting Incidents</h4>
                    <p className="text-xs text-base-content/60 mb-3">
                        Steps that re-sent full context without cache hits
                    </p>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
                        {(cacheHitTrend?.length ?? 0) > 1 && (
                            <div data-testid="cache-hit-trend-chart">
                                <LineChart
                                    points={(cacheHitTrend ?? []).map((p) => ({
                                        id: p.day,
                                        label: p.day.slice(5),
                                        v: p.cacheHitRatio,
                                    }))}
                                    color="#22d3ee"
                                    height={140}
                                />
                            </div>
                        )}
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs text-left font-mono">
                                <thead>
                                    <tr className="border-b border-base-content/10 text-base-content/60">
                                        <th className="py-1.5">Session</th>
                                        <th className="py-1.5">Fresh Tokens</th>
                                        <th className="py-1.5">Cause</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {cacheWaste.map((cw) => (
                                        <tr
                                            key={`${cw.sessionId}-${cw.freshTokens}-${cw.timestamp}`}
                                            className="border-b border-base-content/5 hover:bg-base-300/30"
                                        >
                                            <td className="py-1.5">
                                                <button
                                                    type="button"
                                                    className="text-primary hover:underline"
                                                    onClick={() => onSelectSession?.(cw.sessionId)}
                                                >
                                                    {cw.sessionId}
                                                </button>
                                            </td>
                                            <td className="py-1.5 text-error font-bold">{fmtTok(cw.freshTokens)}</td>
                                            <td className="py-1.5 text-base-content/70">{cw.reason}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Heaviest Sessions */}
                <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5">
                    <h4 className="font-bold text-sm mb-1">Heaviest Token Sessions</h4>
                    <p className="text-xs text-base-content/60 mb-3">Sessions consuming highest billed volume</p>
                    <div className="flex flex-col gap-3">
                        {heavySessions.map((s) => (
                            <div key={s.id} className="flex flex-col gap-1">
                                <div className="flex justify-between text-xs font-mono">
                                    <button
                                        type="button"
                                        className="text-primary hover:underline font-bold"
                                        onClick={() => onSelectSession?.(s.id, s.source)}
                                    >
                                        {s.id} ({s.source} · {s.model})
                                    </button>
                                    <span>{fmtTok(s.tokens)}</span>
                                </div>
                                <SparkBar value={s.tokens} max={maxHeavyTokens} color="#3987e5" height={6} />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Slow Steps Table (tbl-slowsteps) & Largest Token Steps */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Slow Steps Table */}
                <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5">
                    <h4 className="font-bold text-sm mb-1">Top Time-Consuming Steps</h4>
                    <p className="text-xs text-base-content/60 mb-3">Longest tool execution durations</p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left font-mono">
                            <thead>
                                <tr className="border-b border-base-content/10 text-base-content/60">
                                    <th className="py-1.5">Tool / Step</th>
                                    <th className="py-1.5">Session</th>
                                    <th className="py-1.5 text-right">Duration</th>
                                    <th className="py-1.5 text-right">Tokens</th>
                                </tr>
                            </thead>
                            <tbody>
                                {slowSteps.map((ss) => (
                                    <tr
                                        key={`${ss.sessionId}-${ss.toolName}-${ss.stepIndex}`}
                                        className="border-b border-base-content/5 hover:bg-base-300/30"
                                    >
                                        <td className="py-1.5 font-bold">
                                            {ss.toolName}{' '}
                                            <span className="text-[10px] text-base-content/50">#{ss.stepIndex}</span>
                                        </td>
                                        <td className="py-1.5">
                                            <button
                                                type="button"
                                                className="text-primary hover:underline"
                                                onClick={() => onSelectSession?.(ss.sessionId, ss.agent)}
                                            >
                                                {ss.sessionId}
                                            </button>
                                        </td>
                                        <td className="py-1.5 text-right text-amber-400 font-bold w-24">
                                            <div className="flex flex-col items-end gap-1">
                                                <span>{fmtMs(ss.durationMs ?? 0)}</span>
                                                <SparkBar
                                                    value={ss.durationMs ?? 0}
                                                    max={maxSlowDuration}
                                                    color="#fbbf24"
                                                    height={4}
                                                />
                                            </div>
                                        </td>
                                        <td className="py-1.5 text-right">{fmtTok(ss.tokens)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Largest Token Steps */}
                <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5">
                    <h4 className="font-bold text-sm mb-1">Largest Token Steps</h4>
                    <p className="text-xs text-base-content/60 mb-3">Single tool calls with highest token load</p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left font-mono">
                            <thead>
                                <tr className="border-b border-base-content/10 text-base-content/60">
                                    <th className="py-1.5">Tool / Step</th>
                                    <th className="py-1.5">Session</th>
                                    <th className="py-1.5">Agent / Model</th>
                                    <th className="py-1.5 text-right">Tokens</th>
                                </tr>
                            </thead>
                            <tbody>
                                {largestTokenSteps.map((ls) => (
                                    <tr
                                        key={`${ls.sessionId}-${ls.toolName}-${ls.stepIndex}`}
                                        className="border-b border-base-content/5 hover:bg-base-300/30"
                                    >
                                        <td className="py-1.5 font-bold">
                                            {ls.toolName}{' '}
                                            <span className="text-[10px] text-base-content/50">#{ls.stepIndex}</span>
                                        </td>
                                        <td className="py-1.5">
                                            <button
                                                type="button"
                                                className="text-primary hover:underline"
                                                onClick={() => onSelectSession?.(ls.sessionId, ls.agent)}
                                            >
                                                {ls.sessionId}
                                            </button>
                                        </td>
                                        <td className="py-1.5 text-xs text-base-content/70">
                                            {ls.agent} · {ls.model}
                                        </td>
                                        <td className="py-1.5 text-right text-primary font-bold">
                                            {fmtTok(ls.tokens)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Model Comparison Radar & Table Twin */}
            <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5">
                <h4 className="font-bold text-sm mb-1">Model Multi-Axis Comparison</h4>
                <p className="text-xs text-base-content/60 mb-4">Speed, Cache ratio, Reliability, and Output ratio</p>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-center">
                    {/* Radar Chart */}
                    <div className="flex justify-center">
                        <RadarChart axes={radarAxes} series={radarSeries} height={280} />
                    </div>

                    {/* Table Twin */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left font-mono">
                            <thead>
                                <tr className="border-b border-base-content/10 text-base-content/60">
                                    <th
                                        className="py-1.5 cursor-pointer select-none hover:text-base-content"
                                        onClick={() => handleModelSort('model')}
                                    >
                                        Model {sortIndicator('model')}
                                    </th>
                                    <th
                                        className="py-1.5 text-right cursor-pointer select-none hover:text-base-content"
                                        onClick={() => handleModelSort('speedMsMean')}
                                    >
                                        Mean Speed (ms) {sortIndicator('speedMsMean')}
                                    </th>
                                    <th
                                        className="py-1.5 text-right cursor-pointer select-none hover:text-base-content"
                                        onClick={() => handleModelSort('cacheRatio')}
                                    >
                                        Cache Ratio {sortIndicator('cacheRatio')}
                                    </th>
                                    <th
                                        className="py-1.5 text-right cursor-pointer select-none hover:text-base-content"
                                        onClick={() => handleModelSort('reliability')}
                                    >
                                        Reliability {sortIndicator('reliability')}
                                    </th>
                                    <th
                                        className="py-1.5 text-right cursor-pointer select-none hover:text-base-content"
                                        onClick={() => handleModelSort('outputRatio')}
                                    >
                                        Output Ratio {sortIndicator('outputRatio')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedModelComparison.map((m) => (
                                    <tr key={m.model} className="border-b border-base-content/5 hover:bg-base-300/30">
                                        <td className="py-1.5 font-bold flex items-center gap-1.5">
                                            <span
                                                className="w-2.5 h-2.5 rounded-full"
                                                style={{ background: modelColors[m.model] ?? '#3987e5' }}
                                            />
                                            {m.model}
                                        </td>
                                        <td className="py-1.5 text-right font-mono">{fmtInt(m.speedMsMean)}</td>
                                        <td className="py-1.5 text-right text-cyan-400 font-mono">
                                            {fmtPct(m.cacheRatio * 100)}
                                        </td>
                                        <td className="py-1.5 text-right text-emerald-400 font-mono">
                                            {fmtPct(m.reliability * 100)}
                                        </td>
                                        <td className="py-1.5 text-right font-mono">{fmtPct(m.outputRatio * 100)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Loop Detection Section */}
            {loops.length > 0 && (
                <div className="bg-base-200 rounded-xl shadow-sm border border-warning/30 p-5">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-warning text-lg">⚠️</span>
                        <h3 className="font-bold text-base">Detected Execution Loops (Repeats ≥ 3)</h3>
                    </div>
                    <p className="text-xs text-base-content/60 mb-4">
                        Identified consecutive identical tool invocations without intervening state changes.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {loops.map((lp) => (
                            <div
                                key={`${lp.tool}-${lp.sessionId}-${lp.fromSeq}`}
                                className="p-4 bg-base-300/70 rounded-xl border border-base-content/10 flex flex-col justify-between gap-3"
                            >
                                <div>
                                    <div className="flex justify-between items-center">
                                        <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-warning/20 text-warning border border-warning/30">
                                            {lp.tool} × {lp.repeats} repeats
                                        </span>
                                        <button
                                            type="button"
                                            className="text-xs font-mono text-primary hover:underline"
                                            onClick={() => onSelectSession?.(lp.sessionId)}
                                        >
                                            {lp.sessionId}
                                        </button>
                                    </div>
                                    <div className="font-mono text-xs text-base-content/80 mt-2">{lp.argsHint}</div>
                                    <div className="text-[11px] text-base-content/50 mt-1">
                                        Step sequence: #{lp.fromSeq} → #{lp.toSeq}
                                    </div>
                                </div>
                                <div className="flex justify-between items-center text-xs font-mono pt-2 border-t border-base-content/10">
                                    <span className="text-base-content/60">Estimated Wasted Tokens:</span>
                                    <span className="text-error font-bold">{fmtTok(lp.wastedTokens)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
export default InsightsTab;
