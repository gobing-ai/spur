import type { HistoryTimelineEvent, HistoryTimelineResponse, HistoryTokens } from '@gobing-ai/spur-contracts';
import type React from 'react';
import { useState } from 'react';
import { AgentIcon } from './AgentIcon';
import { fmtDur, fmtInt, fmtMs, fmtTok } from './charts';
import TimelineScrubber from './TimelineScrubber';
import { ToolCallTag } from './ToolCallDetail';

export interface TimelineTabProps {
    data?: HistoryTimelineResponse['data'];
    loading?: boolean;
    error?: string | null;
    mode?: 'session' | 'consolidated';
    sessionId?: string;
    sessionSource?: string;
    availableSessions?: Array<{ id: string; source: string; model: string; start: string; tokenLoad: number }>;
    onSelectSession?: (source: string, id: string) => void;
    onModeChange?: (mode: 'session' | 'consolidated') => void;
    consolidatedTaskWbs?: string;
    consolidatedRunId?: string;
    onConsolidatedScopeSubmit?: (scope: { taskWbs: string; runId: string }) => void;
}

const eventKey = (blockKey: string, seq: number): string => `${blockKey}:${seq}`;

const sessionKey = (source: string, id: string): string => JSON.stringify([source, id]);

const sanitizeHtmlId = (id: string): string => id.replace(/[^a-zA-Z0-9_-]/g, '-');

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

