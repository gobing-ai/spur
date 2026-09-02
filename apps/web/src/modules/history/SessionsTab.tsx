import type { HistorySessionsResponse, HistoryToolCategory } from '@gobing-ai/spur-contracts';
import type React from 'react';
import { useState } from 'react';
import { AgentIcon } from './AgentIcon';
import { fmtDateTime, fmtDur, fmtInt, fmtTok } from './charts';
import { CATEGORY_BG_CLASS } from './ToolCallDetail';

export interface SessionsTabProps {
    data?: HistorySessionsResponse['data'];
    loading?: boolean;
    error?: string | null;
    sortBy?: 'start' | 'duration' | 'messages' | 'toolCalls' | 'billedTokens' | 'cacheRead' | 'freshInput';
    sortDir?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
    onSortChange?: (
        field: 'start' | 'duration' | 'messages' | 'toolCalls' | 'billedTokens' | 'cacheRead' | 'freshInput',
    ) => void;
    onPageChange?: (page: number) => void;
    onSelectSession?: (source: string, sessionId: string) => void;
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

export const SessionsTab: React.FC<SessionsTabProps> = ({
    data,
    loading,
    error,
    sortBy = 'start',
    sortDir = 'desc',
    page = 1,
    pageSize = 20,
    onSortChange,
    onPageChange,
    onSelectSession,
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [stateFilter, setStateFilter] = useState<'all' | 'ok' | 'error'>('all');

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center p-20 gap-3">
                <div className="w-9 h-9 rounded-full border-3 border-primary border-t-transparent animate-spin" />
                <span className="text-xs font-mono text-base-content/60">Loading session records...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-5 rounded-xl bg-error/10 border border-error/20 text-error flex items-center gap-3">
                <span className="text-lg">⚠️</span>
                <div>
                    <h5 className="font-bold text-sm">Failed to load sessions: {error}</h5>
                    <p className="text-xs opacity-80">Please check your connection and try refreshing.</p>
                </div>
            </div>
        );
    }

    if (!data) return null;

    const { items, total } = data;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // Page summary aggregates
    const pageBilled = items.reduce((acc, s) => acc + s.billedTokens, 0);
    const pageCacheRead = items.reduce((acc, s) => acc + s.cacheReadTokens, 0);
    const pageErrors = items.filter((s) => s.state === 'error').length;
    const maxItemBilled = Math.max(1, ...items.map((s) => s.billedTokens));

    // Filter items based on local search & state filter
    const filteredItems = items.filter((s) => {
        if (stateFilter !== 'all' && s.state !== stateFilter) return false;
        if (!searchTerm.trim()) return true;
        const q = searchTerm.toLowerCase();
        return (
            s.id.toLowerCase().includes(q) ||
            s.source.toLowerCase().includes(q) ||
            s.model.toLowerCase().includes(q) ||
            s.topTool.toLowerCase().includes(q)
        );
    });

    const renderSortArrow = (field: string) => {
        if (sortBy !== field) return <span className="opacity-25 ml-1 text-[10px]">↕</span>;
        return <span className="ml-1 text-primary font-bold">{sortDir === 'asc' ? '▲' : '▼'}</span>;
    };

