import type {
    HistoryToolCategory,
    HistoryToolSequenceResponse,
    HistoryToolStatusFilter,
} from '@gobing-ai/spur-contracts';
import type React from 'react';
import { useMemo, useRef, useState } from 'react';

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

/**
 * Format a file path into a concise, readable relative or base path.
 */
function formatFilePath(filePath: string): string {
    if (!filePath) return '';
    const clean = filePath.replace(/^\/?(Users|home)\/[^/]+\/[^/]+\/[^/]+\//, '');
    return clean || filePath;
}

/**
 * Extract a human-readable primary value from a tool call for at-a-glance comprehension.
 */
export function formatToolDisplayValue(item: {
    toolName: string;
    category: HistoryToolCategory;
    argsRaw: string | null;
    argsDigest: string | null;
}): string {
    const raw = item.argsRaw;
    const digest = item.argsDigest;

    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                // 1. Subagent / Agent coordination tools
                if (parsed.Subagents && Array.isArray(parsed.Subagents) && parsed.Subagents.length > 0) {
                    const sub = parsed.Subagents[0];
                    const role = sub.Role || sub.TypeName || 'subagent';
                    const prompt = sub.Prompt ? ` — ${String(sub.Prompt).replace(/\s+/g, ' ').slice(0, 80)}` : '';
                    const count = parsed.Subagents.length > 1 ? ` (+${parsed.Subagents.length - 1} more)` : '';
                    return `${role}${count}${prompt}`;
                }
                if (parsed.Recipient || parsed.recipient) {
                    const recipient = parsed.Recipient || parsed.recipient;
                    const msg = parsed.Message || parsed.message || '';
                    const msgSnippet = msg ? `: ${String(msg).replace(/\s+/g, ' ').slice(0, 80)}` : '';
                    return `→ ${recipient}${msgSnippet}`;
                }
                if (parsed.Role || parsed.TypeName || parsed.agent_name || parsed.agent) {
                    const agent = parsed.Role || parsed.TypeName || parsed.agent_name || parsed.agent;
                    const prompt = parsed.Prompt || parsed.prompt || parsed.description || parsed.instruction || '';
                    return prompt ? `${agent} — ${String(prompt).replace(/\s+/g, ' ').slice(0, 80)}` : String(agent);
                }

                // 2. Skill / SlashCommand tools
                const skillName =
                    parsed.skill ||
                    parsed.skill_name ||
                    parsed.skillName ||
                    (item.toolName.toLowerCase().includes('skill') && (parsed.name || parsed.skill)) ||
                    parsed.command_name ||
                    parsed.commandName;
                if (skillName && typeof skillName === 'string') {
                    const argsVal = parsed.args || parsed.prompt || parsed.input || parsed.parameters || '';
                    const argsSnippet = argsVal ? ` — ${String(argsVal).replace(/\s+/g, ' ').slice(0, 80)}` : '';
                    return `${skillName}${argsSnippet}`;
                }
                if (
                    typeof parsed.command === 'string' &&
                    (parsed.command.startsWith('/') || parsed.command.startsWith('sp:'))
                ) {
                    const argsVal = parsed.args || '';
                    const argsSnippet = argsVal ? ` — ${String(argsVal).replace(/\s+/g, ' ').slice(0, 80)}` : '';
                    return `${parsed.command}${argsSnippet}`;
                }

                // 3. Web / URL fetch tools
                const urlVal = parsed.Url || parsed.url;
                if (urlVal && typeof urlVal === 'string' && /^https?:\/\//i.test(urlVal)) {
                    return urlVal;
                }

                // 4. Read / View / File write tools
                const pathVal =
                    parsed.AbsolutePath ||
                    parsed.TargetFile ||
                    parsed.targetFile ||
                    parsed.path ||
                    parsed.file ||
                    parsed.filePath ||
                    parsed.file_path ||
                    parsed.filename ||
                    parsed.SearchDirectory ||
                    parsed.searchDirectory ||
                    parsed.uri ||
                    parsed.Uri;

                if (pathVal && typeof pathVal === 'string') {
                    const formattedPath = formatFilePath(pathVal);
                    if (parsed.StartLine !== undefined && parsed.EndLine !== undefined) {
                        return `${formattedPath} (L${parsed.StartLine}-${parsed.EndLine})`;
                    }
                    if (parsed.StartLine !== undefined) {
                        return `${formattedPath} (L${parsed.StartLine}+)`;
                    }
                    if (parsed.Instruction || parsed.Description) {
                        const instr = String(parsed.Instruction || parsed.Description)
                            .replace(/\s+/g, ' ')
                            .slice(0, 60);
                        return `${formattedPath} — ${instr}`;
                    }
                    return formattedPath;
                }

                // 5. Search / Grep / Find tools
                const queryVal = parsed.Query || parsed.query || parsed.Pattern || parsed.pattern || parsed.search_term;
                if (queryVal && typeof queryVal === 'string') {
                    const searchPath = parsed.SearchPath || parsed.searchPath || parsed.SearchDirectory || parsed.path;
                    const pathSuffix = searchPath ? ` in ${formatFilePath(String(searchPath))}` : '';
                    return `"${queryVal}"${pathSuffix}`;
                }

                // 6. Bash / Command tools
                const cmdVal = parsed.CommandLine || parsed.command || parsed.cmd || parsed.script;
                if (cmdVal && typeof cmdVal === 'string') {
                    return cmdVal;
                }

                // 7. MCP tools
                if (parsed.ToolName || parsed.toolName) {
                    const mcpTool = parsed.ToolName || parsed.toolName;
                    const server =
                        parsed.ServerName || parsed.serverName ? `${parsed.ServerName || parsed.serverName}: ` : '';
                    return `${server}${mcpTool}`;
                }

                // 6. Generic object keys: find first meaningful string
                for (const key of Object.keys(parsed)) {
                    const val = parsed[key];
                    if (
                        typeof val === 'string' &&
                        val.length > 0 &&
                        !key.toLowerCase().includes('token') &&
                        !key.toLowerCase().includes('action') &&
                        !key.toLowerCase().includes('summary')
                    ) {
                        if (/^[a-f0-9]{32,}$/i.test(val)) {
                            return `${key}: ${val.slice(0, 8)}…${val.slice(-6)}`;
                        }
                        return `${key}: ${val.replace(/\s+/g, ' ').slice(0, 80)}`;
                    }
                }
            }
        } catch {
            if (/^[a-f0-9]{32,}$/i.test(raw.trim())) {
                return `${raw.trim().slice(0, 8)}…${raw.trim().slice(-6)}`;
            }
            return raw;
        }
    }

    if (digest) {
        if (/^[a-f0-9]{32,}$/i.test(digest.trim())) {
            return `digest: ${digest.trim().slice(0, 8)}…${digest.trim().slice(-6)}`;
        }
        return digest;
    }

    return '—';
}