const fmtUtcDayTime = (ts: string | null): string => {
    if (!ts) return '—';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    const m = MONTH_NAMES[d.getUTCMonth()];
    const day = d.getUTCDate();
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${m} ${day} ${hh}:${mm}`;
};

const fmtUtcClock = (ts: string | null): string => {
    if (!ts) return '—';
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
    event.kind === 'assistant' || (event.eventType === 'message' && event.kind !== 'user');

interface ToolPresentation {
    label: string;
    color: string;
}

const toolPresentation = (event: HistoryTimelineEvent): ToolPresentation => {
    const raw = (event.toolName || event.kind || '').toLowerCase();
    if (raw.includes('glob')) {
        return { label: event.toolName || 'glob', color: '#6366f1' };
    }
    if (raw.includes('grep')) {
        return { label: event.toolName || 'grep', color: '#a855f7' };
    }
    if (raw.includes('edit') || raw.includes('write') || raw.includes('patch')) {
        return { label: event.toolName || 'edit', color: '#eab308' };
    }
    if (raw.includes('read') || raw.includes('view') || raw.includes('list')) {
        return { label: event.toolName || 'read', color: '#10b981' };
    }
    if (raw.includes('bash') || raw.includes('exec') || raw.includes('command') || raw.includes('terminal')) {
        return { label: event.toolName || 'bash', color: '#3b82f6' };
    }
    if (raw.includes('search') || raw.includes('find')) {
        return { label: event.toolName || 'search', color: '#a855f7' };
    }
    if (raw.includes('run')) {
        return { label: event.toolName || 'run', color: '#f59e0b' };
    }
    return {
        label: event.toolName || event.kind,
        color: '#64748b',
    };
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
    promptTokens: HistoryTokens | null;
    fullText: string;
    tooltipId: string;
}> = ({ promptTokens, fullText, tooltipId }) => {
    const [open, setOpen] = useState(false);
    const fresh = promptTokens?.freshInputTokens ?? 0;
    const cache = promptTokens?.cacheReadTokens ?? 0;
    const output = promptTokens?.outputTokens ?? 0;
    const total = tokenLoad(fresh, cache, output);
    const lineCount = fullText.length > 0 ? fullText.split(/\r?\n/).length : 0;
    const charCount = fullText.length;

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
                className={`absolute left-0 top-full z-50 mt-1.5 w-56 p-2 rounded-lg bg-base-300 border border-base-content/20 shadow-2xl text-[11px] font-mono leading-relaxed pointer-events-none ${
                    open ? 'block' : 'hidden'
                }`}
            >
                <div className="font-bold text-base-content mb-1">User Prompt Telemetry</div>
                <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-base-content/80">
                    <span className="text-base-content/60">Lines / chars:</span>
                    <span>
                        {lineCount} lines ({charCount} chars)
                    </span>
                    <span className="text-base-content/60">📥 Fresh input:</span>
                    <span>{fmtTok(fresh)}</span>
                    <span className="text-base-content/60">💾 Cache read:</span>
                    <span className="text-cyan-400">{fmtTok(cache)}</span>
                    <span className="text-base-content/60">📤 Output:</span>
                    <span>{fmtTok(output)}</span>
                    <span className="text-base-content/60 border-t border-base-content/10 pt-0.5">⚡ Turn load:</span>
                    <span className="font-bold border-t border-base-content/10 pt-0.5 text-primary">
                        {fmtTok(total)}
                    </span>
                </div>
            </div>
        </div>
    );
};

/**
 * Merged coding agent icon with unified metadata + token breakdown tooltip.
 */
const AgentBadge: React.FC<{
    agentId: string;
    model: string;
    timestamp: string | null;
    tooltipId: string;
    freshInputTokens?: number;
    cacheReadTokens?: number;
    outputTokens?: number;
    sessionId?: string;
}> = ({
    agentId,
    model,
    timestamp,
    tooltipId,
    freshInputTokens = 0,
    cacheReadTokens = 0,
    outputTokens = 0,
    sessionId,
}) => {
    const [open, setOpen] = useState(false);
    const total = tokenLoad(freshInputTokens, cacheReadTokens, outputTokens);
    return (
        <div className="relative inline-flex items-center z-20">
            <button
                type="button"
                aria-label={`Show ${agentId} metadata and token breakdown`}
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
                className={`absolute left-0 top-full z-50 mt-1.5 w-60 p-2.5 rounded-xl bg-base-300 border border-base-content/20 shadow-2xl text-[11px] font-mono leading-relaxed pointer-events-none ${
                    open ? 'block' : 'hidden'
                }`}
            >
                <div className="font-bold text-base-content mb-1.5 flex items-center gap-1.5 border-b border-base-content/10 pb-1">
                    <AgentIcon id={agentId} />
                    <span className="uppercase">{agentId}</span>
                    <span className="text-base-content/50 font-normal truncate">({model})</span>
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-base-content/80 text-[10.5px]">
                    <span className="text-base-content/60">Timestamp:</span>
                    <span className="truncate">{fmtUtcClock(timestamp)}</span>
                    {sessionId && (
                        <>
                            <span className="text-base-content/60">Session:</span>
                            <span className="truncate font-bold text-primary">{sessionId}</span>
                        </>
                    )}
                </div>
                <div className="mt-1.5 pt-1.5 border-t border-base-content/10">
                    <div className="font-bold text-base-content/70 text-[10px] uppercase tracking-wider mb-0.5">
                        Token Breakdown
                    </div>
                    <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-base-content/80 text-[10.5px]">
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
        </div>
    );
};

export const TimelineTab: React.FC<TimelineTabProps> = ({
    data,
    loading,
    error,
    mode = 'session',
    sessionId: _sessionId,
    availableSessions = [],
    onSelectSession,
    onModeChange,
    consolidatedTaskWbs = '',
    consolidatedRunId = '',
    onConsolidatedScopeSubmit,
}) => {
    const activeSessionId = data?.scope.sessionId;
    const activeSessionSource = data?.scope.source;
    const [expandedBySession, setExpandedBySession] = useState<Record<string, Record<string, boolean>>>({});
    const [hideAssistant, setHideAssistant] = useState(true);
    const [hideUnknown, setHideUnknown] = useState(true);
    const [hideOtherEmpty, setHideOtherEmpty] = useState(true);
    const [taskWbsDraft, setTaskWbsDraft] = useState(consolidatedTaskWbs);
    const [runIdDraft, setRunIdDraft] = useState(consolidatedRunId);

    const activeScopeKey =
        activeSessionId && activeSessionSource ? sessionKey(activeSessionSource, activeSessionId) : 'consolidated';
    const expandedEvents = expandedBySession[activeScopeKey] || {};
    const setExpandedEvents = (update: (prev: Record<string, boolean>) => Record<string, boolean>) => {
        setExpandedBySession((prev) => ({
            ...prev,
            [activeScopeKey]: update(prev[activeScopeKey] || {}),
        }));
    };

    const toggleEvent = (blockKey: string, seq: number) => {
        const key = eventKey(blockKey, seq);
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
                <span>No timeline data available.</span>
            </div>
        );
    }

    const { scope, blocks, truncated } = data;
    const sessionTokenLoad = tokenLoad(
        scope.tokens.freshInputTokens,
        scope.tokens.cacheReadTokens,
        scope.tokens.outputTokens,
    );
    const sessionCacheReadPct = cacheReadPercent(scope.tokens.freshInputTokens, scope.tokens.cacheReadTokens);

    const filteredBlocks = blocks
        .map((block) => {
            const filteredEvents = block.events.filter((ev) => {
                if (isAssistantEvent(ev)) return !hideAssistant;
                if (ev.kind === 'unknown' || ev.agent === 'unknown') return !hideUnknown;
                if (
                    hideOtherEmpty &&
                    !ev.payload?.trim() &&
                    (ev.durationMs === null || ev.durationMs === 0) &&
                    tokenLoad(ev.freshInputTokens, ev.cacheReadTokens, ev.outputTokens) === 0
                )
                    return false;
                return true;
            });
            return { ...block, events: filteredEvents };
        })
        .filter((block) => block.events.length > 0);

    const expandableKeys = filteredBlocks.flatMap((block) =>
        block.events.filter((ev) => !!ev.payload?.trim()).map((ev) => eventKey(block.key, ev.seq)),
    );
    const allExpanded = expandableKeys.length > 0 && expandableKeys.every((key) => expandedEvents[key]);
    const toggleAll = () =>
        setExpandedEvents(() => (allExpanded ? {} : Object.fromEntries(expandableKeys.map((key) => [key, true]))));

    // Prev/Next walk the roster order only; disabled at bounds, no wrap.
    const rosterIndex = availableSessions.findIndex((s) => s.id === scope.sessionId && s.source === scope.source);
    const prevSession = rosterIndex > 0 ? availableSessions[rosterIndex - 1] : undefined;
    const nextSession =
        rosterIndex >= 0 && rosterIndex < availableSessions.length - 1 ? availableSessions[rosterIndex + 1] : undefined;

    const jumpToTime = (timestamp: string) => {
        const selectedMs = Date.parse(timestamp);
        const target =
            filteredBlocks.find((block) => {
                const blockMs = block.timestamp ? Date.parse(block.timestamp) : Number.NaN;
                return Number.isFinite(blockMs) && blockMs >= selectedMs;
            }) ?? filteredBlocks.at(-1);
        if (!target) return;
        document
            .getElementById(`timeline-block-${sanitizeHtmlId(target.key)}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    return (
        <div className="flex flex-col gap-6">
            {/* Conversation Panel */}
            <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5 flex flex-col gap-4">
                {/* Header Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-base font-bold tracking-tight">Conversation</h3>
                        {/* Mode Switch: Single Session vs Consolidated */}
                        <fieldset className="inline-flex border border-base-content/20 rounded-lg p-0.5 bg-base-300 font-mono text-xs">
                            <legend className="sr-only">Timeline mode</legend>
                            <button
                                type="button"
                                data-testid="timeline-mode-session"
                                aria-pressed={mode === 'session'}
                                className={`px-2.5 py-1 rounded-md transition-colors ${
                                    mode === 'session'
                                        ? 'bg-primary text-primary-content font-bold'
                                        : 'text-base-content/70 hover:text-base-content'
                                }`}
                                onClick={() => onModeChange?.('session')}
                            >
                                Single Session
                            </button>
                            <button
                                type="button"
                                data-testid="timeline-mode-consolidated"
                                aria-pressed={mode === 'consolidated'}
                                className={`px-2.5 py-1 rounded-md transition-colors ${
                                    mode === 'consolidated'
                                        ? 'bg-primary text-primary-content font-bold'
                                        : 'text-base-content/70 hover:text-base-content'
                                }`}
                                onClick={() => onModeChange?.('consolidated')}
                            >
                                Consolidated
                            </button>
                        </fieldset>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        {mode === 'session' ? (
                            <>
                                <label className="flex items-center gap-2">
                                    <span className="sr-only">Session</span>
                                    <select
                                        aria-label="Select Session"
                                        data-testid="timeline-session-select"
                                        className="px-3 py-1.5 min-h-[44px] text-xs rounded-lg border border-base-content/20 bg-base-300 font-mono text-base-content max-w-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                        value={
                                            scope.source && scope.sessionId
                                                ? sessionKey(scope.source, scope.sessionId)
                                                : ''
                                        }
                                        onChange={(e) => {
                                            const target = availableSessions.find(
                                                (session) => sessionKey(session.source, session.id) === e.target.value,
                                            );
                                            if (target) onSelectSession?.(target.source, target.id);
                                        }}
                                    >
                                        {availableSessions.length > 0 ? (
                                            availableSessions.map((s) => (
                                                <option
                                                    key={sessionKey(s.source, s.id)}
                                                    value={sessionKey(s.source, s.id)}
                                                >
                                                    {sessionOptionLabel(s)}
                                                </option>
                                            ))
                                        ) : (
                                            <option
                                                value={
                                                    scope.source && scope.sessionId
                                                        ? sessionKey(scope.source, scope.sessionId)
                                                        : ''
                                                }
                                            >
                                                {scope.sessionId
                                                    ? sessionOptionLabel({
                                                          id: scope.sessionId,
                                                          source: scope.source ?? 'unknown',
                                                          start: scope.start ?? '',
                                                          tokenLoad: sessionTokenLoad,
                                                      })
                                                    : 'No session selected'}
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
                                        onClick={() =>
                                            prevSession && onSelectSession?.(prevSession.source, prevSession.id)
                                        }
                                    >
                                        ←
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="Next session"
                                        disabled={!nextSession}
                                        className="px-3 py-2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-xs font-mono rounded-lg border border-base-content/20 bg-base-300 text-base-content/80 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-base-content/10 transition-colors focus-visible:ring-2 focus-visible:ring-primary"
                                        onClick={() =>
                                            nextSession && onSelectSession?.(nextSession.source, nextSession.id)
                                        }
                                    >
                                        →
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-base-300 border border-base-content/20 text-xs font-mono">
                                    <span className="text-base-content/60">Scope:</span>
                                    <span className="font-semibold text-primary">{scope.sessionCount} sessions</span>
                                </div>
                                <form
                                    className="flex flex-wrap items-end gap-2"
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        onConsolidatedScopeSubmit?.({
                                            taskWbs: taskWbsDraft.trim(),
                                            runId: runIdDraft.trim(),
                                        });
                                    }}
                                >
                                    <label className="flex flex-col gap-1 text-[10px] font-mono text-base-content/60">
                                        Task WBS
                                        <input
                                            type="text"
                                            value={taskWbsDraft}
                                            onInput={(event) => setTaskWbsDraft(event.currentTarget.value)}
                                            className="min-h-[44px] w-28 rounded-lg border border-base-content/20 bg-base-300 px-2 text-xs text-base-content focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                        />
                                    </label>
                                    <label className="flex flex-col gap-1 text-[10px] font-mono text-base-content/60">
                                        Run ID
                                        <input
                                            type="text"
                                            value={runIdDraft}
                                            onInput={(event) => setRunIdDraft(event.currentTarget.value)}
                                            className="min-h-[44px] w-40 rounded-lg border border-base-content/20 bg-base-300 px-2 text-xs text-base-content focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                        />
                                    </label>
                                    <button
                                        type="submit"
                                        className="min-h-[44px] rounded-lg bg-primary px-3 text-xs font-semibold text-primary-content focus-visible:ring-2 focus-visible:ring-primary"
                                    >
                                        Apply scope
                                    </button>
                                </form>
                            </div>
                        )}

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
                        <span className="text-[10px] uppercase tracking-wider text-base-content/60">
                            {mode === 'session' ? 'SESSION' : 'SESSIONS'}
                        </span>
                        <span
                            className="font-semibold truncate"
                            title={scope.sessionId ?? `${scope.sessionCount} sessions`}
                        >
                            {scope.sessionId ? shortSessionId(scope.sessionId) : `${scope.sessionCount} total`}
                        </span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wider text-base-content/60">AGENT</span>
                        <span className="inline-flex items-center gap-1 font-semibold truncate">
                            {scope.source ? (
                                <>
                                    <AgentIcon id={scope.source} />
                                    {scope.source}
                                </>
                            ) : (
                                'multiple'
                            )}
                        </span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wider text-base-content/60">MODEL</span>
                        <span className="inline-flex items-center gap-1.5 truncate">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary/70 shrink-0" />
                            {scope.model ?? 'multiple'}
                        </span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wider text-base-content/60">STARTED</span>
                        <span className="truncate">{fmtUtcDayTime(scope.start)}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wider text-base-content/60">DURATION</span>
                        <span className="font-semibold truncate">{fmtDur(scope.durationMs / 60000)}</span>
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
                        <span className="truncate">{fmtTok(scope.tokens.outputTokens)}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wider text-base-content/60">TOOL CALLS</span>
                        <span className="truncate">{fmtInt(scope.toolCallCount)}</span>
                    </div>
                </div>

                {/* Scrubber Navigation */}
                <TimelineScrubber
                    blocks={filteredBlocks}
                    start={scope.start}
                    end={scope.end}
                    onJumpToTime={jumpToTime}
                />
            </div>

            {/* Truncation Notice Banner */}
            {truncated && (
                <div
                    data-testid="timeline-truncated-banner"
                    className="p-3 rounded-lg bg-info/10 border border-info/20 text-info font-mono text-xs flex items-center gap-2"
                >
                    <span>ℹ️</span>
                    <span>
                        Showing newest 5,000 events. Apply a narrower filter or time window to inspect earlier events.
                    </span>
                </div>
            )}

            {/* Continuous Vertical Rail & Chronological Stream */}
            <div
                data-testid="timeline-rail"
                className="relative py-2 sm:py-4 before:absolute before:left-2 sm:before:left-[136px] before:top-0 before:bottom-0 before:w-px before:bg-gradient-to-b before:from-transparent before:via-base-content/20 before:to-transparent flex flex-col gap-3"
            >
                {filteredBlocks.map((block) => {
                    const userEvents = block.events.filter((e) => e.kind === 'user');
                    const nonUserEvents = block.events.filter((e) => e.kind !== 'user');

                    return (
                        <div
                            key={block.key}
                            id={`timeline-block-${sanitizeHtmlId(block.key)}`}
                            data-testid={`timeline-block-${block.key}`}
                            className="flex flex-col gap-2.5"
                        >
                            {/* Consolidated Block Header with Correlation Badge */}
                            {mode === 'consolidated' && (
                                <div className="flex items-center gap-2 pl-6 sm:pl-[144px] pt-2 pb-1 font-mono text-xs text-base-content/70">
                                    <AgentIcon id={block.source} />
                                    <span className="font-bold text-base-content">{block.source}</span>
                                    <span>· {shortSessionId(block.sessionId)}</span>
                                    <span>· Turn #{block.turnIndex}</span>
                                    {block.correlationExactness && (
                                        <span
                                            data-testid={`timeline-exactness-${block.key}`}
                                            className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                                block.correlationExactness === 'exact'
                                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                            }`}
                                        >
                                            {block.correlationExactness}
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* Prompt Rows (User Events - 80% Width Right-Aligned) */}
                            {userEvents.map((ev) => {
                                const fullText = promptText(ev);
                                const telemetryText = ev.payload?.trim() ?? '';
                                const summary = promptSummary(fullText);
                                const hasPayload = !!ev.payload?.trim();
                                const isExpanded = !!expandedEvents[eventKey(block.key, ev.seq)];
                                const drawerId = sanitizeHtmlId(`timeline-user-drawer-${block.key}-${ev.seq}`);
                                const tooltipId = sanitizeHtmlId(`user-tt-${block.key}-${ev.seq}`);

                                return (
                                    <div
                                        key={eventKey(block.key, ev.seq)}
                                        className="relative flex flex-col sm:grid sm:grid-cols-[136px_minmax(0,1fr)] py-1"
                                        data-testid={`timeline-user-event-${block.key}-${ev.seq}`}
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
                                                            promptTokens={ev.promptTokens}
                                                            fullText={telemetryText}
                                                            tooltipId={tooltipId}
                                                        />
                                                        <span className="font-mono text-xs font-semibold text-base-content/90 truncate min-w-0">
                                                            {summary}
                                                        </span>
                                                    </div>

                                                    <div className="flex items-center gap-2 shrink-0 font-mono text-[11px] text-base-content/60">
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
                                                                onClick={() => toggleEvent(block.key, ev.seq)}
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
                                const isExpanded = !!expandedEvents[eventKey(block.key, ev.seq)];
                                const hasPayload = !!ev.payload?.trim();
                                const drawerId = sanitizeHtmlId(`timeline-op-drawer-${block.key}-${ev.seq}`);
                                const agentTooltipId = sanitizeHtmlId(`agent-tt-${block.key}-${ev.seq}`);
                                const toolTooltipId = sanitizeHtmlId(`tool-tt-${block.key}-${ev.seq}`);
                                const isAssistant = isAssistantEvent(ev);

                                return (
                                    <div
                                        key={eventKey(block.key, ev.seq)}
                                        className="relative flex flex-col sm:grid sm:grid-cols-[136px_minmax(0,1fr)] py-1 hover:z-30 focus-within:z-30"
                                        data-testid={`timeline-op-event-${block.key}-${ev.seq}`}
                                    >
                                        {/* Left Gutter: Timestamp & Step Duration */}
                                        <div className="hidden sm:flex flex-col items-end justify-center pr-4 font-mono text-[10.5px] text-base-content/70">
                                            <span className="font-semibold text-base-content/90">
                                                {fmtUtcClock(block.timestamp)}
                                            </span>
                                            {ev.durationSource === 'measured' && ev.durationMs !== null ? (
                                                <span
                                                    data-testid={`timeline-step-duration-${block.key}-${ev.seq}`}
                                                    className={
                                                        ev.durationMs >= 5_000
                                                            ? 'font-bold text-amber-400'
                                                            : 'text-base-content/60'
                                                    }
                                                >
                                                    ⏱ {fmtMs(ev.durationMs)}
                                                </span>
                                            ) : ev.durationSource === 'inferred' && ev.durationMs !== null ? (
                                                <span
                                                    data-testid={`timeline-step-duration-${block.key}-${ev.seq}`}
                                                    title="Inferred from next event timestamp within session"
                                                    className="text-base-content/60 italic"
                                                >
                                                    ⏱ ~{fmtMs(ev.durationMs)}
                                                </span>
                                            ) : (
                                                <span
                                                    data-testid={`timeline-step-duration-${block.key}-${ev.seq}`}
                                                    title="Unmeasured (gap > 10m or last event)"
                                                    className="text-base-content/40"
                                                >
                                                    ⏱ —
                                                </span>
                                            )}
                                        </div>

                                        {/* Continuous Rail Node */}
                                        <span
                                            data-timeline-node="operation"
                                            className="absolute left-[3.5px] sm:left-[131.5px] top-1/2 -translate-y-1/2 w-[9px] h-[9px] rounded-full ring-4 ring-base-100 z-10"
                                            style={{ backgroundColor: presentation.color }}
                                            aria-hidden="true"
                                        />

                                        {/* Right Column: Assistant Card or Tool Card */}
                                        <div className="pl-6 sm:pl-5 min-w-0 flex justify-start">
                                            {isAssistant ? (
                                                /* Assistant Message Card */
                                                <div className="w-[80%] max-w-none bg-base-100 rounded-lg border border-base-content/10 border-l-[3px] border-l-primary/70 transition-colors relative">
                                                    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 min-h-[38px]">
                                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                                            <AgentBadge
                                                                agentId={ev.agent || block.source}
                                                                model={ev.model || block.model}
                                                                timestamp={block.timestamp}
                                                                tooltipId={agentTooltipId}
                                                                freshInputTokens={ev.freshInputTokens}
                                                                cacheReadTokens={ev.cacheReadTokens}
                                                                outputTokens={ev.outputTokens}
                                                                sessionId={block.sessionId}
                                                            />
                                                            <span className="font-mono text-xs text-base-content/60 truncate">
                                                                {ev.model}
                                                            </span>
                                                            <span className="font-mono text-xs text-base-content/90 truncate min-w-0">
                                                                {promptSummary(ev.payload || ev.title)}
                                                            </span>
                                                        </div>

                                                        <div className="flex items-center gap-2 shrink-0 font-mono text-[11px] text-base-content/60">
                                                            <span>📤 {fmtTok(ev.outputTokens)}</span>
                                                            {hasPayload ? (
                                                                <button
                                                                    type="button"
                                                                    aria-label={
                                                                        isExpanded
                                                                            ? 'Collapse response'
                                                                            : 'Expand response'
                                                                    }
                                                                    aria-expanded={isExpanded}
                                                                    aria-controls={drawerId}
                                                                    onClick={() => toggleEvent(block.key, ev.seq)}
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

                                                    {isExpanded && ev.payload && (
                                                        <div
                                                            id={drawerId}
                                                            className="p-3 bg-[#0d141f] text-slate-100 font-mono text-xs whitespace-pre-wrap overflow-x-auto rounded-b-lg border-t border-base-content/10"
                                                        >
                                                            {ev.payload}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                /* Tool Execution Card */
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
                                                                tooltipId={agentTooltipId}
                                                                freshInputTokens={ev.freshInputTokens}
                                                                cacheReadTokens={ev.cacheReadTokens}
                                                                outputTokens={ev.outputTokens}
                                                                sessionId={block.sessionId}
                                                            />

                                                            <ToolCallTag
                                                                item={{
                                                                    toolName: presentation.label,
                                                                    seq: ev.seq,
                                                                    status:
                                                                        ev.exitCode === 0
                                                                            ? 'ok'
                                                                            : ev.exitCode !== null
                                                                              ? 'error'
                                                                              : 'ok',
                                                                    durationMs: ev.durationMs,
                                                                    durationSource: ev.durationSource,
                                                                    tokens: {
                                                                        billedTokens: ev.tokens,
                                                                        freshInputTokens: ev.freshInputTokens,
                                                                        cacheReadTokens: ev.cacheReadTokens,
                                                                        outputTokens: ev.outputTokens,
                                                                        cacheSavedTokens: 0,
                                                                    },
                                                                    argsRaw: ev.payload,
                                                                    sessionId: block.sessionId ?? activeSessionId,
                                                                    source: ev.agent || block.source,
                                                                    model: ev.model || block.model,
                                                                    ts: block.timestamp,
                                                                    errorText:
                                                                        ev.exitCode !== null && ev.exitCode !== 0
                                                                            ? ev.payload || `Exit code ${ev.exitCode}`
                                                                            : null,
                                                                }}
                                                                categoryColor={presentation.color}
                                                                testId={`timeline-tool-badge-${toolTooltipId}`}
                                                                tooltipId={toolTooltipId}
                                                                size="xs"
                                                            />

                                                            {ev.title && ev.title.trim().length > 0 ? (
                                                                <span
                                                                    className="font-mono text-xs font-semibold text-base-content/90 truncate min-w-0"
                                                                    title={ev.title}
                                                                >
                                                                    {ev.title}
                                                                </span>
                                                            ) : null}
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
                                                                    onClick={() => toggleEvent(block.key, ev.seq)}
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
                                            )}
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
