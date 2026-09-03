import type { HistoryToolSequenceResponse, HistoryToolStatusFilter } from '@gobing-ai/spur-contracts';
import type React from 'react';
import { useMemo } from 'react';
import { AgentIcon } from './AgentIcon';
import { AgentBadge, CATEGORY_COLOR, formatTokens, formatToolDisplayValue, ToolItemTagTooltip } from './ToolCallDetail';

export interface TimelineRosterEntry {
    id: string;
    source: string;
    model: string;
    start: string;
    tokenLoad: number;
}

export interface ToolUsingTabProps {
    data?: HistoryToolSequenceResponse['data'];
    loading?: boolean;
    error?: string | null;
    mode?: 'session' | 'consolidated';
    onModeChange?: (mode: 'session' | 'consolidated') => void;
    sessionId?: string;
    sessionSource?: string;
    availableSessions?: TimelineRosterEntry[];
    onSelectSession?: (source: string, id: string) => void;
    toolNames?: string[];
    onToolNamesChange?: (names: string[]) => void;
    status?: HistoryToolStatusFilter;
    onStatusChange?: (status: HistoryToolStatusFilter) => void;
    search?: string;
    onSearchChange?: (search: string) => void;
}

export {
    AgentBadge,
    CATEGORY_BG_CLASS,
    CATEGORY_COLOR,
    formatFilePath,
    formatTokens,
    formatToolDisplayValue,
    getToolCategory,
    ToolCallTag,
    ToolItemTagTooltip,
} from './ToolCallDetail';

const fmtTokens = formatTokens;

