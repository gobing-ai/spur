import type React from 'react';
import { useEffect, useRef, useState } from 'react';

// ─── Formatters & Pure Math Helpers ──────────────────────────────────────────

export function resolveAutoBucket(range: string): '1m' | '3m' | '5m' | '10m' | '30m' | '1h' | '4h' | '1d' {
    if (range === '1h') return '1m';
    if (range === '4h') return '3m';
    if (range === '24h') return '10m';
    if (range === '7d') return '30m';
    return '1d';
}

export function fmtTok(n: number): string {
    if (!Number.isFinite(n) || n === 0) return '0';
    const a = Math.abs(n);
    if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return Math.round(n).toLocaleString();
}

export function fmtTokAxis(n: number): string {
    if (n === 0) return '0';
    if (Math.abs(n) >= 1e6) return `${Math.round(n / 1e6)}M`;
    if (Math.abs(n) >= 1e3) return `${Math.round(n / 1e3)}K`;
    return Math.round(n).toString();
}

export function fmtInt(n: number): string {
    return Math.round(n).toLocaleString();
}

export function fmtPct(n: number, d = 1): string {
    return `${n.toFixed(d)}%`;
}

export function fmtDur(min: number): string {
    if (min < 1) return '<1m';
    if (min < 60) return `${Math.round(min)}m`;
    const h = Math.floor(min / 60);
    return `${h}h ${Math.round(min - h * 60)}m`;
}

