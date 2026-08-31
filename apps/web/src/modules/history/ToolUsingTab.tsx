import type {
    HistoryToolCategory,
    HistoryToolSequenceResponse,
    HistoryToolStatusFilter,
} from '@gobing-ai/spur-contracts';
import type React from 'react';
import { useMemo, useState } from 'react';

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

export const CATEGORY_COLOR: Record<HistoryToolCategory, string> = {
    read: '#10b981',
    write: '#eab308',
    bash: '#3b82f6',
    search: '#a855f7',
    mcp: '#6366f1',
    other: '#64748b',
};

/**
 * Token shares arrive unrounded so they sum back to their message totals exactly (0724 R2).
 * Rounding is presentation-only — never fold it back into the DTO.
 */
const fmtTokens = (value: number): string => Math.round(value).toLocaleString();

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
    const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
    const [copied, setCopied] = useState<boolean>(false);

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

    const selectedItem = useMemo(() => {
        if (!selectedItemKey) return null;
        return items.find((it) => `${it.sessionId}:${it.messageHash}:${it.toolSeq}` === selectedItemKey) ?? null;
    }, [items, selectedItemKey]);

    const formattedArgs = useMemo(() => {
        if (!selectedItem?.argsRaw) return null;
        try {
            const parsed = JSON.parse(selectedItem.argsRaw);
            return JSON.stringify(parsed, null, 2);
        } catch {
            return selectedItem.argsRaw;
        }
    }, [selectedItem]);

    const handleCopyArgs = async () => {
        if (!formattedArgs) return;
        try {
            await navigator.clipboard.writeText(formattedArgs);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard write fallback
        }
    };

    const toggleToolName = (name: string) => {
        if (toolNames.includes(name)) {
            onToolNamesChange(toolNames.filter((t) => t !== name));
        } else {
            onToolNamesChange([...toolNames, name]);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            {/* Top Summary Metrics Strip & Session Controls */}
            <div className="bg-base-200/60 rounded-xl p-4 border border-base-content/10 flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    {/* Mode & Session Switcher */}
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="inline-flex bg-base-300 p-0.5 rounded-lg text-xs">
                            <button
                                type="button"
                                className={`px-3 py-1 font-semibold rounded-md transition-all ${
                                    mode === 'session'
                                        ? 'bg-primary text-primary-content font-bold shadow-sm'
                                        : 'text-base-content/70 hover:bg-base-content/10'
                                }`}
                                onClick={() => onModeChange('session')}
                            >
                                Single Session
                            </button>
                            <button
                                type="button"
                                className={`px-3 py-1 font-semibold rounded-md transition-all ${
                                    mode === 'consolidated'
                                        ? 'bg-primary text-primary-content font-bold shadow-sm'
                                        : 'text-base-content/70 hover:bg-base-content/10'
                                }`}
                                onClick={() => onModeChange('consolidated')}
                            >
                                Consolidated Stream
                            </button>
                        </div>

                        {mode === 'session' && (
                            <select
                                className="bg-base-300 border border-base-content/20 rounded-lg px-2 py-1 text-xs font-mono max-w-xs focus:outline-none focus:ring-1 focus:ring-primary"
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
                        )}
                    </div>

                    {/* Quick Scope Metrics */}
                    <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-base-content/80">
                        <div>
                            <span className="text-base-content/50">Calls: </span>
                            <span className="font-bold text-base-content" data-testid="tool-scope-calls">
                                {scope?.totalCalls ?? 0}
                            </span>
                        </div>
                        <div>
                            <span className="text-base-content/50">Unique Tools: </span>
                            <span className="font-bold text-base-content" data-testid="tool-scope-unique">
                                {scope?.uniqueTools ?? 0}
                            </span>
                        </div>
                        <div>
                            <span className="text-base-content/50">Errors: </span>
                            <span
                                className={`font-bold ${(scope?.errorCount ?? 0) > 0 ? 'text-error' : 'text-success'}`}
                                data-testid="tool-scope-errors"
                            >
                                {scope?.errorCount ?? 0} ({Math.round((scope?.errorRate ?? 0) * 100)}%)
                            </span>
                        </div>
                        <div>
                            <span className="text-base-content/50">Mean Duration: </span>
                            <span className="font-bold text-base-content" data-testid="tool-scope-duration">
                                {scope?.meanDurationMs ? `${scope.meanDurationMs} ms` : '—'}
                            </span>
                            {(scope?.durationUnmeasured ?? 0) > 0 && (
                                <span className="text-xs text-base-content/50 ml-1">
                                    ({scope?.durationUnmeasured} unmeasured)
                                </span>
                            )}
                        </div>
                        <div>
                            <span className="text-base-content/50">Tokens: </span>
                            <span className="font-bold text-base-content" data-testid="tool-scope-tokens">
                                {scope ? fmtTokens(scope.tokens.billedTokens) : 0}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Filter Controls Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-base-content/10">
                    {/* Status Filter */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-base-content/60 font-semibold">Status:</span>
                        <div className="inline-flex bg-base-300 p-0.5 rounded-lg text-xs">
                            {(['all', 'ok', 'error'] as const).map((st) => (
                                <button
                                    key={st}
                                    type="button"
                                    className={`px-2.5 py-0.5 text-xs font-medium rounded-md transition-all ${
                                        status === st
                                            ? 'bg-base-content text-base-100 font-bold shadow-xs'
                                            : 'text-base-content/70 hover:bg-base-content/10'
                                    }`}
                                    onClick={() => onStatusChange(st)}
                                >
                                    {st.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Argument & Error Search */}
                    <div className="flex-1 max-w-md">
                        <input
                            type="text"
                            className="bg-base-300 border border-base-content/20 rounded-lg px-2.5 py-1 w-full text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                            placeholder="Search tool arguments, digest, or error text..."
                            value={search}
                            onChange={(e) => onSearchChange(e.target.value)}
                        />
                    </div>
                </div>

                {/* Tool Name Filter Pills */}
                {presentToolNames.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-[11px] text-base-content/50 font-semibold">Tools:</span>
                        {presentToolNames.map((toolName) => {
                            const isSelected = toolNames.includes(toolName);
                            return (
                                <button
                                    key={toolName}
                                    type="button"
                                    className={`px-2 py-0.5 rounded-full text-[11px] font-mono transition-all border ${
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
                                className="text-[11px] text-base-content/60 hover:text-base-content underline ml-1"
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
                <div className="bg-warning/10 text-warning border border-warning/20 p-3 rounded-lg text-xs font-medium">
                    <span>
                        Showing the first {items.length} tool calls. Refine your filters or search to narrow the scope.
                    </span>
                </div>
            )}

            {/* Error state */}
            {error && (
                <div className="bg-error/10 text-error border border-error/20 p-3 text-xs rounded-xl">
                    <span>{error}</span>
                </div>
            )}

            {/* Loading skeleton */}
            {loading && items.length === 0 && (
                <div className="flex flex-col gap-2 animate-pulse">
                    {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="h-14 bg-base-200 rounded-xl border border-base-content/5" />
                    ))}
                </div>
            )}

            {/* Empty state */}
            {!loading && !error && items.length === 0 && (
                <div className="bg-base-200/40 rounded-xl border border-base-content/10 p-12 text-center text-base-content/60">
                    <span className="text-3xl block mb-2">🔍</span>
                    <p className="text-sm font-semibold">No tool calls found</p>
                    <p className="text-xs mt-1">
                        {toolNames.length > 0 || status !== 'all' || search
                            ? 'No tool calls match your active filter criteria.'
                            : 'No tool invocations recorded for this scope.'}
                    </p>
                </div>
            )}

            {/* Main Content Layout: Sequence Waterfall + Detail Drawer */}
            <div className="flex gap-4 items-start relative">
                {/* Sequence Stream Waterfall List */}
                <div className="flex-1 flex flex-col gap-2 min-w-0">
                    {items.map((item) => {
                        const itemKey = `${item.sessionId}:${item.messageHash}:${item.toolSeq}`;
                        const isSelected = selectedItemKey === itemKey;
                        const categoryColor = CATEGORY_COLOR[item.category] ?? CATEGORY_COLOR.other;
                        const isError = item.status === 'error';

                        return (
                            <button
                                type="button"
                                key={itemKey}
                                className={`w-full text-left group p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                                    isSelected
                                        ? 'bg-base-200 border-primary shadow-sm'
                                        : 'bg-base-100 border-base-content/10 hover:border-base-content/30 hover:bg-base-200/50'
                                }`}
                                onClick={() => setSelectedItemKey(isSelected ? null : itemKey)}
                                data-testid={`tool-item-${item.seq}`}
                            >
                                {/* Left section: Sequence number, Category badge, Tool Name, Args snippet */}
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <span className="text-xs font-mono text-base-content/40 font-bold min-w-[28px]">
                                        #{item.seq}
                                    </span>

                                    {/* Category Pill */}
                                    <span
                                        className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold text-white uppercase tracking-wider shrink-0"
                                        style={{ backgroundColor: categoryColor }}
                                    >
                                        {item.category}
                                    </span>

                                    {/* Tool Name */}
                                    <span className="text-xs font-bold font-mono text-base-content shrink-0">
                                        {item.toolName}
                                    </span>

                                    {/* Args Digest or Snippet */}
                                    <span className="text-xs font-mono text-base-content/60 truncate min-w-0">
                                        {item.argsDigest || (item.argsRaw ? item.argsRaw.slice(0, 80) : '—')}
                                    </span>
                                </div>

                                {/* Right section: Latency, Tokens, Status Badge */}
                                <div className="flex items-center gap-3 shrink-0 text-xs font-mono">
                                    {/* Latency */}
                                    <span
                                        className="text-base-content/70"
                                        title={`Duration source: ${item.durationSource}`}
                                    >
                                        {item.durationMs !== null ? `${item.durationMs} ms` : '—'}
                                    </span>

                                    {/* Token share */}
                                    <span
                                        className="text-base-content/50 text-[11px]"
                                        title={`Tokens: ${fmtTokens(item.tokens.freshInputTokens)} fresh input, ${fmtTokens(item.tokens.cacheReadTokens)} cache read, ${fmtTokens(item.tokens.outputTokens)} output`}
                                    >
                                        {fmtTokens(item.tokens.billedTokens)} tok
                                    </span>

                                    {/* Status Pill */}
                                    <span
                                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                            isError ? 'bg-error/20 text-error' : 'bg-success/20 text-success'
                                        }`}
                                    >
                                        {item.status}
                                    </span>
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Inspection Detail Drawer */}
                {selectedItem && (
                    <div
                        className="w-[480px] shrink-0 bg-base-100 rounded-xl border border-base-content/20 shadow-xl p-4 flex flex-col gap-4 sticky top-4 max-h-[85vh] overflow-y-auto"
                        data-testid="tool-inspection-drawer"
                    >
                        {/* Drawer Header */}
                        <div className="flex items-center justify-between border-b border-base-content/10 pb-3">
                            <div className="flex items-center gap-2">
                                <span
                                    className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold text-white uppercase tracking-wider"
                                    style={{
                                        backgroundColor: CATEGORY_COLOR[selectedItem.category] ?? CATEGORY_COLOR.other,
                                    }}
                                >
                                    {selectedItem.category}
                                </span>
                                <span className="font-bold text-sm font-mono">{selectedItem.toolName}</span>
                                <span className="text-xs text-base-content/50 font-mono">#{selectedItem.seq}</span>
                            </div>
                            <button
                                type="button"
                                className="w-6 h-6 flex items-center justify-center rounded-md text-base-content/50 hover:text-base-content hover:bg-base-content/10 text-xs transition-colors"
                                onClick={() => setSelectedItemKey(null)}
                            >
                                ✕
                            </button>
                        </div>

                        {/* Error Callout if error */}
                        {selectedItem.errorText && (
                            <div className="bg-error/10 text-error border border-error/20 rounded-lg p-3 text-xs">
                                <div>
                                    <span className="font-bold block mb-1">Execution Error:</span>
                                    <pre className="font-mono text-[11px] whitespace-pre-wrap">
                                        {selectedItem.errorText}
                                    </pre>
                                </div>
                            </div>
                        )}

                        {/* Arguments Section */}
                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-base-content/70">Arguments (raw)</span>
                                {formattedArgs && (
                                    <button
                                        type="button"
                                        className="px-2 py-0.5 rounded text-[10px] font-mono text-base-content/70 hover:text-base-content hover:bg-base-content/10 transition-colors"
                                        onClick={handleCopyArgs}
                                    >
                                        {copied ? '✓ Copied' : 'Copy'}
                                    </button>
                                )}
                            </div>
                            {formattedArgs ? (
                                <pre className="bg-base-200 p-3 rounded-lg text-[11px] font-mono overflow-x-auto max-h-60 border border-base-content/10 text-base-content/90 whitespace-pre-wrap break-all">
                                    {formattedArgs}
                                </pre>
                            ) : (
                                <div className="p-3 bg-base-200/50 rounded-lg text-xs text-base-content/50 italic border border-base-content/10">
                                    Raw payload omitted at import; digest available: {selectedItem.argsDigest ?? '—'}
                                </div>
                            )}
                        </div>

                        {/* Digest Section */}
                        {selectedItem.argsDigest && (
                            <div className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-base-content/70">Arguments Digest</span>
                                <div className="p-2 bg-base-200 rounded-lg text-xs font-mono text-base-content/80 break-all">
                                    {selectedItem.argsDigest}
                                </div>
                            </div>
                        )}

                        {/* Metadata Details Grid */}
                        <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-base-200/60 p-3 rounded-lg border border-base-content/10">
                            <div>
                                <span className="text-base-content/50 block text-[10px]">STATUS</span>
                                <span
                                    className={`font-bold ${
                                        selectedItem.status === 'error' ? 'text-error' : 'text-success'
                                    }`}
                                >
                                    {selectedItem.status}
                                </span>
                            </div>
                            <div>
                                <span className="text-base-content/50 block text-[10px]">DURATION</span>
                                <span>
                                    {selectedItem.durationMs !== null
                                        ? `${selectedItem.durationMs} ms (${selectedItem.durationSource})`
                                        : `— (${selectedItem.durationSource})`}
                                </span>
                            </div>
                            <div>
                                <span className="text-base-content/50 block text-[10px]">TIMESTAMP</span>
                                <span className="text-[11px]">{selectedItem.ts ?? '—'}</span>
                            </div>
                            <div>
                                <span className="text-base-content/50 block text-[10px]">SOURCE / MODEL</span>
                                <span className="text-[11px]">
                                    {selectedItem.source} / {selectedItem.model ?? '—'}
                                </span>
                            </div>
                            <div>
                                <span className="text-base-content/50 block text-[10px]">SESSION ID</span>
                                <span className="text-[11px] truncate block" title={selectedItem.sessionId}>
                                    {selectedItem.sessionId}
                                </span>
                            </div>
                            <div>
                                <span className="text-base-content/50 block text-[10px]">CALL ID</span>
                                <span className="text-[11px] truncate block" title={selectedItem.callId ?? '—'}>
                                    {selectedItem.callId ?? '—'}
                                </span>
                            </div>
                            <div className="col-span-2 pt-1 border-t border-base-content/10">
                                <span className="text-base-content/50 block text-[10px]">TOKEN LOAD (SHARE)</span>
                                <span className="text-[11px]">
                                    Billed: {fmtTokens(selectedItem.tokens.billedTokens)} (Fresh:{' '}
                                    {fmtTokens(selectedItem.tokens.freshInputTokens)}, Cache Read:{' '}
                                    {fmtTokens(selectedItem.tokens.cacheReadTokens)}, Output:{' '}
                                    {fmtTokens(selectedItem.tokens.outputTokens)})
                                </span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ToolUsingTab;