export const ToolUsingTab: React.FC<ToolUsingTabProps> = ({
    data,
    loading = false,
    error = null,
    mode = 'session',
    onModeChange = () => {},
    sessionId,
    sessionSource,
    availableSessions = [],
    onSelectSession = () => {},
    toolNames = [],
    onToolNamesChange = () => {},
    status = 'all',
    onStatusChange = () => {},
    search = '',
    onSearchChange = () => {},
}) => {
    const items = data?.items ?? [];
    const scope = data?.scope;

    // Derived unique tool names present in the dataset for quick toggle pills
    const presentToolNames = useMemo(() => {
        const set = new Set<string>();
        for (const item of items) {
            set.add(item.toolName);
        }
        return Array.from(set).sort();
    }, [items]);

    const toggleToolName = (name: string) => {
        if (toolNames.includes(name)) {
            onToolNamesChange(toolNames.filter((t) => t !== name));
        } else {
            onToolNamesChange([...toolNames, name]);
        }
    };

    const hasActiveFilters = toolNames.length > 0 || status !== 'all' || search.trim().length > 0;

    return (
        <div className="flex flex-col gap-4">
            {/* Top Control Bar & Scope Summary */}
            <div className="bg-base-200 rounded-xl p-4 border border-base-content/10 flex flex-col gap-4 shadow-xs">
                {/* Mode & Session Switcher Row */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-base-content/10">
                    <div className="flex flex-wrap items-center gap-3">
                        {/* Mode Switcher Segmented Control */}
                        <div className="inline-flex bg-base-300 p-1 rounded-xl border border-base-content/5 text-xs font-mono">
                            <button
                                type="button"
                                className={`px-3.5 py-1.5 font-bold rounded-lg transition-all cursor-pointer ${
                                    mode === 'session'
                                        ? 'bg-primary text-primary-content shadow-xs'
                                        : 'text-base-content/70 hover:text-base-content hover:bg-base-content/5'
                                }`}
                                onClick={() => onModeChange('session')}
                            >
                                Single Session
                            </button>
                            <button
                                type="button"
                                className={`px-3.5 py-1.5 font-bold rounded-lg transition-all cursor-pointer ${
                                    mode === 'consolidated'
                                        ? 'bg-primary text-primary-content shadow-xs'
                                        : 'text-base-content/70 hover:text-base-content hover:bg-base-content/5'
                                }`}
                                onClick={() => onModeChange('consolidated')}
                            >
                                Consolidated Stream
                            </button>
                        </div>

                        {/* Session Selector (Session Mode) */}
                        {mode === 'session' && (
                            <div className="flex items-center gap-1.5">
                                {sessionSource && (
                                    <span className="w-5 h-5 flex items-center justify-center text-base-content/80">
                                        <AgentIcon id={sessionSource} />
                                    </span>
                                )}
                                <select
                                    className="bg-base-300 border border-base-content/20 rounded-xl px-3 py-1.5 text-xs font-mono max-w-sm focus:outline-hidden focus:border-primary cursor-pointer text-base-content"
                                    value={sessionId ? `${sessionSource ?? ''}:${sessionId}` : ''}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        const [src, ...idParts] = val.split(':');
                                        if (src && idParts.length > 0) {
                                            onSelectSession(src, idParts.join(':'));
                                        }
                                    }}
                                >
                                    {availableSessions.map((s) => (
                                        <option key={`${s.source}:${s.id}`} value={`${s.source}:${s.id}`}>
                                            [{s.source}] {s.id.slice(0, 16)}... ({s.model})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>

                    {mode === 'consolidated' && (
                        <span className="text-[11px] font-mono text-base-content/50 bg-base-300 px-2.5 py-1 rounded-full">
                            Consolidated across all window sessions
                        </span>
                    )}
                </div>

                {/* Scope KPI Cards Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    <div className="bg-base-300/60 rounded-xl p-3 border border-base-content/5 flex flex-col justify-between">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-base-content/50">
                            Total Calls
                        </span>
                        <div className="mt-1">
                            <span
                                className="text-lg font-bold font-mono text-base-content"
                                data-testid="tool-scope-calls"
                            >
                                {scope?.totalCalls ?? 0}
                            </span>
                        </div>
                    </div>

                    <div className="bg-base-300/60 rounded-xl p-3 border border-base-content/5 flex flex-col justify-between">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-base-content/50">
                            Unique Tools
                        </span>
                        <div className="mt-1">
                            <span
                                className="text-lg font-bold font-mono text-base-content"
                                data-testid="tool-scope-unique"
                            >
                                {scope?.uniqueTools ?? 0}
                            </span>
                        </div>
                    </div>

                    <div className="bg-base-300/60 rounded-xl p-3 border border-base-content/5 flex flex-col justify-between">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-base-content/50">
                            Errors / Rate
                        </span>
                        <div className="mt-1">
                            <span
                                className={`text-lg font-bold font-mono ${
                                    (scope?.errorCount ?? 0) > 0 ? 'text-error' : 'text-success'
                                }`}
                                data-testid="tool-scope-errors"
                            >
                                {scope?.errorCount ?? 0} ({Math.round((scope?.errorRate ?? 0) * 100)}%)
                            </span>
                        </div>
                    </div>

                    <div className="bg-base-300/60 rounded-xl p-3 border border-base-content/5 flex flex-col justify-between">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-base-content/50">
                            Mean Duration
                        </span>
                        <div className="mt-1">
                            <span
                                className="text-lg font-bold font-mono text-base-content"
                                data-testid="tool-scope-duration"
                            >
                                {scope?.meanDurationMs ? `${scope.meanDurationMs} ms` : '—'}
                            </span>
                            {(scope?.durationUnmeasured ?? 0) > 0 && (
                                <span className="text-[10px] text-base-content/50 ml-1 font-mono block">
                                    ({scope?.durationUnmeasured} unmeasured)
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="bg-base-300/60 rounded-xl p-3 border border-base-content/5 flex flex-col justify-between">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-base-content/50">
                            Billed Tokens
                        </span>
                        <div className="mt-1">
                            <span className="text-lg font-bold font-mono text-primary" data-testid="tool-scope-tokens">
                                {scope ? fmtTokens(scope.tokens.billedTokens) : 0}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Filter Controls Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-base-content/10">
                    {/* Status Filter Toggle */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-base-content/60 font-semibold font-mono">Status:</span>
                        <div className="inline-flex bg-base-300 p-0.5 rounded-lg text-xs font-mono">
                            {(['all', 'ok', 'error'] as const).map((st) => (
                                <button
                                    key={st}
                                    type="button"
                                    className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                                        status === st
                                            ? st === 'error'
                                                ? 'bg-error text-error-content shadow-xs'
                                                : 'bg-base-content text-base-100 shadow-xs'
                                            : 'text-base-content/70 hover:bg-base-content/10'
                                    }`}
                                    onClick={() => onStatusChange(st)}
                                >
                                    {st.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Argument & Error Search Input */}
                    <div className="flex-1 max-w-md relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs opacity-40">🔍</span>
                        <input
                            type="text"
                            className="bg-base-300 border border-base-content/20 rounded-xl pl-8 pr-7 py-1.5 w-full text-xs font-mono focus:outline-hidden focus:border-primary placeholder:text-base-content/40"
                            placeholder="Search tool arguments, digest, or error text..."
                            value={search}
                            onChange={(e) => onSearchChange(e.target.value)}
                        />
                        {search && (
                            <button
                                type="button"
                                onClick={() => onSearchChange('')}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-base-content/40 hover:text-base-content cursor-pointer"
                            >
                                ✕
                            </button>
                        )}
                    </div>
                </div>

                {/* Tool Name Filter Pills */}
                {presentToolNames.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-base-content/5">
                        <span className="text-[11px] text-base-content/50 font-semibold font-mono">Tools:</span>
                        {presentToolNames.map((toolName) => {
                            const isSelected = toolNames.includes(toolName);
                            return (
                                <button
                                    key={toolName}
                                    type="button"
                                    data-testid={`tool-filter-${toolName}`}
                                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono transition-all border cursor-pointer ${
                                        isSelected
                                            ? 'bg-primary text-primary-content border-primary font-bold shadow-xs'
                                            : 'bg-base-300 text-base-content/80 border-base-content/10 hover:border-base-content/30'
                                    }`}
                                    onClick={() => toggleToolName(toolName)}
                                >
                                    {toolName}
                                </button>
                            );
                        })}
                        {toolNames.length > 0 && (
                            <button
                                type="button"
                                className="text-[11px] text-base-content/60 hover:text-base-content underline ml-1 font-mono cursor-pointer"
                                onClick={() => onToolNamesChange([])}
                            >
                                Clear ({toolNames.length})
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Truncated notice */}
            {data?.truncated && (
                <div className="bg-warning/10 text-warning border border-warning/20 p-3 rounded-xl text-xs font-medium flex items-center gap-2">
                    <span>⚠️</span>
                    <span>
                        Showing the first {items.length} tool calls. Refine your filters or search to narrow the scope.
                    </span>
                </div>
            )}

            {/* Error state */}
            {error && (
                <div className="bg-error/10 text-error border border-error/20 p-4 text-xs rounded-xl flex items-center gap-2">
                    <span>⚠️</span>
                    <span>{error}</span>
                </div>
            )}

            {/* Loading skeleton */}
            {loading && items.length === 0 && (
                <div className="flex flex-col gap-2.5 animate-pulse">
                    {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="h-16 bg-base-200 rounded-xl border border-base-content/5" />
                    ))}
                </div>
            )}

            {/* Empty state */}
            {!loading && !error && items.length === 0 && (
                <div className="bg-base-200/40 rounded-xl border border-base-content/10 p-12 text-center text-base-content/60 flex flex-col items-center gap-2">
                    <span className="text-3xl block mb-1">🔍</span>
                    <p className="text-sm font-semibold">No tool calls found</p>
                    <p className="text-xs max-w-sm">
                        {hasActiveFilters
                            ? 'No tool calls match your active filter criteria. Try clearing search or status filters.'
                            : 'No tool invocations recorded for this scope.'}
                    </p>
                </div>
            )}

            {/* Sequence Stream Waterfall List */}
            {items.length > 0 && (
                <div className="flex flex-col gap-2 w-full">
                    {items.map((item) => {
                        const itemKey = `${item.sessionId}:${item.messageHash}:${item.toolSeq}`;
                        const categoryColor = CATEGORY_COLOR[item.category] ?? CATEGORY_COLOR.other;
                        const isError = item.status === 'error';

                        return (
                            <div
                                key={itemKey}
                                className="w-full text-left group p-3 rounded-xl border border-base-content/10 hover:border-base-content/30 hover:bg-base-200/60 bg-base-200/30 transition-all flex items-center justify-between gap-3 relative"
                                data-testid={`tool-item-${item.seq}`}
                            >
                                {/* Left section: Agent Badge, Sequence #, Tool Tag with Tooltip, Formatted Arguments */}
                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                    <AgentBadge
                                        agentId={item.source}
                                        model={item.model}
                                        timestamp={item.ts}
                                        freshInputTokens={item.tokens.freshInputTokens}
                                        cacheReadTokens={item.tokens.cacheReadTokens}
                                        outputTokens={item.tokens.outputTokens}
                                        sessionId={item.sessionId}
                                    />

                                    <span className="text-xs font-mono text-base-content/40 font-bold min-w-[28px]">
                                        #{item.seq}
                                    </span>

                                    {/* Tool Name Tag (with hover/click tooltip) */}
                                    <ToolItemTagTooltip item={item} categoryColor={categoryColor} />

                                    {/* Primary human-readable value on the bar */}
                                    <span
                                        className="text-xs font-mono text-base-content/80 truncate min-w-0 flex-1"
                                        title={item.argsRaw || item.argsDigest || ''}
                                    >
                                        {formatToolDisplayValue(item)}
                                    </span>
                                </div>

                                {/* Right section: Latency, Tokens, Status Badge */}
                                <div className="flex items-center gap-3 shrink-0 text-xs font-mono">
                                    {/* Latency */}
                                    <span
                                        className="text-base-content/70 tabular-nums"
                                        title={`Duration source: ${item.durationSource}`}
                                    >
                                        {item.durationMs !== null ? `${item.durationMs} ms` : '—'}
                                    </span>

                                    {/* Token share */}
                                    <span
                                        className="text-base-content/50 text-[11px] tabular-nums"
                                        title={`Tokens: ${fmtTokens(item.tokens.freshInputTokens)} fresh input, ${fmtTokens(item.tokens.cacheReadTokens)} cache read, ${fmtTokens(item.tokens.outputTokens)} output`}
                                    >
                                        {fmtTokens(item.tokens.billedTokens)} tok
                                    </span>

                                    {/* Status Pill */}
                                    <span
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                                            isError
                                                ? 'bg-error/15 text-error border-error/30'
                                                : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                        }`}
                                    >
                                        <span className="w-1 h-1 rounded-full bg-current" />
                                        {item.status}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default ToolUsingTab;
