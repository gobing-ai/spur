import type { HistoryInsightsResponse, HistoryKpiTrendPoint, HistoryToolCategory } from '@gobing-ai/spur-contracts';
import type React from 'react';
import { useMemo, useState } from 'react';
import { fmtInt, fmtMs, fmtPct, fmtTok, LineChart, RadarChart, type RadarSeries, SparkBar } from './charts';
import { CATEGORY_BG_CLASS, RepeatedToolCallsList } from './ToolCallDetail';

export interface InsightsTabProps {
    data?: HistoryInsightsResponse['data'];
    loading?: boolean;
    error?: string | null;
    cacheHitTrend?: readonly HistoryKpiTrendPoint[];
    onSelectSession?: (sessionId: string, source?: string) => void;
}

/** Helper to categorize tool names for consistent badge styling */
function resolveToolCategory(name: string): HistoryToolCategory {
    const lower = name.toLowerCase();
    if (lower.includes('read') || lower.includes('view') || lower.includes('cat')) return 'read';
    if (lower.includes('write') || lower.includes('edit') || lower.includes('replace') || lower.includes('patch'))
        return 'write';
    if (lower.includes('bash') || lower.includes('command') || lower.includes('exec') || lower.includes('terminal'))
        return 'bash';
    if (lower.includes('grep') || lower.includes('find') || lower.includes('search') || lower.includes('glob'))
        return 'search';
    if (lower.includes('mcp')) return 'mcp';
    return 'other';
}