    return (
        <div className="flex flex-col gap-4">
            {/* Session KPI Summary Strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-base-200 rounded-xl p-4 border border-base-content/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-mono uppercase tracking-wider text-base-content/60">
                            Total Sessions
                        </span>
                        <span className="text-primary">📋</span>
                    </div>
                    <div className="mt-2">
                        <div className="text-xl font-bold font-mono text-base-content">{fmtInt(total)}</div>
                        <div className="text-[11px] text-base-content/60 font-mono mt-0.5">
                            Showing page {page} of {totalPages}
                        </div>
                    </div>
                </div>

                <div className="bg-base-200 rounded-xl p-4 border border-base-content/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-mono uppercase tracking-wider text-base-content/60">
                            Page Billed Tokens
                        </span>
                        <span className="text-primary">⚡</span>
                    </div>
                    <div className="mt-2">
                        <div className="text-xl font-bold font-mono text-primary">{fmtTok(pageBilled)}</div>
                        <div className="text-[11px] text-base-content/60 font-mono mt-0.5">
                            Across {items.length} page sessions
                        </div>
                    </div>
                </div>

                <div className="bg-base-200 rounded-xl p-4 border border-base-content/10 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-mono uppercase tracking-wider text-base-content/60">
                            Page Cache Read
                        </span>
                        <span className="text-cyan-400">💾</span>
                    </div>
                    <div className="mt-2">
                        <div className="text-xl font-bold font-mono text-cyan-400">{fmtTok(pageCacheRead)}</div>
                        <div className="text-[11px] text-base-content/60 font-mono mt-0.5">Reused context tokens</div>
                    </div>
                </div>

                <div
                    className={`rounded-xl p-4 border flex flex-col justify-between transition-all ${
                        pageErrors > 0 ? 'bg-error/10 border-error/30 text-error' : 'bg-base-200 border-base-content/10'
                    }`}
                >
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-mono uppercase tracking-wider text-base-content/60">
                            Session Status
                        </span>
                        <span>{pageErrors > 0 ? '⚠️' : '✓'}</span>
                    </div>
                    <div className="mt-2">
                        <div className="text-xl font-bold font-mono">
                            {items.length - pageErrors} OK · {pageErrors} Error
                        </div>
                        <div className="text-[11px] text-base-content/60 font-mono mt-0.5">
                            {pageErrors === 0 ? '100% successful on page' : `${pageErrors} failed sessions`}
                        </div>
                    </div>
                </div>
            </div>

            {/* Quick Filter / Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-base-200 p-3 rounded-xl border border-base-content/10">
                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                    <span className="text-base-content/40 text-xs">🔍</span>
                    <input
                        type="text"
                        placeholder="Filter sessions by ID, model, agent, or tool..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="bg-base-300/60 text-xs font-mono px-3 py-1.5 rounded-lg border border-base-content/10 w-full focus:outline-hidden focus:border-primary placeholder:text-base-content/40"
                    />
                    {searchTerm && (
                        <button
                            type="button"
                            onClick={() => setSearchTerm('')}
                            className="text-xs text-base-content/50 hover:text-base-content cursor-pointer"
                        >
                            ✕
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-1.5 text-xs font-mono">
                    <span className="text-base-content/50 text-[11px] uppercase tracking-wider mr-1">State:</span>
                    {(['all', 'ok', 'error'] as const).map((st) => (
                        <button
                            key={st}
                            type="button"
                            onClick={() => setStateFilter(st)}
                            className={`px-2.5 py-1 rounded-md text-xs uppercase font-bold transition-colors cursor-pointer ${
                                stateFilter === st
                                    ? 'bg-primary text-primary-content shadow-xs'
                                    : 'bg-base-300 text-base-content/70 hover:bg-base-300/80'
                            }`}
                        >
                            {st}
                        </button>
                    ))}
                </div>
            </div>

            {/* Sessions Table Container */}
            <div className="bg-base-200 rounded-xl shadow-xs border border-base-content/10 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left font-mono">
                        <thead>
                            <tr className="bg-base-300/80 text-base-content/70 border-b border-base-content/10 select-none">
                                <th className="p-3 whitespace-nowrap">Session ID</th>
                                <th className="p-3 whitespace-nowrap">Agent</th>
                                <th className="p-3 whitespace-nowrap">Model</th>
                                <th
                                    className="p-3 cursor-pointer hover:text-primary transition-colors whitespace-nowrap"
                                    onClick={() => onSortChange?.('start')}
                                >
                                    Start Time {renderSortArrow('start')}
                                </th>
                                <th
                                    className="p-3 cursor-pointer hover:text-primary transition-colors text-right whitespace-nowrap"
                                    onClick={() => onSortChange?.('duration')}
                                >
                                    Duration {renderSortArrow('duration')}
                                </th>
                                <th
                                    className="p-3 cursor-pointer hover:text-primary transition-colors text-right whitespace-nowrap"
                                    onClick={() => onSortChange?.('messages')}
                                >
                                    Msgs {renderSortArrow('messages')}
                                </th>
                                <th
                                    className="p-3 cursor-pointer hover:text-primary transition-colors text-right whitespace-nowrap"
                                    onClick={() => onSortChange?.('toolCalls')}
                                >
                                    Tools {renderSortArrow('toolCalls')}
                                </th>
                                <th
                                    className="p-3 cursor-pointer hover:text-primary transition-colors text-right whitespace-nowrap"
                                    onClick={() => onSortChange?.('billedTokens')}
                                >
                                    Billed Tok {renderSortArrow('billedTokens')}
                                </th>
                                <th
                                    className="p-3 cursor-pointer hover:text-primary transition-colors text-right whitespace-nowrap"
                                    onClick={() => onSortChange?.('cacheRead')}
                                >
                                    Cache Read {renderSortArrow('cacheRead')}
                                </th>
                                <th
                                    className="p-3 cursor-pointer hover:text-primary transition-colors text-right whitespace-nowrap"
                                    onClick={() => onSortChange?.('freshInput')}
                                >
                                    Fresh Input {renderSortArrow('freshInput')}
                                </th>
                                <th className="p-3 whitespace-nowrap">Top Tool</th>
                                <th className="p-3 text-center whitespace-nowrap">State</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredItems.length === 0 ? (
                                <tr>
                                    <td colSpan={12} className="text-center py-12 text-base-content/50">
                                        No sessions matching the current filter.
                                    </td>
                                </tr>
                            ) : (
                                filteredItems.map((s) => {
                                    const cat = resolveToolCategory(s.topTool);
                                    const catBadge = CATEGORY_BG_CLASS[cat] ?? CATEGORY_BG_CLASS.other;
                                    const billedPercent = Math.min(
                                        100,
                                        Math.round((s.billedTokens / maxItemBilled) * 100),
                                    );

                                    return (
                                        <tr
                                            key={`${s.source}:::${s.id}`}
                                            className="border-b border-base-content/5 hover:bg-primary/10 cursor-pointer transition-colors group"
                                            onClick={() => onSelectSession?.(s.source, s.id)}
                                            title="Click to view execution timeline"
                                        >
                                            <td className="p-3 font-bold text-primary whitespace-nowrap">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-mono text-xs" title={s.id}>
                                                        {s.id.length > 18 ? `${s.id.slice(0, 16)}…` : s.id}
                                                    </span>
                                                    <span className="text-[10px] opacity-40 group-hover:opacity-100 transition-opacity">
                                                        ↗
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="p-3 whitespace-nowrap">
                                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] bg-base-300 border border-base-content/10 font-mono text-base-content">
                                                    <span className="w-3.5 h-3.5 flex items-center justify-center opacity-80">
                                                        <AgentIcon id={s.source} />
                                                    </span>
                                                    <span>{s.source}</span>
                                                </span>
                                            </td>
                                            <td className="p-3 text-base-content/80 whitespace-nowrap">
                                                <span className="px-1.5 py-0.5 rounded bg-base-300/60 border border-base-content/5 text-[11px]">
                                                    {s.model}
                                                </span>
                                            </td>
                                            <td className="p-3 font-mono text-xs text-base-content/70 whitespace-nowrap">
                                                {fmtDateTime(s.start)}
                                            </td>
                                            <td className="p-3 text-right font-semibold tabular-nums whitespace-nowrap">
                                                {fmtDur(s.durationMs / 60000)}
                                            </td>
                                            <td className="p-3 text-right tabular-nums text-base-content/80 whitespace-nowrap">
                                                {fmtInt(s.messages)}
                                            </td>
                                            <td className="p-3 text-right tabular-nums text-base-content/80 whitespace-nowrap">
                                                {fmtInt(s.toolCalls)}
                                            </td>
                                            <td className="p-3 text-right font-bold text-primary tabular-nums whitespace-nowrap">
                                                <div className="flex flex-col items-end gap-0.5">
                                                    <span>{fmtTok(s.billedTokens)}</span>
                                                    <div className="w-12 bg-base-300 h-1 rounded-full overflow-hidden">
                                                        <div
                                                            className="bg-primary h-full rounded-full"
                                                            style={{ width: `${billedPercent}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-3 text-right text-cyan-400 font-bold tabular-nums whitespace-nowrap">
                                                {fmtTok(s.cacheReadTokens)}
                                            </td>
                                            <td className="p-3 text-right text-base-content/70 tabular-nums whitespace-nowrap">
                                                {fmtTok(s.freshInputTokens)}
                                            </td>
                                            <td className="p-3 whitespace-nowrap">
                                                <span
                                                    className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] border font-mono ${catBadge}`}
                                                >
                                                    {s.topTool}
                                                </span>
                                            </td>
                                            <td className="p-3 text-center whitespace-nowrap">
                                                <span
                                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                                                        s.state === 'error'
                                                            ? 'bg-error/15 text-error border-error/30'
                                                            : s.state === 'running'
                                                              ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30 animate-pulse'
                                                              : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                                    }`}
                                                >
                                                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                                                    {s.state}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Enhanced Pagination Controls */}
            <div className="flex flex-wrap justify-between items-center gap-3 px-2 py-1 text-xs">
                <span className="text-base-content/70 font-mono text-[11px]">
                    Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total} sessions
                </span>
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        className="px-3 py-1.5 text-xs rounded-lg border border-base-content/20 hover:bg-base-content/10 font-medium disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer transition-colors"
                        disabled={page <= 1}
                        onClick={() => onPageChange?.(page - 1)}
                    >
                        « Previous
                    </button>
                    <span className="px-3 py-1.5 text-xs font-mono bg-base-300 rounded-lg border border-base-content/10 text-base-content font-bold">
                        {page} / {totalPages}
                    </span>
                    <button
                        type="button"
                        className="px-3 py-1.5 text-xs rounded-lg border border-base-content/20 hover:bg-base-content/10 font-medium disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer transition-colors"
                        disabled={page >= totalPages}
                        onClick={() => onPageChange?.(page + 1)}
                    >
                        Next »
                    </button>
                </div>
            </div>
        </div>
    );
};
export default SessionsTab;