interface ToolItemTagTooltipProps {
    item: HistoryToolSequenceResponse['data']['items'][number];
    categoryColor: string;
}

const ToolItemTagTooltip: React.FC<ToolItemTagTooltipProps> = ({ item, categoryColor }) => {
    const [open, setOpen] = useState(false);
    const [pinned, setPinned] = useState(false);
    const [copied, setCopied] = useState(false);
    const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const formattedArgs = useMemo(() => {
        if (!item.argsRaw) return null;
        try {
            const parsed = JSON.parse(item.argsRaw);
            return JSON.stringify(parsed, null, 2);
        } catch {
            return item.argsRaw;
        }
    }, [item.argsRaw]);

    const handleCopyArgs = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!formattedArgs) return;
        try {
            await navigator.clipboard.writeText(formattedArgs);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard fallback
        }
    };

    const clearLeaveTimer = () => {
        if (leaveTimerRef.current) {
            clearTimeout(leaveTimerRef.current);
            leaveTimerRef.current = null;
        }
    };

    const handleMouseEnter = () => {
        clearLeaveTimer();
        setOpen(true);
    };

    const handleMouseLeave = () => {
        if (pinned) return;
        clearLeaveTimer();
        leaveTimerRef.current = setTimeout(() => {
            setOpen(false);
        }, 150);
    };

    const handleTagClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setPinned((prev) => !prev);
        setOpen(true);
    };

    const isVisible = open || pinned;
    const isError = item.status === 'error';

    return (
        <div className="relative inline-flex items-center">
            <button
                type="button"
                aria-describedby={`tool-tooltip-${item.seq}`}
                aria-expanded={isVisible}
                className="px-2 py-0.5 rounded-md text-[11px] font-mono font-bold text-white shrink-0 tracking-wide cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary shadow-xs transition-opacity hover:opacity-90"
                style={{ backgroundColor: categoryColor }}
                onClick={handleTagClick}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onFocus={() => {
                    clearLeaveTimer();
                    setOpen(true);
                }}
                onBlur={() => {
                    if (!pinned) setOpen(false);
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                        setPinned(false);
                        setOpen(false);
                    }
                }}
                data-testid={`tool-tag-${item.seq}`}
            >
                {item.toolName}
            </button>

            {isVisible && (
                <div
                    id={`tool-tooltip-${item.seq}`}
                    role="tooltip"
                    data-testid={`tool-tooltip-${item.seq}`}
                    data-inspector-tooltip="true"
                    className="absolute left-0 top-full mt-2 z-50 w-[880px] max-w-[95vw] bg-base-300 border border-base-content/20 shadow-2xl rounded-xl p-4 text-xs font-mono text-base-content backdrop-blur-md flex flex-col gap-3 pointer-events-auto select-text cursor-default"
                    onMouseEnter={() => {
                        clearLeaveTimer();
                        setOpen(true);
                    }}
                    onMouseLeave={handleMouseLeave}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            setPinned(false);
                            setOpen(false);
                        }
                        e.stopPropagation();
                    }}
                >
                    {/* Header: Exact tool name tag without duplicate text after it */}
                    <div className="flex items-center justify-between border-b border-base-content/10 pb-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                            <span
                                className="px-2.5 py-0.5 rounded-md text-xs font-bold text-white shrink-0 tracking-wide"
                                style={{ backgroundColor: categoryColor }}
                            >
                                {item.toolName}
                            </span>
                            <span className="text-xs text-base-content/50 font-bold">#{item.seq}</span>
                            <span className="text-[11px] text-base-content/60 uppercase tracking-wider">
                                ({item.category})
                            </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <span
                                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                    isError ? 'bg-error/20 text-error' : 'bg-success/20 text-success'
                                }`}
                            >
                                {item.status}
                            </span>
                            {pinned && (
                                <button
                                    type="button"
                                    className="text-base-content/50 hover:text-base-content text-xs p-1 leading-none rounded hover:bg-base-content/10 cursor-pointer"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setPinned(false);
                                        setOpen(false);
                                    }}
                                    title="Close tooltip"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Execution Error Box */}
                    {item.errorText && (
                        <div className="bg-error/10 text-error border border-error/20 rounded-lg p-2.5 text-xs">
                            <span className="font-bold block mb-1">Execution Error:</span>
                            <pre className="font-mono text-[11px] whitespace-pre-wrap max-h-36 overflow-y-auto">
                                {item.errorText}
                            </pre>
                        </div>
                    )}

                    {/* Arguments (raw) */}
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-base-content/70">Arguments (raw)</span>
                            {formattedArgs && (
                                <button
                                    type="button"
                                    className="px-2 py-0.5 rounded text-[10px] font-mono text-base-content/70 hover:text-base-content hover:bg-base-content/10 transition-colors cursor-pointer border border-base-content/10"
                                    onClick={handleCopyArgs}
                                >
                                    {copied ? '✓ Copied' : 'Copy'}
                                </button>
                            )}
                        </div>
                        {formattedArgs ? (
                            <pre className="bg-base-100 p-3 rounded-lg text-[11px] font-mono overflow-x-auto max-h-60 border border-base-content/10 whitespace-pre-wrap break-all text-base-content/90">
                                {formattedArgs}
                            </pre>
                        ) : (
                            <div className="p-2.5 bg-base-100/50 rounded-lg text-xs text-base-content/50 italic border border-base-content/10">
                                Raw payload omitted at import; digest available: {item.argsDigest ?? '—'}
                            </div>
                        )}
                        {item.argsDigest && item.argsDigest !== item.argsRaw && (
                            <div className="text-[10px] text-base-content/50 truncate mt-0.5">
                                <span className="font-semibold">Digest: </span>
                                {item.argsDigest}
                            </div>
                        )}
                    </div>

                    {/* Metadata Diagnostics Grid - 3-4 columns for double width */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono bg-base-200/70 p-2.5 rounded-lg border border-base-content/10">
                        <div>
                            <span className="text-base-content/50 block text-[10px]">DURATION</span>
                            <span className="text-[11px]">
                                {item.durationMs !== null
                                    ? `${item.durationMs} ms (${item.durationSource})`
                                    : `— (${item.durationSource})`}
                            </span>
                        </div>
                        <div>
                            <span className="text-base-content/50 block text-[10px]">TIMESTAMP</span>
                            <span className="text-[11px] truncate block">{item.ts ?? '—'}</span>
                        </div>
                        <div>
                            <span className="text-base-content/50 block text-[10px]">SOURCE / MODEL</span>
                            <span
                                className="text-[11px] truncate block"
                                title={`${item.source} / ${item.model ?? '—'}`}
                            >
                                {item.source} / {item.model ?? '—'}
                            </span>
                        </div>
                        <div>
                            <span className="text-base-content/50 block text-[10px]">SESSION ID</span>
                            <span className="text-[11px] truncate block" title={item.sessionId}>
                                {item.sessionId}
                            </span>
                        </div>
                        {item.callId && (
                            <div className="col-span-2 md:col-span-4">
                                <span className="text-base-content/50 block text-[10px]">CALL ID</span>
                                <span className="text-[11px] truncate block" title={item.callId}>
                                    {item.callId}
                                </span>
                            </div>
                        )}
                        <div className="col-span-2 md:col-span-4 pt-1 border-t border-base-content/10">
                            <span className="text-base-content/50 block text-[10px]">TOKEN LOAD (SHARE)</span>
                            <span className="text-[11px]">
                                Billed: {fmtTokens(item.tokens.billedTokens)} (Fresh:{' '}
                                {fmtTokens(item.tokens.freshInputTokens)}, Cache:{' '}
                                {fmtTokens(item.tokens.cacheReadTokens)}, Output: {fmtTokens(item.tokens.outputTokens)})
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

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
                                    data-testid={`tool-filter-${toolName}`}
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
                                className="w-full text-left group p-3 rounded-xl border border-base-content/10 hover:border-base-content/30 hover:bg-base-200/50 bg-base-100 transition-all flex items-center justify-between gap-3 relative"
                                data-testid={`tool-item-${item.seq}`}
                            >
                                {/* Left section: Sequence number, Tool Name Tag with Tooltip, Raw Arguments */}
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <span className="text-xs font-mono text-base-content/40 font-bold min-w-[28px]">
                                        #{item.seq}
                                    </span>

                                    {/* Tool Name Tag (with hover/click tooltip) */}
                                    <ToolItemTagTooltip item={item} categoryColor={categoryColor} />

                                    {/* Primary human-readable value on the bar */}
                                    <span
                                        className="text-xs font-mono text-base-content/70 truncate min-w-0 flex-1"
                                        title={item.argsRaw || item.argsDigest || ''}
                                    >
                                        {formatToolDisplayValue(item)}
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
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default ToolUsingTab;
