import type { HistoryTimelineEvent, HistoryTimelineResponse } from '@gobing-ai/spur-contracts';
import type React from 'react';
import { useState } from 'react';
import { AgentIcon } from './AgentIcon';
import { fmtDur, fmtInt, fmtMs, fmtTok } from './charts';

export interface TimelineTabProps {
    data?: HistoryTimelineResponse['data'];
    loading?: boolean;
    error?: string | null;
    sessionId?: string;
    availableSessions?: Array<{ id: string; source: string; model: string; start: string; tokenLoad: number }>;
    onSelectSession?: (id: string) => void;
}

const eventKey = (turnIndex: number, seq: number): string => `${turnIndex}:${seq}`;

const tokenLoad = (fresh: number, cache: number, output: number): number => fresh + cache + output;

const cacheReadPercent = (fresh: number, cache: number): number => {
    const denominator = fresh + cache;
    return denominator > 0 ? (cache / denominator) * 100 : 0;
};

const shortSessionId = (id: string): string => {
    if (id.length <= 12) return id;
    return `${id.slice(0, 8)}…${id.slice(-4)}`;
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const fmtUtcDayTime = (ts: string): string => {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    const m = MONTH_NAMES[d.getUTCMonth()];
    const day = d.getUTCDate();
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${m} ${day} ${hh}:${mm}`;
};

const fmtUtcClock = (ts: string): string => {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts.slice(11, 19) || ts;
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
};

const sessionOptionLabel = (row: { id: string; source: string; start: string; tokenLoad: number }): string => {
    return `${shortSessionId(row.id)} · ${row.source} · ${fmtUtcDayTime(row.start)} · ${fmtTok(row.tokenLoad)}`;
};

const promptText = (ev: HistoryTimelineEvent): string => {
    const trimmed = ev.payload?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : ev.title;
};

const promptSummary = (text: string): string => {
    const firstLine = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0);
    return firstLine ?? text;
};

const isAssistantEvent = (event: HistoryTimelineEvent): boolean =>
    event.kind === 'assistant' || (event.kind === 'run' && event.eventType === 'message');

interface ToolPresentation {
    label: string;
    color: string;
}

const toolPresentation = (event: HistoryTimelineEvent): ToolPresentation => {
    const t = event.title.toLowerCase();
    if (t.includes('glob')) {
        return {
            label: 'glob',
            color: '#6366f1',
        };
    }
    if (t.includes('grep')) {
        return {
            label: 'grep',
            color: '#a855f7',
        };
    }
    if (t.includes('edit')) {
        return {
            label: 'edit',
            color: '#eab308',
        };
    }
    switch (event.kind) {
        case 'read':
            return {
                label: 'read',
                color: '#10b981',
            };
        case 'write':
            return {
                label: 'write',
                color: '#f43f5e',
            };
        case 'bash':
            return {
                label: 'bash',
                color: '#3b82f6',
            };
        case 'search':
            return {
                label: 'search',
                color: '#a855f7',
            };
        case 'run':
            return {
                label: 'run',
                color: '#f59e0b',
            };
        default:
            return {
                label: event.kind,
                color: '#64748b',
            };
    }
};

const UserIcon: React.FC = () => (
    <svg
        width={14}
        height={14}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        role="img"
        aria-label="User icon"
    >
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
    </svg>
);

/** User prompt icon badge with hover/focus token breakdown tooltip. */
const UserTokenBadge: React.FC<{
    freshInputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    tooltipId: string;
}> = ({ freshInputTokens, cacheReadTokens, outputTokens, tooltipId }) => {
    const [open, setOpen] = useState(false);
    const total = tokenLoad(freshInputTokens, cacheReadTokens, outputTokens);
    return (
        <div className="relative inline-flex items-center z-20">
            <button
                type="button"
                aria-label="Show user prompt token breakdown"
                aria-describedby={tooltipId}
                data-testid={`timeline-user-badge-${tooltipId}`}
                className="p-1 rounded bg-base-300 text-cyan-400 shrink-0 hover:bg-base-content/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary transition-colors cursor-pointer"
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') setOpen(false);
                }}
            >
                <UserIcon />
            </button>
            <div
                id={tooltipId}
                role="tooltip"
                data-testid={tooltipId}
                className={`absolute left-0 top-full z-50 mt-1.5 w-52 p-2 rounded-lg bg-base-300 border border-base-content/20 shadow-2xl text-[11px] font-mono leading-relaxed pointer-events-none ${
                    open ? 'block' : 'hidden'
                }`}
            >
                <div className="font-bold text-base-content mb-1">User Prompt Tokens</div>
                <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-base-content/80">
                    <span className="text-base-content/60">📥 Fresh input:</span>
                    <span>{fmtTok(freshInputTokens)}</span>
                    <span className="text-base-content/60">💾 Cache read:</span>
                    <span className="text-cyan-400">{fmtTok(cacheReadTokens)}</span>
                    <span className="text-base-content/60">📤 Output:</span>
                    <span>{fmtTok(outputTokens)}</span>
                    <span className="text-base-content/60 border-t border-base-content/10 pt-0.5">⚡ Total:</span>
                    <span className="font-bold border-t border-base-content/10 pt-0.5 text-primary">
                        {fmtTok(total)}
                    </span>
                </div>
            </div>
        </div>
    );
};

/** Agent icon badge with hover/focus metadata tooltip. */
const AgentBadge: React.FC<{
    agentId: string;
    model: string;
    timestamp: string;
    tooltipId: string;
}> = ({ agentId, model, timestamp, tooltipId }) => {
    const [open, setOpen] = useState(false);
    return (
        <div className="relative inline-flex items-center z-20">
            <button
                type="button"
                aria-label={`Show ${agentId} metadata`}
                aria-describedby={tooltipId}
                data-testid={`timeline-agent-badge-${tooltipId}`}
                className="inline-flex items-center justify-center p-1 rounded hover:bg-base-content/10 text-base-content focus:outline-none focus-visible:ring-1 focus-visible:ring-primary transition-colors cursor-pointer"
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') setOpen(false);
                }}
            >
                <AgentIcon id={agentId} />
            </button>
            <div
                id={tooltipId}
                role="tooltip"
                data-testid={tooltipId}
                className={`absolute left-0 top-full z-50 mt-1.5 w-56 p-2 rounded-lg bg-base-300 border border-base-content/20 shadow-2xl text-[11px] font-mono leading-relaxed pointer-events-none ${
                    open ? 'block' : 'hidden'
                }`}
            >
                <div className="font-bold text-base-content mb-1 flex items-center gap-1.5">
                    <AgentIcon id={agentId} />
                    <span>{agentId}</span>
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-base-content/80">
                    <span className="text-base-content/60">Model:</span>
                    <span className="truncate">{model}</span>
                    <span className="text-base-content/60">Timestamp:</span>
                    <span className="truncate">{fmtUtcClock(timestamp)}</span>
                </div>
            </div>
        </div>
    );
};

/** Tool name tag with hover/focus token breakdown tooltip. */
const ToolTokenBadge: React.FC<{
    title: string;
    freshInputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    color: string;
    tooltipId: string;
}> = ({ title, freshInputTokens, cacheReadTokens, outputTokens, color, tooltipId }) => {
    const [open, setOpen] = useState(false);
    const total = tokenLoad(freshInputTokens, cacheReadTokens, outputTokens);
    return (
        <div className="relative inline-flex items-center z-20">
            <button
                type="button"
                aria-describedby={tooltipId}
                data-testid={`timeline-tool-badge-${tooltipId}`}
                className="px-1.5 py-0.5 rounded text-[10.5px] font-mono font-medium truncate max-w-[140px] sm:max-w-[200px] border focus:outline-none focus-visible:ring-1 focus-visible:ring-primary transition-colors cursor-pointer"
                style={{
                    color: color,
                    backgroundColor: `${color}18`,
                    borderColor: `${color}40`,
                }}
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') setOpen(false);
                }}
            >
                {title}
            </button>
            <div
                id={tooltipId}
                role="tooltip"
                data-testid={tooltipId}
                className={`absolute left-0 top-full z-50 mt-1.5 w-52 p-2 rounded-lg bg-base-300 border border-base-content/20 shadow-2xl text-[11px] font-mono leading-relaxed pointer-events-none ${
                    open ? 'block' : 'hidden'
                }`}
            >
                <div className="font-bold text-base-content mb-1">Token Breakdown</div>
                <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-base-content/80">
                    <span className="text-base-content/60">📥 Fresh input:</span>
                    <span>{fmtTok(freshInputTokens)}</span>
                    <span className="text-base-content/60">💾 Cache read:</span>
                    <span className="text-cyan-400">{fmtTok(cacheReadTokens)}</span>
                    <span className="text-base-content/60">📤 Output:</span>
                    <span>{fmtTok(outputTokens)}</span>
                    <span className="text-base-content/60 border-t border-base-content/10 pt-0.5">⚡ Total:</span>
                    <span className="font-bold border-t border-base-content/10 pt-0.5 text-primary">
                        {fmtTok(total)}
                    </span>
                </div>
            </div>
        </div>
    );
};

export const TimelineTab: React.FC<TimelineTabProps> = ({
    data,
    loading,
    error,
    sessionId: _sessionId,
    availableSessions = [],
    onSelectSession,
}) => {
    const activeSessionId = data?.session.id;
    const [expandedBySession, setExpandedBySession] = useState<Record<string, Record<string, boolean>>>({});
    const [hideAssistant, setHideAssistant] = useState(true);
    const [hideUnknown, setHideUnknown] = useState(true);
    const [hideOtherEmpty, setHideOtherEmpty] = useState(true);

    const expandedEvents = (activeSessionId && expandedBySession[activeSessionId]) || {};
    const setExpandedEvents = (update: (prev: Record<string, boolean>) => Record<string, boolean>) => {
        if (!activeSessionId) return;
        setExpandedBySession((prev) => ({
            ...prev,
            [activeSessionId]: update(prev[activeSessionId] || {}),
        }));
    };

    const toggleEvent = (turnIndex: number, seq: number) => {
        const key = eventKey(turnIndex, seq);
        setExpandedEvents((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-16">
                <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin motion-reduce:animate-none" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 rounded-lg bg-error/10 border border-error/20 text-error">
                <span>Failed to load timeline: {error}</span>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="p-4 rounded-lg bg-info/10 border border-info/20 text-info">
                <span>No timeline data available for the selected session.</span>
            </div>
        );
    }

    const { session, blocks } = data;
    const sessionTokenLoad = tokenLoad(
        session.tokens.freshInputTokens,
        session.tokens.cacheReadTokens,
        session.tokens.outputTokens,
    );
    const sessionCacheReadPct = cacheReadPercent(session.tokens.freshInputTokens, session.tokens.cacheReadTokens);

    const filteredBlocks = blocks
        .map((block) => {
            const filteredEvents = block.events.filter((ev) => {
                if (isAssistantEvent(ev)) return !hideAssistant;
                if (ev.kind === 'unknown' || ev.agent === 'unknown') return !hideUnknown;
                if (
                    hideOtherEmpty &&
                    !ev.payload?.trim() &&
                    ev.durationMs === 0 &&
                    tokenLoad(ev.freshInputTokens, ev.cacheReadTokens, ev.outputTokens) === 0
                )
                    return false;
                return true;
            });
            return { ...block, events: filteredEvents };
        })
        .filter((block) => block.events.length > 0);

    const expandableKeys = filteredBlocks.flatMap((block) =>
        block.events.filter((ev) => !!ev.payload?.trim()).map((ev) => eventKey(block.turnIndex, ev.seq)),
    );
    const allExpanded = expandableKeys.length > 0 && expandableKeys.every((key) => expandedEvents[key]);
    const toggleAll = () =>
        setExpandedEvents(() => (allExpanded ? {} : Object.fromEntries(expandableKeys.map((key) => [key, true]))));

    // Prev/Next walk the roster order only; disabled at bounds, no wrap.
    const rosterIndex = availableSessions.findIndex((s) => s.id === session.id);
    const prevSession = rosterIndex > 0 ? availableSessions[rosterIndex - 1] : undefined;
    const nextSession =
        rosterIndex >= 0 && rosterIndex < availableSessions.length - 1 ? availableSessions[rosterIndex + 1] : undefined;

    return (
        <div className="flex flex-col gap-6">
            {/* Conversation Panel */}
            <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5 flex flex-col gap-4">
                {/* Header Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-4">
                        <h3 className="text-base font-bold tracking-tight">Conversation</h3>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <label className="flex items-center gap-2">
                            <span className="sr-only">Session</span>
                            <select
                                aria-label="Select Session"
                                data-testid="timeline-session-select"
                                className="px-3 py-1.5 min-h-[44px] text-xs rounded-lg border border-base-content/20 bg-base-300 font-mono text-base-content max-w-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                value={session.id}
                                onChange={(e) => onSelectSession?.(e.target.value)}
                            >
                                {availableSessions.length > 0 ? (
                                    availableSessions.map((s) => (
                                        <option key={s.id} value={s.id}>
                                            {sessionOptionLabel(s)}
                                        </option>
                                    ))
                                ) : (
                                    <option value={session.id}>
                                        {sessionOptionLabel({
                                            id: session.id,
                                            source: session.source,
                                            start: session.start,
                                            tokenLoad: sessionTokenLoad,
                                        })}
                                    </option>
                                )}
                            </select>
                        </label>

                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                aria-label="Previous session"
                                disabled={!prevSession}
                                className="px-3 py-2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-xs font-mono rounded-lg border border-base-content/20 bg-base-300 text-base-content/80 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-base-content/10 transition-colors focus-visible:ring-2 focus-visible:ring-primary"
                                onClick={() => prevSession && onSelectSession?.(prevSession.id)}
                            >
                                ←
                            </button>
                            <button
                                type="button"
                                aria-label="Next session"
                                disabled={!nextSession}
                                className="px-3 py-2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-xs font-mono rounded-lg border border-base-content/20 bg-base-300 text-base-content/80 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-base-content/10 transition-colors focus-visible:ring-2 focus-visible:ring-primary"
                                onClick={() => nextSession && onSelectSession?.(nextSession.id)}
                            >
                                →
                            </button>
                        </div>

                        <button
                            type="button"
                            aria-pressed={allExpanded}
                            disabled={expandableKeys.length === 0}
                            className="px-3.5 py-2 min-h-[44px] rounded-lg text-xs font-semibold border border-primary/30 text-primary hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:ring-2 focus-visible:ring-primary"
                            onClick={toggleAll}
                        >
                            {allExpanded ? 'Collapse all' : 'Expand all'}
                        </button>

                        <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-base-content/80">
                            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    data-testid="timeline-filter-assistant"
                                    className="w-3.5 h-3.5 rounded border border-base-content/30 accent-primary focus-visible:ring-1 focus-visible:ring-primary"
                                    checked={hideAssistant}
                                    onChange={(e) => setHideAssistant(e.target.checked)}
                                />
                                <span>Hide assistant</span>
                            </label>
                            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    data-testid="timeline-filter-unknown"
                                    className="w-3.5 h-3.5 rounded border border-base-content/30 accent-primary focus-visible:ring-1 focus-visible:ring-primary"
                                    checked={hideUnknown}
                                    onChange={(e) => setHideUnknown(e.target.checked)}
                                />
                                <span>Hide unknown</span>
                            </label>
                            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    data-testid="timeline-filter-empty"
                                    className="w-3.5 h-3.5 rounded border border-base-content/30 accent-primary focus-visible:ring-1 focus-visible:ring-primary"
                                    checked={hideOtherEmpty}
                                    onChange={(e) => setHideOtherEmpty(e.target.checked)}
                                />
                                <span>Hide other empty</span>
                            </label>
                        </div>
                    </div>
                </div>

                {/* Ordered Nine-Field Metadata Strip */}
                <div
                    data-testid="timeline-metadata-strip"
                    className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-3 pt-3 border-t border-base-content/10 text-xs font-mono"
                >
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wider text-base-content/60">SESSION</span>
                        <span className="font-semibold truncate" title={session.id}>
                            {shortSessionId(session.id)}
                        </span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wider text-base-content/60">AGENT</span>
                        <span className="inline-flex items-center gap-1 font-semibold truncate">
                            <AgentIcon id={session.source} />
                            {session.source}
                        </span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wider text-base-content/60">MODEL</span>
                        <span className="inline-flex items-center gap-1.5 truncate">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary/70 shrink-0" />
                            {session.modelDetail || session.model}
                        </span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wider text-base-content/60">STARTED</span>
                        <span className="truncate">{fmtUtcDayTime(session.start)}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wider text-base-content/60">DURATION</span>
                        <span className="font-semibold truncate">{fmtDur(session.durationMs / 60000)}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wider text-base-content/60">TOTAL TOKENS</span>
                        <span className="font-bold text-primary truncate">{fmtTok(sessionTokenLoad)}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wider text-base-content/60">CACHE READ</span>
                        <span className="font-semibold text-cyan-400 truncate">{sessionCacheReadPct.toFixed(1)}%</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wider text-base-content/60">OUTPUT TOKENS</span>
                        <span className="truncate">{fmtTok(session.tokens.outputTokens)}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wider text-base-content/60">TOOL CALLS</span>
                        <span className="truncate">{fmtInt(session.toolCallCount)}</span>
                    </div>
                </div>
            </div>

            {/* Continuous Vertical Rail & Chronological Stream */}
            <div
                data-testid="timeline-rail"
                className="relative py-2 sm:py-4 before:absolute before:left-2 sm:before:left-[136px] before:top-0 before:bottom-0 before:w-px before:bg-gradient-to-b before:from-transparent before:via-base-content/20 before:to-transparent flex flex-col gap-3"
            >
                {filteredBlocks.map((block) => {
                    const userEvents = block.events.filter((e) => e.kind === 'user');
                    const nonUserEvents = block.events.filter((e) => e.kind !== 'user');

                    return (
                        <div key={block.turnIndex} className="flex flex-col gap-2.5">
                            {/* Prompt Rows (User Events - 80% Width Right-Aligned) */}
                            {userEvents.map((ev) => {
                                const fullText = promptText(ev);
                                const summary = promptSummary(fullText);
                                const hasPayload = !!ev.payload?.trim();
                                const isExpanded = !!expandedEvents[eventKey(block.turnIndex, ev.seq)];
                                const drawerId = `timeline-user-drawer-${block.turnIndex}-${ev.seq}`;

                                return (
                                    <div
                                        key={eventKey(block.turnIndex, ev.seq)}
                                        className="relative flex flex-col sm:grid sm:grid-cols-[136px_minmax(0,1fr)] py-1"
                                        data-testid={`timeline-user-event-${block.turnIndex}-${ev.seq}`}
                                    >
                                        {/* Left Column (Desktop UTC Clock & Input Tokens) */}
                                        <div className="hidden sm:flex flex-col items-end justify-center pr-4 font-mono text-[10.5px] text-base-content/70">
                                            <span className="font-semibold text-base-content/90">
                                                {fmtUtcClock(block.timestamp)}
                                            </span>
                                            <span className="text-[10px] text-base-content/50">
                                                📥 {fmtTok(ev.freshInputTokens)} in
                                            </span>
                                        </div>

                                        {/* Continuous Rail Node */}
                                        <span
                                            data-timeline-node="prompt"
                                            className="absolute left-[3.5px] sm:left-[131.5px] top-1/2 -translate-y-1/2 w-[9px] h-[9px] rounded-full bg-cyan-400 ring-4 ring-base-100 z-10"
                                            aria-hidden="true"
                                        />

                                        {/* Right Column Body (Unified Card, 80% Width Right-Aligned) */}
                                        <div className="pl-6 sm:pl-5 min-w-0 flex justify-end">
                                            <div className="w-[80%] max-w-none bg-base-100 rounded-lg border border-primary/20 hover:border-primary/40 transition-colors p-2 sm:px-3 sm:py-2 flex flex-col gap-1">
                                                <div className="flex items-center justify-between gap-2 min-h-[32px]">
                                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                                        <UserTokenBadge
                                                            freshInputTokens={ev.freshInputTokens}
                                                            cacheReadTokens={ev.cacheReadTokens}
                                                            outputTokens={ev.outputTokens}
                                                            tooltipId={`user-tt-${block.turnIndex}-${ev.seq}`}
                                                        />
                                                        <span className="font-mono text-xs font-semibold text-base-content/90 truncate min-w-0">
                                                            {summary}
                                                        </span>
                                                    </div>

                                                    <div className="flex items-center gap-2 shrink-0 font-mono text-[11px] text-base-content/60">
                                                        <span className="hidden sm:inline px-1.5 py-0.5 rounded bg-base-300 border border-base-content/10">
                                                            {fullText.length} chars
                                                        </span>
                                                        {hasPayload ? (
                                                            <button
                                                                type="button"
                                                                aria-label={
                                                                    isExpanded
                                                                        ? 'Collapse full user prompt'
                                                                        : 'Expand full user prompt'
                                                                }
                                                                aria-expanded={isExpanded}
                                                                aria-controls={drawerId}
                                                                onClick={() => toggleEvent(block.turnIndex, ev.seq)}
                                                                className="p-1 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center text-base-content/60 hover:text-base-content transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                                                            >
                                                                <span
                                                                    className={`text-xs font-mono transition-transform duration-150 ${
                                                                        isExpanded ? 'rotate-90' : ''
                                                                    }`}
                                                                    aria-hidden="true"
                                                                >
                                                                    ›
                                                                </span>
                                                            </button>
                                                        ) : null}
                                                    </div>
                                                </div>

                                                {isExpanded && hasPayload && (
                                                    <div
                                                        id={drawerId}
                                                        className="mt-1 p-3 bg-[#0d141f] text-slate-100 rounded-md font-mono text-xs whitespace-pre-wrap overflow-x-auto border border-white/10"
                                                    >
                                                        {fullText}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            {/* Operation Cards (Single-Line Compact Antigravity-CLI Style - 80% Width Left-Aligned) */}
                            {nonUserEvents.map((ev) => {
                                const presentation = toolPresentation(ev);
                                const isExpanded = !!expandedEvents[eventKey(block.turnIndex, ev.seq)];
                                const hasPayload = !!ev.payload?.trim();
                                const drawerId = `timeline-op-drawer-${block.turnIndex}-${ev.seq}`;
                                const isHotDur = ev.durationMs >= 5_000;

                                return (
                                    <div
                                        key={eventKey(block.turnIndex, ev.seq)}
                                        className="relative flex flex-col sm:grid sm:grid-cols-[136px_minmax(0,1fr)] py-1 hover:z-30 focus-within:z-30"
                                        data-testid={`timeline-op-event-${block.turnIndex}-${ev.seq}`}
                                    >
                                        {/* Left Gutter: Timestamp & Step Duration */}
                                        <div className="hidden sm:flex flex-col items-end justify-center pr-4 font-mono text-[10.5px] text-base-content/70">
                                            <span className="font-semibold text-base-content/90">
                                                {fmtUtcClock(block.timestamp)}
                                            </span>
                                            <span
                                                data-testid={`timeline-step-duration-${block.turnIndex}-${ev.seq}`}
                                                className={
                                                    isHotDur ? 'font-bold text-amber-400' : 'text-base-content/60'
                                                }
                                            >
                                                ⏱ {fmtMs(ev.durationMs)}
                                            </span>
                                        </div>

                                        {/* Continuous Rail Node */}
                                        <span
                                            data-timeline-node="operation"
                                            className="absolute left-[3.5px] sm:left-[131.5px] top-1/2 -translate-y-1/2 w-[9px] h-[9px] rounded-full ring-4 ring-base-100 z-10"
                                            style={{ backgroundColor: presentation.color }}
                                            aria-hidden="true"
                                        />

                                        {/* Right Column (Single-Line Card, 80% Width Left-Aligned) */}
                                        <div className="pl-6 sm:pl-5 min-w-0 flex justify-start">
                                            <div
                                                className="w-[80%] max-w-none bg-base-100 rounded-lg border border-base-content/10 border-l-[3px] transition-colors relative"
                                                style={{ borderLeftColor: presentation.color }}
                                            >
                                                <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 min-h-[38px]">
                                                    {/* Left side: Agent Icon, Tool Tag, Title */}
                                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                                        <AgentBadge
                                                            agentId={ev.agent || block.source}
                                                            model={ev.model || block.model}
                                                            timestamp={block.timestamp}
                                                            tooltipId={`agent-tt-${block.turnIndex}-${ev.seq}`}
                                                        />

                                                        <ToolTokenBadge
                                                            title={presentation.label}
                                                            freshInputTokens={ev.freshInputTokens}
                                                            cacheReadTokens={ev.cacheReadTokens}
                                                            outputTokens={ev.outputTokens}
                                                            color={presentation.color}
                                                            tooltipId={`tool-tt-${block.turnIndex}-${ev.seq}`}
                                                        />

                                                        <span className="font-mono text-xs font-semibold text-base-content/90 truncate min-w-0">
                                                            {ev.title}
                                                        </span>
                                                    </div>

                                                    {/* Right side: Exit Code & Chevron */}
                                                    <div className="flex items-center gap-2 shrink-0 font-mono">
                                                        {ev.exitCode !== null && (
                                                            <span
                                                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                                    ev.exitCode === 0
                                                                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                                                        : 'bg-error/20 text-error border border-error/30'
                                                                }`}
                                                            >
                                                                EXIT_CODE={ev.exitCode}
                                                            </span>
                                                        )}

                                                        {hasPayload ? (
                                                            <button
                                                                type="button"
                                                                aria-label={
                                                                    isExpanded
                                                                        ? 'Collapse operation payload'
                                                                        : 'Expand operation payload'
                                                                }
                                                                aria-expanded={isExpanded}
                                                                aria-controls={drawerId}
                                                                onClick={() => toggleEvent(block.turnIndex, ev.seq)}
                                                                className="p-1 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center text-base-content/60 hover:text-base-content transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                                                            >
                                                                <span
                                                                    className={`text-xs font-mono transition-transform duration-150 ${
                                                                        isExpanded ? 'rotate-90' : ''
                                                                    }`}
                                                                    aria-hidden="true"
                                                                >
                                                                    ›
                                                                </span>
                                                            </button>
                                                        ) : null}
                                                    </div>
                                                </div>

                                                {/* Verbatim Monospace Payload Drawer */}
                                                {isExpanded && ev.payload && (
                                                    <div
                                                        id={drawerId}
                                                        className="p-3 bg-[#0d141f] text-slate-100 font-mono text-xs whitespace-pre-wrap overflow-x-auto rounded-b-lg border-t border-base-content/10"
                                                    >
                                                        {ev.payload}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default TimelineTab;
