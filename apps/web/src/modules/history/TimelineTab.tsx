import type { HistoryTimelineEvent, HistoryTimelineResponse } from '@gobing-ai/spur-contracts';
import type React from 'react';
import { useState } from 'react';
import { AgentIcon } from './AgentIcon';
import { fmtDur, fmtMs, fmtTok, SparkBar } from './charts';

export interface TimelineTabProps {
    data?: HistoryTimelineResponse['data'];
    loading?: boolean;
    error?: string | null;
    sessionId?: string;
    availableSessions?: Array<{ id: string; source: string; model: string; start: string }>;
    onSelectSession?: (id: string) => void;
}

const eventKey = (turnIndex: number, seq: number): string => `${turnIndex}:${seq}`;

/** Hover/focus tooltip replacing the old native title attr (keyboard-accessible). */
const StepMetrics: React.FC<{
    turnIndex: number;
    ev: HistoryTimelineEvent;
    maxDuration: number;
    maxTokens: number;
}> = ({ turnIndex, ev, maxDuration, maxTokens }) => {
    const [open, setOpen] = useState(false);
    const tooltipId = `timeline-step-tooltip-${turnIndex}-${ev.seq}`;
    return (
        <div className="relative sm:w-48 shrink-0 flex flex-col justify-center gap-1.5 font-mono text-[11px]">
            <button
                type="button"
                aria-describedby={tooltipId}
                data-testid={`timeline-step-metrics-${turnIndex}-${ev.seq}`}
                className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md p-1 -m-1"
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') setOpen(false);
                }}
            >
                <div
                    className={`flex justify-between items-center ${
                        ev.durationMs >= 5_000 ? 'font-bold text-amber-400' : 'text-base-content/70'
                    }`}
                >
                    <span>Duration:</span>
                    <span className="font-bold">{fmtMs(ev.durationMs)}</span>
                </div>
                <SparkBar value={ev.durationMs} max={maxDuration} color="#fbbf24" height={4} />

                <div
                    className={`flex justify-between items-center mt-1 ${
                        ev.tokens >= 50_000 ? 'font-bold text-cyan-300' : 'text-base-content/70'
                    }`}
                >
                    <span>Tokens:</span>
                    <span className="font-bold">{fmtTok(ev.tokens)}</span>
                </div>
                <SparkBar value={ev.tokens} max={maxTokens} color="#22d3ee" height={4} />

                <div className="text-[10px] text-base-content/50 mt-0.5">
                    Fresh: {fmtTok(ev.freshInputTokens)} · Cache: {fmtTok(ev.cacheReadTokens)}
                </div>
            </button>

            <div
                id={tooltipId}
                role="tooltip"
                data-testid={tooltipId}
                className={`absolute left-0 top-full z-20 mt-1 w-64 p-2.5 rounded-lg bg-base-300 border border-base-content/20 shadow-lg text-[11px] leading-relaxed ${
                    open ? '' : 'sr-only'
                }`}
            >
                <div className="font-bold text-base-content mb-1">Step #{ev.seq}</div>
                <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
                    <span className="text-base-content/60">Action:</span>
                    <span className="truncate font-semibold">{ev.title}</span>
                    <span className="text-base-content/60">Agent/Model:</span>
                    <span>
                        {ev.agent} · {ev.model}
                    </span>
                    <span className="text-base-content/60">Duration:</span>
                    <span>{fmtMs(ev.durationMs)}</span>
                    <span className="text-base-content/60">Total:</span>
                    <span>{fmtTok(ev.tokens)}</span>
                    <span className="text-base-content/60">Fresh Input:</span>
                    <span>{fmtTok(ev.freshInputTokens)}</span>
                    <span className="text-base-content/60">Cache Read:</span>
                    <span>{fmtTok(ev.cacheReadTokens)}</span>
                    <span className="text-base-content/60">Output:</span>
                    <span>{fmtTok(ev.outputTokens)}</span>
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
                <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
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
    const maxEventDuration = Math.max(1, ...blocks.flatMap((b) => b.events.map((e) => e.durationMs)));
    const maxEventTokens = Math.max(1, ...blocks.flatMap((b) => b.events.map((e) => e.tokens)));
    const allEventKeys = blocks.flatMap((block) => block.events.map((event) => eventKey(block.turnIndex, event.seq)));
    const allExpanded = allEventKeys.length > 0 && allEventKeys.every((key) => expandedEvents[key]);
    const toggleAll = () =>
        setExpandedEvents(() => (allExpanded ? {} : Object.fromEntries(allEventKeys.map((key) => [key, true]))));

    // Prev/Next walk the roster order only; disabled at bounds, no wrap.
    const rosterIndex = availableSessions.findIndex((s) => s.id === session.id);
    const prevSession = rosterIndex > 0 ? availableSessions[rosterIndex - 1] : undefined;
    const nextSession =
        rosterIndex >= 0 && rosterIndex < availableSessions.length - 1 ? availableSessions[rosterIndex + 1] : undefined;

    return (
        <div className="flex flex-col gap-6">
            {/* Session Selector & Metadata Header */}
            <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5 flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                            Select Session:
                        </span>
                        <select
                            aria-label="Select Session"
                            className="px-3 py-1.5 text-xs rounded-lg border border-base-content/20 bg-base-300 font-mono text-base-content max-w-xs focus:outline-none"
                            value={session.id}
                            onChange={(e) => onSelectSession?.(e.target.value)}
                        >
                            {availableSessions.length > 0 ? (
                                availableSessions.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.id} ({s.source} · {s.model})
                                    </option>
                                ))
                            ) : (
                                <option value={session.id}>{session.id}</option>
                            )}
                        </select>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                aria-label="Previous session"
                                disabled={!prevSession}
                                className="px-2 py-1 text-xs rounded-lg border border-base-content/20 bg-base-300 text-base-content/80 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-base-content/10 transition-colors"
                                onClick={() => prevSession && onSelectSession?.(prevSession.id)}
                            >
                                ← Previous
                            </button>
                            <button
                                type="button"
                                aria-label="Next session"
                                disabled={!nextSession}
                                className="px-2 py-1 text-xs rounded-lg border border-base-content/20 bg-base-300 text-base-content/80 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-base-content/10 transition-colors"
                                onClick={() => nextSession && onSelectSession?.(nextSession.id)}
                            >
                                Next →
                            </button>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold uppercase bg-primary text-primary-content">
                            {session.source}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-mono border border-base-content/20 text-base-content/80">
                            {session.model}
                        </span>
                        <button
                            type="button"
                            disabled={allEventKeys.length === 0}
                            className="px-2 py-0.5 rounded text-xs text-primary border border-primary/20 hover:bg-primary/10 disabled:opacity-40"
                            onClick={toggleAll}
                        >
                            {allExpanded ? 'Collapse all' : 'Expand all'}
                        </button>
                    </div>
                </div>

                {/* Quick Session Stats Bar */}
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 pt-3 border-t border-base-content/10 font-mono text-xs">
                    <div>
                        <span className="text-base-content/60 block text-[11px]">Start Time</span>
                        <span className="font-semibold">{session.start.slice(0, 19).replace('T', ' ')}</span>
                    </div>
                    <div>
                        <span className="text-base-content/60 block text-[11px]">Duration</span>
                        <span className="font-semibold">{fmtDur(session.durationMs / 60000)}</span>
                    </div>
                    <div>
                        <span className="text-base-content/60 block text-[11px]">Messages</span>
                        <span className="font-semibold">{session.messageCount}</span>
                    </div>
                    <div>
                        <span className="text-base-content/60 block text-[11px]">Tool Calls</span>
                        <span className="font-semibold">{session.toolCallCount}</span>
                    </div>
                    <div>
                        <span className="text-base-content/60 block text-[11px]">Billed Tokens</span>
                        <span className="font-semibold text-primary">{fmtTok(session.tokens.billedTokens)}</span>
                    </div>
                    <div>
                        <span className="text-base-content/60 block text-[11px]">Cache Saved</span>
                        <span className="font-semibold text-emerald-400">
                            {fmtTok(session.tokens.cacheSavedTokens)}
                        </span>
                    </div>
                </div>
            </div>

            {/* Chronological Event Stream with Turn Groups */}
            <div className="flex flex-col gap-6">
                {blocks.map((block) => {
                    return (
                        <div
                            key={block.turnIndex}
                            className="bg-base-200/70 rounded-xl border border-base-content/10 overflow-hidden shadow-xs"
                        >
                            {/* Turn Header */}
                            <div className="bg-base-300/80 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs border-b border-base-content/10">
                                <div className="flex items-center gap-2 font-semibold">
                                    <span className="px-2 py-0.5 rounded-full text-xs bg-base-300 border border-base-content/20 text-base-content">
                                        Turn #{block.turnIndex + 1}
                                    </span>
                                    <span className="font-mono text-base-content/70">
                                        {block.timestamp.slice(11, 19)}
                                    </span>
                                    <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-primary-content">
                                        <AgentIcon id={block.source} />
                                        {block.source}
                                    </span>
                                    <span className="rounded-full border border-base-content/20 px-2 py-0.5 font-mono">
                                        {block.model}
                                    </span>
                                </div>
                                <div className="flex items-center gap-3 font-mono text-[11px] text-base-content/70">
                                    <span>{block.operationCount} operations</span>
                                    <span>{fmtMs(block.totalDurationMs)}</span>
                                    <span className="text-primary font-bold">{fmtTok(block.totalTokens)} tok</span>
                                </div>
                            </div>

                            {/* Events inside this Turn */}
                            <div className="p-4 flex flex-col gap-3">
                                {block.events.map((ev) => {
                                    const isExpanded = !!expandedEvents[eventKey(block.turnIndex, ev.seq)];

                                    // User prompts render as right-aligned chat bubbles.
                                    if (ev.kind === 'user') {
                                        return (
                                            <div
                                                key={eventKey(block.turnIndex, ev.seq)}
                                                className="flex flex-col gap-2 p-3 bg-base-100 rounded-lg border border-primary/20 hover:border-primary/40 transition-colors"
                                                data-testid={`timeline-user-event-${block.turnIndex}-${ev.seq}`}
                                            >
                                                <div className="flex items-center justify-end gap-2">
                                                    <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-mono font-bold bg-primary/15 text-primary border border-primary/30">
                                                        prompt
                                                    </span>
                                                    <span className="px-1.5 py-0.5 rounded text-[10px] border border-base-content/20 font-mono">
                                                        #{ev.seq}
                                                    </span>
                                                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-base-300 font-mono">
                                                        Input {fmtTok(ev.freshInputTokens)}
                                                    </span>
                                                </div>
                                                <div className="flex justify-end">
                                                    <div className="max-w-[85%] bg-primary/10 border border-primary/25 rounded-2xl rounded-br-sm px-4 py-2 font-mono text-xs whitespace-pre-wrap text-base-content/90">
                                                        {ev.title}
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap items-center justify-end gap-3 font-mono text-[11px] text-base-content/70">
                                                    <span>{fmtMs(ev.durationMs)}</span>
                                                    <span>{fmtTok(ev.tokens)} tok</span>
                                                    <span>Fresh: {fmtTok(ev.freshInputTokens)}</span>
                                                    {ev.payload && (
                                                        <button
                                                            type="button"
                                                            className="text-primary hover:underline"
                                                            onClick={() => toggleEvent(block.turnIndex, ev.seq)}
                                                        >
                                                            {isExpanded ? 'Hide full prompt' : 'Show full prompt'}
                                                        </button>
                                                    )}
                                                </div>
                                                {isExpanded && ev.payload && (
                                                    <div className="p-2.5 bg-base-300 rounded-md font-mono text-xs whitespace-pre-wrap overflow-x-auto border border-base-content/10">
                                                        {ev.payload}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    }

                                    return (
                                        <div
                                            key={eventKey(block.turnIndex, ev.seq)}
                                            className="flex flex-col sm:flex-row gap-4 p-3 bg-base-100 rounded-lg border border-base-content/5 hover:border-base-content/20 transition-colors"
                                        >
                                            {/* Left Column: Visual Metrics */}
                                            <StepMetrics
                                                turnIndex={block.turnIndex}
                                                ev={ev}
                                                maxDuration={maxEventDuration}
                                                maxTokens={maxEventTokens}
                                            />

                                            {/* Right Column: Event Content Card */}
                                            <div className="flex-1 flex flex-col gap-2">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="px-1.5 py-0.5 rounded text-[10px] border border-base-content/20 font-mono">
                                                            #{ev.seq}
                                                        </span>
                                                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-base-300 uppercase font-mono text-base-content">
                                                            {ev.kind}
                                                        </span>
                                                        {ev.exitCode !== null && (
                                                            <span
                                                                className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                                                                    ev.exitCode === 0
                                                                        ? 'bg-emerald-500/20 text-emerald-400'
                                                                        : 'bg-error/20 text-error font-bold'
                                                                }`}
                                                            >
                                                                exit: {ev.exitCode}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        className="px-2 py-0.5 text-xs text-primary hover:bg-primary/10 rounded transition-colors"
                                                        onClick={() => toggleEvent(block.turnIndex, ev.seq)}
                                                    >
                                                        {isExpanded ? 'Collapse' : 'Details'}
                                                    </button>
                                                </div>

                                                <div className="font-mono text-xs font-semibold text-base-content/90">
                                                    {ev.title}
                                                </div>

                                                {/* Expandable Payload & Execution Details */}
                                                {isExpanded && ev.payload && (
                                                    <div className="mt-2 p-2.5 bg-base-300 rounded-md font-mono text-xs whitespace-pre-wrap overflow-x-auto border border-base-content/10">
                                                        {ev.payload}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
export default TimelineTab;
