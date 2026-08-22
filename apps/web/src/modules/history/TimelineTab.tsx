import type { HistoryTimelineResponse } from '@gobing-ai/spur-contracts';
import type React from 'react';
import { useState } from 'react';
import { fmtDur, fmtMs, fmtTok, SparkBar } from './charts';

export interface TimelineTabProps {
    data?: HistoryTimelineResponse['data'];
    loading?: boolean;
    error?: string | null;
    sessionId?: string;
    availableSessions?: Array<{ id: string; source: string; model: string; start: string }>;
    onSelectSession?: (id: string) => void;
}

export const TimelineTab: React.FC<TimelineTabProps> = ({
    data,
    loading,
    error,
    sessionId: _sessionId,
    availableSessions = [],
    onSelectSession,
}) => {
    const [expandedEvents, setExpandedEvents] = useState<Record<number, boolean>>({});

    const toggleEvent = (seq: number) => {
        setExpandedEvents((prev) => ({ ...prev, [seq]: !prev[seq] }));
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
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold uppercase bg-primary text-primary-content">
                            {session.source}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-mono border border-base-content/20 text-base-content/80">
                            {session.model}
                        </span>
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
                {blocks.map((block) => (
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
                                <span className="font-mono text-base-content/70">{block.timestamp.slice(11, 19)}</span>
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
                                const isExpanded = !!expandedEvents[ev.seq];
                                return (
                                    <div
                                        key={ev.seq}
                                        className="flex flex-col sm:flex-row gap-4 p-3 bg-base-100 rounded-lg border border-base-content/5 hover:border-base-content/20 transition-colors"
                                    >
                                        {/* Left Column: Visual Metrics */}
                                        <div className="sm:w-48 shrink-0 flex flex-col justify-center gap-1.5 font-mono text-[11px]">
                                            <div className="flex justify-between items-center text-amber-400">
                                                <span>Duration:</span>
                                                <span className="font-bold">{fmtMs(ev.durationMs)}</span>
                                            </div>
                                            <SparkBar
                                                value={ev.durationMs}
                                                max={maxEventDuration}
                                                color="#fbbf24"
                                                height={4}
                                            />

                                            <div className="flex justify-between items-center text-cyan-400 mt-1">
                                                <span>Tokens:</span>
                                                <span className="font-bold">{fmtTok(ev.tokens)}</span>
                                            </div>
                                            <SparkBar
                                                value={ev.tokens}
                                                max={maxEventTokens}
                                                color="#22d3ee"
                                                height={4}
                                            />

                                            <div className="text-[10px] text-base-content/50 mt-0.5">
                                                Fresh: {fmtTok(ev.freshInputTokens)} · Cache:{' '}
                                                {fmtTok(ev.cacheReadTokens)}
                                            </div>
                                        </div>

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
                                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-base-content/60">
                                                        {ev.agent}
                                                    </span>
                                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-base-content/60">
                                                        {ev.model}
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
                                                    onClick={() => toggleEvent(ev.seq)}
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
                ))}
            </div>
        </div>
    );
};
export default TimelineTab;