export const InsightsTab: React.FC<InsightsTabProps> = ({ data, loading, error, cacheHitTrend, onSelectSession }) => {
    type ModelSortKey = 'model' | 'speedMsMean' | 'cacheRatio' | 'reliability' | 'outputRatio';
    const [modelSortKey, setModelSortKey] = useState<ModelSortKey>('model');
    const [modelSortDir, setModelSortDir] = useState<'asc' | 'desc'>('asc');

    const modelColors: Record<string, string> = useMemo(
        () => ({
            'claude-opus-4.6': '#3987e5',
            'claude-sonnet-4.6': '#199e70',
            'gpt-5.6-sol': '#9085e9',
            'grok-4.6': '#d95926',
            other: '#898781',
        }),
        [],
    );

    const radarAxes = useMemo(() => ['Speed', 'Cache Ratio', 'Reliability', 'Output Ratio'], []);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center p-20 gap-3">
                <div className="w-9 h-9 rounded-full border-3 border-primary border-t-transparent animate-spin" />
                <span className="text-xs font-mono text-base-content/60">Analyzing operational insights...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-5 rounded-xl bg-error/10 border border-error/20 text-error flex items-center gap-3">
                <span className="text-lg">⚠️</span>
                <div>
                    <h5 className="font-bold text-sm">Failed to load insights</h5>
                    <p className="text-xs opacity-80">{error}</p>
                </div>
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

    // Summary Hero Metrics
    const totalWastedLoopTokens = loops.reduce((acc, l) => acc + (l.wastedTokens ?? 0), 0);
    const totalCacheWasteTokens = cacheWaste.reduce((acc, cw) => acc + (cw.freshTokens ?? 0), 0);
    const slowestStep = slowSteps[0];
    const largestStep = largestTokenSteps[0];

    // Cohort-normalized radar: Speed INVERTED so fastest model scores highest.
    const speeds = modelComparison.map((m) => m.speedMsMean);
    const minSpeed = speeds.length > 0 ? Math.min(...speeds) : 0;
    const maxSpeed = speeds.length > 0 ? Math.max(...speeds) : 0;
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
            {/* Top Operational KPI Strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Loops KPI */}
                <div
                    className={`rounded-xl p-4 border flex flex-col justify-between transition-all ${
                        loops.length > 0
                            ? 'bg-warning/10 border-warning/30 text-warning'
                            : 'bg-base-200 border-base-content/10'
                    }`}
                >
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-mono uppercase tracking-wider text-base-content/60">
                            Loop Anomalies
                        </span>
                        <span>{loops.length > 0 ? '⚠️' : '✓'}</span>
                    </div>
                    <div className="mt-2">
                        <div className="text-xl font-bold font-mono">
                            {loops.length} {loops.length === 1 ? 'incident' : 'incidents'}
                        </div>
                        <div className="text-[11px] text-base-content/60 font-mono mt-0.5">
                            {loops.length > 0 ? `${fmtTok(totalWastedLoopTokens)} wasted tokens` : 'Clean execution'}
                        </div>
                    </div>
                </div>

                {/* Cache Waste KPI */}
                <div className="bg-base-200 rounded-xl p-4 border border-base-content/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-mono uppercase tracking-wider text-base-content/60">
                            Cache Waste
                        </span>
                        <span className="text-cyan-400">⚡</span>
                    </div>
                    <div className="mt-2">
                        <div className="text-xl font-bold font-mono text-error">{fmtTok(totalCacheWasteTokens)}</div>
                        <div className="text-[11px] text-base-content/60 font-mono mt-0.5">
                            Across {cacheWaste.length} un-cached steps
                        </div>
                    </div>
                </div>

                {/* Peak Step Tokens */}
                <div className="bg-base-200 rounded-xl p-4 border border-base-content/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-mono uppercase tracking-wider text-base-content/60">
                            Peak Step Tokens
                        </span>
                        <span className="text-primary">📊</span>
                    </div>
                    <div className="mt-2">
                        <div className="text-xl font-bold font-mono text-primary">
                            {largestStep ? fmtTok(largestStep.tokens) : '—'}
                        </div>
                        <div className="text-[11px] text-base-content/60 font-mono mt-0.5 truncate">
                            {largestStep ? `${largestStep.toolName} (#${largestStep.stepIndex})` : 'No outlier steps'}
                        </div>
                    </div>
                </div>

                {/* Slowest Step Duration */}
                <div className="bg-base-200 rounded-xl p-4 border border-base-content/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-mono uppercase tracking-wider text-base-content/60">
                            Peak Latency
                        </span>
                        <span className="text-amber-400">⏱️</span>
                    </div>
                    <div className="mt-2">
                        <div className="text-xl font-bold font-mono text-amber-400">
                            {slowestStep?.durationMs ? fmtMs(slowestStep.durationMs) : '—'}
                        </div>
                        <div className="text-[11px] text-base-content/60 font-mono mt-0.5 truncate">
                            {slowestStep ? `${slowestStep.toolName} (#${slowestStep.stepIndex})` : 'No slow steps'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Cache Waste & Heaviest Sessions Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Cache Wasting Steps */}
                <div className="bg-base-200 rounded-xl shadow-xs border border-base-content/10 p-5 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <h4 className="font-bold text-sm">Top Cache-Wasting Incidents</h4>
                            <span className="text-[11px] font-mono text-base-content/50 bg-base-300 px-2 py-0.5 rounded-full">
                                {cacheWaste.length} incidents
                            </span>
                        </div>
                        <p className="text-xs text-base-content/60 mb-3">
                            Steps that re-sent full context without cache hits
                        </p>

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
                            {(cacheHitTrend?.length ?? 0) > 1 && (
                                <div
                                    data-testid="cache-hit-trend-chart"
                                    className="p-3 bg-base-300/40 rounded-xl border border-base-content/5"
                                >
                                    <div className="text-[10px] font-mono text-base-content/60 uppercase tracking-wider mb-2">
                                        Cache Hit Ratio Trend
                                    </div>
                                    <LineChart
                                        points={(cacheHitTrend ?? []).map((p) => ({
                                            id: p.day,
                                            label: p.day.slice(5),
                                            v: p.cacheHitRatio,
                                        }))}
                                        color="#22d3ee"
                                        height={130}
                                    />
                                </div>
                            )}
                            <div className="overflow-x-auto w-full">
                                {cacheWaste.length > 0 ? (
                                    <table className="w-full text-xs text-left font-mono">
                                        <thead>
                                            <tr className="border-b border-base-content/10 text-base-content/60">
                                                <th className="py-1.5">Session</th>
                                                <th className="py-1.5 text-right">Fresh Tokens</th>
                                                <th className="py-1.5 pl-3">Cause</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {cacheWaste.map((cw) => (
                                                <tr
                                                    key={`${cw.sessionId}-${cw.freshTokens}-${cw.timestamp}`}
                                                    className="border-b border-base-content/5 hover:bg-base-300/30 transition-colors"
                                                >
                                                    <td className="py-1.5">
                                                        <button
                                                            type="button"
                                                            className="text-primary hover:underline font-mono inline-flex items-center gap-1 cursor-pointer"
                                                            onClick={() => onSelectSession?.(cw.sessionId)}
                                                            title={`Jump to session ${cw.sessionId}`}
                                                        >
                                                            <span>{cw.sessionId}</span>
                                                            <span className="text-[10px] opacity-60">↗</span>
                                                        </button>
                                                    </td>
                                                    <td className="py-1.5 text-right text-error font-bold whitespace-nowrap">
                                                        {fmtTok(cw.freshTokens)}
                                                    </td>
                                                    <td
                                                        className="py-1.5 pl-3 text-base-content/70 truncate max-w-[140px]"
                                                        title={cw.reason}
                                                    >
                                                        {cw.reason}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                ) : (
                                    <div className="p-6 text-center text-xs font-mono text-base-content/50">
                                        ✓ No cache-wasting incidents detected
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Heaviest Sessions */}
                <div className="bg-base-200 rounded-xl shadow-xs border border-base-content/10 p-5 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <h4 className="font-bold text-sm">Heaviest Token Sessions</h4>
                            <span className="text-[11px] font-mono text-base-content/50 bg-base-300 px-2 py-0.5 rounded-full">
                                {heavySessions.length} sessions
                            </span>
                        </div>
                        <p className="text-xs text-base-content/60 mb-3">Sessions consuming highest billed volume</p>
                        <div className="flex flex-col gap-3">
                            {heavySessions.length > 0 ? (
                                heavySessions.map((s) => (
                                    <div
                                        key={s.id}
                                        className="p-3 bg-base-300/40 rounded-xl border border-base-content/5 flex flex-col gap-1.5 hover:bg-base-300/70 transition-colors"
                                    >
                                        <div className="flex justify-between items-center text-xs font-mono">
                                            <button
                                                type="button"
                                                className="text-primary hover:underline font-bold inline-flex items-center gap-1.5 cursor-pointer text-left"
                                                onClick={() => onSelectSession?.(s.id, s.source)}
                                                title={`Jump to session ${s.id}`}
                                            >
                                                <span>{s.id}</span>
                                                <span className="text-[10px] font-normal px-1.5 py-0.2 rounded bg-base-content/10 text-base-content/70">
                                                    {s.source} · {s.model}
                                                </span>
                                                <span className="text-[10px] opacity-60">↗</span>
                                            </button>
                                            <span className="font-bold">{fmtTok(s.tokens)}</span>
                                        </div>
                                        <SparkBar value={s.tokens} max={maxHeavyTokens} color="#3987e5" height={6} />
                                    </div>
                                ))
                            ) : (
                                <div className="p-8 text-center text-xs font-mono text-base-content/50">
                                    No heavy sessions recorded in this timeframe
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Slow Steps Table & Largest Token Steps */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Slow Steps Table */}
                <div className="bg-base-200 rounded-xl shadow-xs border border-base-content/10 p-5">
                    <div className="flex items-center justify-between mb-1">
                        <h4 className="font-bold text-sm">Top Time-Consuming Steps</h4>
                        <span className="text-[11px] font-mono text-base-content/50 bg-base-300 px-2 py-0.5 rounded-full">
                            {slowSteps.length} steps
                        </span>
                    </div>
                    <p className="text-xs text-base-content/60 mb-3">Longest tool execution durations</p>
                    <div className="overflow-x-auto">
                        {slowSteps.length > 0 ? (
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
                                    {slowSteps.map((ss) => {
                                        const cat = resolveToolCategory(ss.toolName);
                                        const catBadge = CATEGORY_BG_CLASS[cat] ?? CATEGORY_BG_CLASS.other;
                                        return (
                                            <tr
                                                key={`${ss.sessionId}-${ss.toolName}-${ss.stepIndex}`}
                                                className="border-b border-base-content/5 hover:bg-base-300/30 transition-colors"
                                            >
                                                <td className="py-1.5 font-bold">
                                                    <span
                                                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] border gap-1 mr-1.5 ${catBadge}`}
                                                    >
                                                        {ss.toolName}
                                                    </span>
                                                    <span className="text-[10px] text-base-content/50">
                                                        #{ss.stepIndex}
                                                    </span>
                                                </td>
                                                <td className="py-1.5">
                                                    <button
                                                        type="button"
                                                        className="text-primary hover:underline inline-flex items-center gap-1 cursor-pointer"
                                                        onClick={() => onSelectSession?.(ss.sessionId, ss.agent)}
                                                        title={`Jump to session ${ss.sessionId}`}
                                                    >
                                                        <span>{ss.sessionId}</span>
                                                        <span className="text-[10px] opacity-60">↗</span>
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
                                                <td className="py-1.5 text-right tabular-nums">{fmtTok(ss.tokens)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        ) : (
                            <div className="p-8 text-center text-xs font-mono text-base-content/50">
                                No slow steps recorded
                            </div>
                        )}
                    </div>
                </div>

                {/* Largest Token Steps */}
                <div className="bg-base-200 rounded-xl shadow-xs border border-base-content/10 p-5">
                    <div className="flex items-center justify-between mb-1">
                        <h4 className="font-bold text-sm">Largest Token Steps</h4>
                        <span className="text-[11px] font-mono text-base-content/50 bg-base-300 px-2 py-0.5 rounded-full">
                            {largestTokenSteps.length} steps
                        </span>
                    </div>
                    <p className="text-xs text-base-content/60 mb-3">Single tool calls with highest token load</p>
                    <div className="overflow-x-auto">
                        {largestTokenSteps.length > 0 ? (
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
                                    {largestTokenSteps.map((ls) => {
                                        const cat = resolveToolCategory(ls.toolName);
                                        const catBadge = CATEGORY_BG_CLASS[cat] ?? CATEGORY_BG_CLASS.other;
                                        return (
                                            <tr
                                                key={`${ls.sessionId}-${ls.toolName}-${ls.stepIndex}`}
                                                className="border-b border-base-content/5 hover:bg-base-300/30 transition-colors"
                                            >
                                                <td className="py-1.5 font-bold">
                                                    <span
                                                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] border gap-1 mr-1.5 ${catBadge}`}
                                                    >
                                                        {ls.toolName}
                                                    </span>
                                                    <span className="text-[10px] text-base-content/50">
                                                        #{ls.stepIndex}
                                                    </span>
                                                </td>
                                                <td className="py-1.5">
                                                    <button
                                                        type="button"
                                                        className="text-primary hover:underline inline-flex items-center gap-1 cursor-pointer"
                                                        onClick={() => onSelectSession?.(ls.sessionId, ls.agent)}
                                                        title={`Jump to session ${ls.sessionId}`}
                                                    >
                                                        <span>{ls.sessionId}</span>
                                                        <span className="text-[10px] opacity-60">↗</span>
                                                    </button>
                                                </td>
                                                <td className="py-1.5 text-xs text-base-content/70">
                                                    <span className="px-1.5 py-0.5 rounded bg-base-300 text-[11px]">
                                                        {ls.agent} · {ls.model}
                                                    </span>
                                                </td>
                                                <td className="py-1.5 text-right text-primary font-bold tabular-nums">
                                                    {fmtTok(ls.tokens)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        ) : (
                            <div className="p-8 text-center text-xs font-mono text-base-content/50">
                                No large token step outliers found
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Model Comparison Radar & Table Twin */}
            <div className="bg-base-200 rounded-xl shadow-xs border border-base-content/10 p-5">
                <div className="flex items-center justify-between mb-1">
                    <h4 className="font-bold text-sm">Model Multi-Axis Comparison</h4>
                    <span className="text-[11px] font-mono text-base-content/50 bg-base-300 px-2 py-0.5 rounded-full">
                        {modelComparison.length} models evaluated
                    </span>
                </div>
                <p className="text-xs text-base-content/60 mb-4">
                    Evaluation across Speed, Cache ratio, Reliability, and Output ratio
                </p>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-center">
                    {/* Radar Chart */}
                    <div className="flex flex-col items-center justify-center p-3 bg-base-300/30 rounded-xl border border-base-content/5">
                        <RadarChart axes={radarAxes} series={radarSeries} height={280} />
                        <div className="flex flex-wrap items-center justify-center gap-3 mt-3">
                            {radarSeries.map((s) => (
                                <span
                                    key={s.label}
                                    className="inline-flex items-center gap-1.5 text-xs font-mono text-base-content/80 px-2 py-0.5 rounded-full bg-base-300 border border-base-content/10"
                                >
                                    <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                                    {s.label}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Table Twin */}
                    <div className="overflow-x-auto w-full">
                        <table className="w-full text-xs text-left font-mono">
                            <thead>
                                <tr className="border-b border-base-content/10 text-base-content/60">
                                    <th
                                        className="py-2 cursor-pointer select-none hover:text-base-content"
                                        onClick={() => handleModelSort('model')}
                                    >
                                        Model {sortIndicator('model')}
                                    </th>
                                    <th
                                        className="py-2 text-right cursor-pointer select-none hover:text-base-content"
                                        onClick={() => handleModelSort('speedMsMean')}
                                    >
                                        Mean Speed (ms) {sortIndicator('speedMsMean')}
                                    </th>
                                    <th
                                        className="py-2 text-right cursor-pointer select-none hover:text-base-content"
                                        onClick={() => handleModelSort('cacheRatio')}
                                    >
                                        Cache Ratio {sortIndicator('cacheRatio')}
                                    </th>
                                    <th
                                        className="py-2 text-right cursor-pointer select-none hover:text-base-content"
                                        onClick={() => handleModelSort('reliability')}
                                    >
                                        Reliability {sortIndicator('reliability')}
                                    </th>
                                    <th
                                        className="py-2 text-right cursor-pointer select-none hover:text-base-content"
                                        onClick={() => handleModelSort('outputRatio')}
                                    >
                                        Output Ratio {sortIndicator('outputRatio')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedModelComparison.map((m) => (
                                    <tr
                                        key={m.model}
                                        className="border-b border-base-content/5 hover:bg-base-300/40 transition-colors"
                                    >
                                        <td className="py-2 font-bold flex items-center gap-2">
                                            <span
                                                className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs"
                                                style={{ background: modelColors[m.model] ?? '#3987e5' }}
                                            />
                                            <span className="truncate">{m.model}</span>
                                        </td>
                                        <td className="py-2 text-right font-mono tabular-nums">
                                            {fmtInt(m.speedMsMean)}
                                        </td>
                                        <td className="py-2 text-right font-mono tabular-nums text-cyan-400 font-bold">
                                            {fmtPct(m.cacheRatio * 100)}
                                        </td>
                                        <td
                                            className={`py-2 text-right font-mono tabular-nums font-bold ${
                                                m.reliability >= 0.95
                                                    ? 'text-emerald-400'
                                                    : m.reliability >= 0.8
                                                      ? 'text-amber-400'
                                                      : 'text-error'
                                            }`}
                                        >
                                            {fmtPct(m.reliability * 100)}
                                        </td>
                                        <td className="py-2 text-right font-mono tabular-nums text-base-content/80">
                                            {fmtPct(m.outputRatio * 100)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Loop Detection Section */}
            {loops.length > 0 && (
                <div className="bg-base-200 rounded-xl shadow-xs border border-warning/30 p-5">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <span className="text-warning text-lg">⚠️</span>
                            <h3 className="font-bold text-base">Detected Execution Loops (Repeats ≥ 3)</h3>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-warning/20 text-warning border border-warning/30">
                            {loops.length} loop {loops.length === 1 ? 'pattern' : 'patterns'} detected
                        </span>
                    </div>
                    <p className="text-xs text-base-content/60 mb-4">
                        Identified consecutive identical tool invocations without intervening state changes. Hover or
                        click on any invocation badge to inspect full arguments, duration, and diagnostics.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {loops.map((lp) => (
                            <div
                                key={`${lp.tool}-${lp.sessionId}-${lp.fromSeq}`}
                                className="p-4 bg-base-300/70 rounded-xl border border-base-content/10 flex flex-col justify-between gap-3 shadow-xs hover:border-warning/40 transition-colors"
                            >
                                <div>
                                    <div className="flex justify-between items-center">
                                        <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-warning/20 text-warning border border-warning/30">
                                            {lp.tool} × {lp.repeats} repeats
                                        </span>
                                        <button
                                            type="button"
                                            className="text-xs font-mono text-primary hover:underline cursor-pointer inline-flex items-center gap-1 font-bold"
                                            onClick={() => onSelectSession?.(lp.sessionId)}
                                            title="Jump to session in Tool Using & Timeline"
                                        >
                                            {lp.sessionId} →
                                        </button>
                                    </div>
                                    <div
                                        className="font-mono text-xs text-base-content/80 mt-2 p-2 bg-base-200/80 rounded-lg border border-base-content/5 truncate"
                                        title={lp.argsHint}
                                    >
                                        <span className="text-[10px] text-base-content/50 block mb-0.5 uppercase tracking-wider">
                                            Argument signature
                                        </span>
                                        {lp.argsHint ===
                                        '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b'
                                            ? 'empty/unrecorded arguments'
                                            : lp.argsHint}
                                    </div>
                                    <div className="text-[11px] font-mono text-base-content/60 mt-2">
                                        Step sequence: #{lp.fromSeq} → #{lp.toSeq}
                                    </div>

                                    {/* Repeated Tool Invocations with Tooltips */}
                                    <div className="mt-3 pt-2.5 border-t border-base-content/10">
                                        <div className="text-[10px] font-mono uppercase tracking-wider text-base-content/50 mb-1.5">
                                            Repeated Invocations (hover/click for details):
                                        </div>
                                        <RepeatedToolCallsList
                                            calls={lp.repeatedCalls}
                                            fromSeq={lp.fromSeq}
                                            toSeq={lp.toSeq}
                                            toolName={lp.tool}
                                            sessionId={lp.sessionId}
                                        />
                                    </div>
                                </div>
                                <div className="flex justify-between items-center text-xs font-mono pt-2 border-t border-base-content/10 bg-base-200/40 -mx-4 -mb-4 p-3 rounded-b-xl">
                                    <span className="text-base-content/60">Estimated Wasted Tokens:</span>
                                    <span className="text-error font-bold text-sm">{fmtTok(lp.wastedTokens)}</span>
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