export function fmtMs(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function niceTicks(max: number, count = 4): number[] {
    if (max <= 0) return [0, 1];
    const raw = max / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    const out: number[] = [];
    for (let v = 0; v <= max * 1.0001 + step / 2; v += step) {
        out.push(v);
    }
    const last = out[out.length - 1];
    if (last !== undefined && last < max) {
        out.push(last + step);
    }
    return out;
}

// ─── Dual-Axis Stacked Column & Line Overlay ─────────────────────────────────

export interface StackedColumnBucket {
    id?: string;
    label: string;
    v: Record<string, number>;
    lineValue?: number;
}

export interface ChartSeries {
    id: string;
    label: string;
    color: string;
}

export const StackedColumnsChart: React.FC<{
    buckets: StackedColumnBucket[];
    series: ChartSeries[];
    lineColor?: string;
    height?: number;
}> = ({ buckets, series, lineColor = '#22d3ee', height = 260 }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(1000);
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;
        const el = containerRef.current;
        const updateWidth = () => {
            const w = el.clientWidth;
            if (w > 0) setWidth(w);
        };
        updateWidth();
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const w = Math.round(entry.contentRect.width);
                if (w > 0) setWidth(w);
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const W = width;
    const PL = 54;
    const PR = 50;
    const PT = 16;
    const PB = 26;
    const iw = Math.max(60, W - PL - PR);
    const ih = height - PT - PB;

    const totals = buckets.map((b) => series.reduce((a, s) => a + (b.v[s.id] || 0), 0));
    const max = Math.max(1, ...totals);
    const ticks = niceTicks(max, 4);
    const top = ticks[ticks.length - 1] || max;
    const y = (v: number) => PT + ih - (v / top) * ih;
    const yPct = (v: number) => PT + ih - (Math.max(0, Math.min(100, v)) / 100) * ih;

    const band = iw / Math.max(1, buckets.length);
    const bw = Math.max(2, band * 0.85);
    const cx = (i: number) => PL + i * band + band / 2;

    const maxLabels = Math.max(2, Math.floor(iw / 70));
    const labelEvery = Math.max(1, Math.ceil(buckets.length / maxLabels));

    const linePoints = buckets
        .map((b, i) => (b.lineValue !== undefined ? { x: cx(i), y: yPct(b.lineValue) } : null))
        .filter((p): p is { x: number; y: number } => p !== null);

    const linePath =
        linePoints.length > 1
            ? linePoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
            : '';

    const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        if (rect.width <= 0) return;
        const svgX = ((e.clientX - rect.left) / rect.width) * W;
        const colX = svgX - PL;
        if (colX >= 0 && colX <= iw) {
            const idx = Math.floor(colX / band);
            if (idx >= 0 && idx < buckets.length) {
                setHoverIdx(idx);
                return;
            }
        }
        setHoverIdx(null);
    };

    const tooltipLeft = hoverIdx !== null ? Math.max(110, Math.min(W - 110, cx(hoverIdx))) : W / 2;

    return (
        <div ref={containerRef} className="relative w-full overflow-hidden">
            <svg
                viewBox={`0 0 ${W} ${height}`}
                width="100%"
                height={height}
                className="w-full block select-none"
                role="img"
                aria-label="Stacked column token chart with cache hit ratio overlay"
                onMouseMove={handleSvgMouseMove}
                onMouseLeave={() => setHoverIdx(null)}
            >
                {/* Left Y Axis grid & labels */}
                {ticks.map((t) => (
                    <g key={t}>
                        <line x1={PL} x2={PL + iw} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={0.1} />
                        <text x={PL - 8} y={y(t) + 3.5} textAnchor="end" className="text-[10px] fill-base-content/60">
                            {fmtTokAxis(t)}
                        </text>
                    </g>
                ))}

                {/* Right Y Axis labels for Cache Hit Ratio */}
                {[0, 25, 50, 75, 100].map((pct) => (
                    <text
                        key={pct}
                        x={PL + iw + 8}
                        y={yPct(pct) + 3.5}
                        textAnchor="start"
                        fill={lineColor}
                        className="text-[10px] opacity-80"
                    >
                        {pct}%
                    </text>
                ))}

                {/* Hover Column Highlight Band */}
                {hoverIdx !== null && (
                    <rect
                        x={PL + hoverIdx * band}
                        y={PT}
                        width={band}
                        height={ih}
                        fill="currentColor"
                        fillOpacity={0.04}
                        rx={2}
                    />
                )}

                {/* Stacked Columns */}
                {buckets.map((b, i) => {
                    const x = PL + i * band + (band - bw) / 2;
                    let acc = 0;
                    return (
                        <g key={b.id ?? `${b.label}-${i}`} opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.45}>
                            {series
                                .slice()
                                .reverse()
                                .map((sr) => {
                                    const v = b.v[sr.id] || 0;
                                    if (v <= 0) return null;
                                    const yTop = y(acc + v);
                                    const hRaw = y(acc) - yTop;
                                    const segH = Math.max(1, hRaw);
                                    acc += v;
                                    return (
                                        <rect
                                            key={sr.id}
                                            x={x}
                                            y={yTop}
                                            width={bw}
                                            height={segH}
                                            fill={sr.color}
                                            rx={1}
                                        />
                                    );
                                })}
                            {i % labelEvery === 0 && (
                                <text
                                    x={cx(i)}
                                    y={height - 6}
                                    textAnchor="middle"
                                    className="text-[10px] fill-base-content/60"
                                >
                                    {b.label}
                                </text>
                            )}
                        </g>
                    );
                })}

                {/* Secondary Rate Line */}
                {linePath && (
                    <>
                        <path
                            d={linePath}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={4}
                            strokeOpacity={0.2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        <path
                            d={linePath}
                            fill="none"
                            stroke={lineColor}
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </>
                )}

                {/* Active Hover Dot on Line */}
                {hoverIdx !== null && buckets[hoverIdx]?.lineValue !== undefined && (
                    <circle
                        cx={cx(hoverIdx)}
                        cy={yPct(buckets[hoverIdx]?.lineValue ?? 0)}
                        r={4.5}
                        fill={lineColor}
                        stroke="#1f2937"
                        strokeWidth={2}
                    />
                )}
            </svg>

            {/* Hover Tooltip Overlay */}
            {hoverIdx !== null && buckets[hoverIdx] && (
                <div
                    className="absolute top-2 bg-base-300 border border-base-content/15 shadow-xl rounded-lg px-3 py-2 text-xs pointer-events-none z-20 flex flex-col gap-1 min-w-[180px] backdrop-blur-sm"
                    style={{ left: `${tooltipLeft}px`, transform: 'translateX(-50%)' }}
                >
                    <div className="font-semibold text-base-content/90 border-b border-base-content/10 pb-1">
                        {(buckets[hoverIdx]?.id ?? buckets[hoverIdx]?.label ?? '').slice(0, 16).replace('T', ' ')}
                    </div>
                    {series
                        .filter((s) => (buckets[hoverIdx]?.v[s.id] ?? 0) > 0)
                        .map((s) => (
                            <div key={s.id} className="flex justify-between items-center gap-2">
                                <span className="flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                                    {s.label}
                                </span>
                                <span className="font-mono">{fmtTok(buckets[hoverIdx]?.v[s.id] ?? 0)}</span>
                            </div>
                        ))}
                    <div className="flex justify-between items-center font-bold pt-1 border-t border-base-content/10">
                        <span>Total</span>
                        <span className="font-mono">{fmtTok(totals[hoverIdx] ?? 0)}</span>
                    </div>
                    {buckets[hoverIdx]?.lineValue !== undefined && (
                        <div className="flex justify-between items-center text-cyan-400">
                            <span>Cache Hit Ratio</span>
                            <span className="font-mono">{buckets[hoverIdx]?.lineValue}%</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// ─── Stacked Area Chart ──────────────────────────────────────────────────────

export const StackedAreaChart: React.FC<{
    buckets: { id?: string; label: string; v: Record<string, number> }[];
    series: ChartSeries[];
    height?: number;
}> = ({ buckets, series, height = 200 }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(540);

    useEffect(() => {
        if (!containerRef.current) return;
        const el = containerRef.current;
        const updateWidth = () => {
            const w = el.clientWidth;
            if (w > 0) setWidth(w);
        };
        updateWidth();
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const w = Math.round(entry.contentRect.width);
                if (w > 0) setWidth(w);
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const W = width;
    const PL = 46;
    const PR = 12;
    const PT = 10;
    const PB = 24;
    const iw = Math.max(60, W - PL - PR);
    const ih = height - PT - PB;
    const n = buckets.length;

    const totals = buckets.map((b) => series.reduce((a, s) => a + (b.v[s.id] || 0), 0));
    const top = niceTicks(Math.max(1, ...totals), 3).pop() || 1;
    const x = (i: number) => PL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v: number) => PT + ih - (v / top) * ih;

    const acc = new Array(n).fill(0);
    const areas = series.map((s) => {
        const lower = acc.slice();
        const upper = acc.map((a, i) => a + (buckets[i]?.v[s.id] || 0));
        let d = `M${x(0)},${y(upper[0] || 0)}`;
        for (let i = 1; i < n; i++) d += `L${x(i)},${y(upper[i] || 0)}`;
        for (let i = n - 1; i >= 0; i--) d += `L${x(i)},${y(lower[i] || 0)}`;
        d += 'Z';
        for (let i = 0; i < n; i++) acc[i] = upper[i] || 0;
        return { id: s.id, color: s.color, d };
    });

    return (
        <div ref={containerRef} className="w-full overflow-hidden">
            <svg
                viewBox={`0 0 ${W} ${height}`}
                width="100%"
                height={height}
                className="w-full block select-none"
                role="img"
                aria-label="Stacked area chart"
            >
                {niceTicks(top, 3).map((t) => (
                    <g key={t}>
                        <line x1={PL} x2={PL + iw} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={0.1} />
                        <text x={PL - 7} y={y(t) + 3.5} textAnchor="end" className="text-[10px] fill-base-content/60">
                            {fmtTokAxis(t)}
                        </text>
                    </g>
                ))}
                {areas.map((ar) => (
                    <path key={ar.id} d={ar.d} fill={ar.color} opacity={0.8} />
                ))}
                {buckets.map((b, i) =>
                    i % Math.ceil(n / 6) === 0 ? (
                        <text
                            key={b.id ?? b.label}
                            x={x(i)}
                            y={height - 6}
                            textAnchor="middle"
                            className="text-[10px] fill-base-content/60"
                        >
                            {b.label}
                        </text>
                    ) : null,
                )}
            </svg>
        </div>
    );
};

// ─── Single Series Line Chart ────────────────────────────────────────────────

export const LineChart: React.FC<{
    points: { id?: string; label: string; v: number }[];
    color?: string;
    height?: number;
    valueFmt?: (v: number) => string;
}> = ({ points, color = '#3987e5', height = 190, valueFmt: _valueFmt = fmtPct }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(540);

    useEffect(() => {
        if (!containerRef.current) return;
        const el = containerRef.current;
        const updateWidth = () => {
            const w = el.clientWidth;
            if (w > 0) setWidth(w);
        };
        updateWidth();
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const w = Math.round(entry.contentRect.width);
                if (w > 0) setWidth(w);
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const W = width;
    const PL = 44;
    const PR = 12;
    const PT = 14;
    const PB = 24;
    const iw = Math.max(60, W - PL - PR);
    const ih = height - PT - PB;
    const n = points.length;
    const hi = 100;
    const lo = 0;
    const x = (i: number) => PL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v: number) => PT + ih - ((v - lo) / (hi - lo)) * ih;

    let d = `M${x(0)},${y(points[0]?.v ?? 0)}`;
    for (let i = 1; i < n; i++) d += `L${x(i)},${y(points[i]?.v ?? 0)}`;

    return (
        <div ref={containerRef} className="w-full overflow-hidden">
            <svg
                viewBox={`0 0 ${W} ${height}`}
                width="100%"
                height={height}
                className="w-full block select-none"
                role="img"
                aria-label="Line chart"
            >
                {[0, 25, 50, 75, 100].map((t) => (
                    <g key={t}>
                        <line x1={PL} x2={PL + iw} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={0.1} />
                        <text x={PL - 7} y={y(t) + 3.5} textAnchor="end" className="text-[10px] fill-base-content/60">
                            {t}%
                        </text>
                    </g>
                ))}
                <path d={`${d}L${x(n - 1)},${PT + ih}L${x(0)},${PT + ih}Z`} fill={color} opacity={0.1} />
                <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                {points.map((p, i) =>
                    i % Math.ceil(n / 6) === 0 || i === n - 1 ? (
                        <text
                            key={p.id ?? p.label}
                            x={x(i)}
                            y={height - 6}
                            textAnchor="middle"
                            className="text-[10px] fill-base-content/60"
                        >
                            {p.label}
                        </text>
                    ) : null,
                )}
            </svg>
        </div>
    );
};

// ─── Radar Chart (4-Axis Model Comparison) ───────────────────────────────────

export interface RadarSeries {
    label: string;
    color: string;
    values: number[]; // 0 to 100
}

export const RadarChart: React.FC<{
    axes: string[];
    series: RadarSeries[];
    height?: number;
}> = ({ axes, series, height = 260 }) => {
    const W = 520;
    const cx = W / 2;
    const cy = height / 2 + 4;
    const R = Math.min(W / 2 - 78, height / 2 - 44);
    const k = axes.length;
    const ang = (i: number) => -Math.PI / 2 + (i / k) * Math.PI * 2;
    const pt = (i: number, f: number) => [cx + Math.cos(ang(i)) * R * f, cy + Math.sin(ang(i)) * R * f];

    return (
        <svg viewBox={`0 0 ${W} ${height}`} className="w-full h-auto select-none" role="img" aria-label="Radar chart">
            {/* Grid Webs */}
            {[0.25, 0.5, 0.75, 1].map((f) => {
                const d = `${axes
                    .map((_, i) => {
                        const [px, py] = pt(i, f);
                        return `${i === 0 ? 'M' : 'L'}${px?.toFixed(1)},${py?.toFixed(1)}`;
                    })
                    .join(' ')}Z`;
                return <path key={f} d={d} fill="none" stroke="currentColor" strokeOpacity={0.15} />;
            })}

            {/* Axes */}
            {axes.map((a, i) => {
                const [px, py] = pt(i, 1);
                const [lx, ly] = pt(i, 1.2);
                return (
                    <g key={a}>
                        <line x1={cx} y1={cy} x2={px} y2={py} stroke="currentColor" strokeOpacity={0.2} />
                        <text
                            x={lx}
                            y={(ly ?? 0) + 3.5}
                            textAnchor={Math.abs((lx ?? 0) - cx) < 6 ? 'middle' : (lx ?? 0) > cx ? 'start' : 'end'}
                            className="text-[11px] font-semibold fill-base-content/80"
                        >
                            {a}
                        </text>
                    </g>
                );
            })}

            {/* Polygons */}
            {series.map((s) => {
                const d = `${s.values
                    .map((v, i) => {
                        const [px, py] = pt(i, Math.max(0.04, v / 100));
                        return `${i === 0 ? 'M' : 'L'}${px?.toFixed(1)},${py?.toFixed(1)}`;
                    })
                    .join(' ')}Z`;
                return (
                    <g key={s.label}>
                        <path d={d} fill={s.color} opacity={0.15} />
                        <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
                        {s.values.map((v, i) => {
                            const [px, py] = pt(i, Math.max(0.04, v / 100));
                            return (
                                <circle
                                    key={`${s.label}-${axes[i]}`}
                                    cx={px}
                                    cy={py}
                                    r={3.5}
                                    fill={s.color}
                                    stroke="#1f2937"
                                    strokeWidth={1.5}
                                />
                            );
                        })}
                    </g>
                );
            })}
        </svg>
    );
};

// ─── 90-Day Daily Activity Heatmap Grid ──────────────────────────────────────

const HEAT_LEVEL_OPACITY = [0, 0.3, 0.5, 0.75, 1] as const;

interface HeatDay {
    date: string;
    tokens: number;
    sessions: number;
}

/**
 * Heat intensity per day. Sources that report no token telemetry at all (e.g. Antigravity CLI
 * transcripts carry no usage fields) would otherwise render as an all-gray grid; fall back to
 * session counts so real activity still shows, while keeping reported token counts honest.
 */
const maxDailyValue = (days: readonly HeatDay[], metric: 'tokens' | 'sessions'): number =>
    days.reduce((max, day) => Math.max(max, day[metric]), 0);

const heatLevel = (value: number, max: number): 0 | 1 | 2 | 3 | 4 => {
    if (value <= 0 || max <= 0) return 0;
    const q = value / max;
    if (q <= 0.25) return 1;
    if (q <= 0.5) return 2;
    if (q <= 0.75) return 3;
    return 4;
};

export const HeatmapGrid: React.FC<{
    days: Array<{ date: string; tokens: number; sessions: number }>;
    color?: string;
    maxDailyTokens?: number;
}> = ({ days, color = '#3987e5', maxDailyTokens }) => {
    const [hoveredCell, setHoveredCell] = useState<{
        date: string;
        tokens: number;
        sessions: number;
        colIdx: number;
    } | null>(null);

    // Prefer token telemetry; fall back to session counts when the source reports none.
    const tokenMax = maxDailyTokens ?? maxDailyValue(days, 'tokens');
    const useSessions = tokenMax <= 0 && maxDailyValue(days, 'sessions') > 0;
    const activeMax = useSessions ? maxDailyValue(days, 'sessions') : tokenMax;

    // The prototype contract is exactly 90 sequential days: 13 columns, seven rows.
    const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
    const weeks: HeatDay[][] = [];
    for (let i = 0; i < sorted.length; i += 7) weeks.push(sorted.slice(i, i + 7));

    const monthLabel = (wi: number): string => {
        const firstReal = weeks[wi]?.[0];
        if (!firstReal) return '';
        const month = new Date(`${firstReal.date}T00:00:00Z`).toLocaleString('en-US', {
            month: 'short',
            timeZone: 'UTC',
        });
        if (wi === 0) return month;
        const prevFirst = weeks[wi - 1]?.[0];
        if (!prevFirst) return month;
        return prevFirst.date.slice(0, 7) === firstReal.date.slice(0, 7) ? '' : month;
    };

    return (
        <section
            className="relative flex flex-col gap-1.5 w-full"
            data-testid="heatmap-calendar"
            aria-label="Daily activity heatmap"
            onMouseLeave={() => setHoveredCell(null)}
        >
            {/* Interactive Hover Tooltip */}
            {hoveredCell && (
                <div
                    className="absolute -top-1 pointer-events-none z-30 transform -translate-x-1/2 -translate-y-full flex flex-col items-center min-w-[140px] transition-all duration-75"
                    style={{
                        left: `${Math.max(20, Math.min(80, ((hoveredCell.colIdx + 0.5) / 13) * 100))}%`,
                    }}
                >
                    <div className="bg-base-100 border border-base-content/20 shadow-xl rounded-md px-2.5 py-1.5 text-[10px] font-mono text-center text-base-content backdrop-blur-md">
                        <div className="font-bold text-primary">{hoveredCell.date}</div>
                        <div className="text-base-content/90 font-medium">
                            <span className="text-base-content font-bold">{fmtTok(hoveredCell.tokens)}</span> tokens
                        </div>
                        <div className="text-base-content/60 text-[9px]">
                            {hoveredCell.sessions} {hoveredCell.sessions === 1 ? 'session' : 'sessions'}
                        </div>
                    </div>
                    <div className="w-1.5 h-1.5 bg-base-100 border-r border-b border-base-content/20 transform rotate-45 -mt-0.5" />
                </div>
            )}

            <div className="flex items-start gap-1 w-full">
                <div
                    className="w-5 shrink-0 pt-3 flex flex-col gap-[3px] text-[9px] font-mono text-base-content/50 select-none"
                    aria-hidden="true"
                >
                    {['Mon', '', 'Wed', '', 'Fri', '', ''].map((label, index) => (
                        <div
                            key={label || `weekday-${index}`}
                            className="w-full aspect-square flex items-center justify-end pr-1 leading-none"
                        >
                            {label}
                        </div>
                    ))}
                </div>
                <div
                    className="flex-1 w-full"
                    style={{ display: 'grid', gridTemplateColumns: 'repeat(13, minmax(0, 1fr))', gap: '3px' }}
                >
                    {weeks.map((week, wi) => {
                        const firstDay = week[0];
                        return (
                            <div
                                key={firstDay?.date ?? `week-${wi}`}
                                className="flex flex-col gap-[3px]"
                                data-testid="heatmap-week"
                            >
                                <div className="h-3 text-[9px] leading-3 text-base-content/50 truncate font-mono">
                                    {monthLabel(wi)}
                                </div>
                                <div className="flex flex-col gap-[3px]">
                                    {week.map((cell) => {
                                        const lvl = heatLevel(useSessions ? cell.sessions : cell.tokens, activeMax);
                                        return (
                                            <button
                                                type="button"
                                                key={cell.date}
                                                className="w-full aspect-square rounded-[2px] p-0 border-0 transition-transform hover:scale-125 focus:scale-125 focus:outline-hidden cursor-pointer"
                                                style={
                                                    lvl === 0
                                                        ? { backgroundColor: 'currentColor', opacity: 0.08 }
                                                        : {
                                                              backgroundColor: color,
                                                              opacity: HEAT_LEVEL_OPACITY[lvl],
                                                          }
                                                }
                                                onMouseEnter={() => setHoveredCell({ ...cell, colIdx: wi })}
                                                onFocus={() => setHoveredCell({ ...cell, colIdx: wi })}
                                                onBlur={() => setHoveredCell(null)}
                                                title={`${cell.date}: ${fmtTok(cell.tokens)} tokens (${cell.sessions} sessions)`}
                                            >
                                                <span className="sr-only">
                                                    {`${cell.date}: ${fmtTok(cell.tokens)} tokens, ${cell.sessions} sessions`}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="flex items-center justify-end gap-1.5 pt-0.5">
                <div className="flex items-center gap-1 text-[9px] font-mono text-base-content/50">
                    <span>Less</span>
                    {HEAT_LEVEL_OPACITY.map((opacity) => (
                        <span
                            key={opacity}
                            className="w-2.5 h-2.5 rounded-[2px] inline-block"
                            style={
                                opacity === 0
                                    ? { backgroundColor: 'currentColor', opacity: 0.08 }
                                    : { backgroundColor: color, opacity }
                            }
                        />
                    ))}
                    <span>More</span>
                </div>
            </div>
        </section>
    );
};

// ─── SparkBar / Mini Progress ────────────────────────────────────────────────

export const SparkBar: React.FC<{
    value: number;
    max: number;
    color?: string;
    height?: number;
}> = ({ value, max, color = '#3987e5', height = 6 }) => {
    const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
    return (
        <div className="w-full bg-base-300 rounded-full overflow-hidden" style={{ height }}>
            <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${pct}%`, backgroundColor: color }}
            />
        </div>
    );
};

// ─── Sparkline ───────────────────────────────────────────────────────────────

export const Sparkline: React.FC<{
    values: number[];
    color?: string;
    width?: number;
    height?: number;
}> = ({ values, color = '#3987e5', width = 120, height = 36 }) => {
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const span = max - min || 1;
    const n = values.length;
    const x = (i: number) => (n <= 1 ? width / 2 : (i / (n - 1)) * (width - 4) + 2);
    const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
    let d = '';
    if (n > 0) {
        d = `M${x(0)},${y(values[0] ?? 0)}`;
        for (let i = 1; i < n; i++) d += `L${x(i)},${y(values[i] ?? 0)}`;
    }
    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            className="inline-block select-none overflow-visible"
            style={{ width, height }}
            role="img"
            aria-label="Trend sparkline"
        >
            {n > 1 && <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" />}
            {n === 1 && <circle cx={x(0)} cy={y(values[0] ?? 0)} r={2} fill={color} />}
        </svg>
    );
};
