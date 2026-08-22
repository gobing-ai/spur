import type { HistorySessionsResponse } from '@gobing-ai/spur-contracts';
import type React from 'react';
import { fmtDur, fmtInt, fmtTok } from './charts';

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
    onSelectSession?: (sessionId: string) => void;
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
                <span>Failed to load sessions: {error}</span>
            </div>
        );
    }

    if (!data) return null;

    const { items, total } = data;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const renderSortArrow = (field: string) => {
        if (sortBy !== field) return null;
        return <span className="ml-1 text-primary">{sortDir === 'asc' ? '▲' : '▼'}</span>;
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left font-mono">
                        <thead>
                            <tr className="bg-base-300/80 text-base-content/70 border-b border-base-content/10">
                                <th className="p-3">Session ID</th>
                                <th className="p-3">Agent</th>
                                <th className="p-3">Model</th>
                                <th
                                    className="p-3 cursor-pointer hover:text-primary transition-colors"
                                    onClick={() => onSortChange?.('start')}
                                >
                                    Start Time {renderSortArrow('start')}
                                </th>
                                <th
                                    className="p-3 cursor-pointer hover:text-primary transition-colors text-right"
                                    onClick={() => onSortChange?.('duration')}
                                >
                                    Duration {renderSortArrow('duration')}
                                </th>
                                <th
                                    className="p-3 cursor-pointer hover:text-primary transition-colors text-right"
                                    onClick={() => onSortChange?.('messages')}
                                >
                                    Msgs {renderSortArrow('messages')}
                                </th>
                                <th
                                    className="p-3 cursor-pointer hover:text-primary transition-colors text-right"
                                    onClick={() => onSortChange?.('toolCalls')}
                                >
                                    Tools {renderSortArrow('toolCalls')}
                                </th>
                                <th
                                    className="p-3 cursor-pointer hover:text-primary transition-colors text-right"
                                    onClick={() => onSortChange?.('billedTokens')}
                                >
                                    Billed Tok {renderSortArrow('billedTokens')}
                                </th>
                                <th
                                    className="p-3 cursor-pointer hover:text-primary transition-colors text-right"
                                    onClick={() => onSortChange?.('cacheRead')}
                                >
                                    Cache Read {renderSortArrow('cacheRead')}
                                </th>
                                <th
                                    className="p-3 cursor-pointer hover:text-primary transition-colors text-right"
                                    onClick={() => onSortChange?.('freshInput')}
                                >
                                    Fresh Input {renderSortArrow('freshInput')}
                                </th>
                                <th className="p-3">Top Tool</th>
                                <th className="p-3 text-center">State</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.length === 0 ? (
                                <tr>
                                    <td colSpan={12} className="text-center py-8 text-base-content/50">
                                        No sessions matching the current filter.
                                    </td>
                                </tr>
                            ) : (
                                items.map((s) => (
                                    <tr
                                        key={s.id}
                                        className="border-b border-base-content/5 hover:bg-primary/10 cursor-pointer transition-colors"
                                        onClick={() => onSelectSession?.(s.id)}
                                        title="Click to view execution timeline"
                                    >
                                        <td className="p-3 font-bold text-primary">
                                            <span className="font-mono text-xs" title={s.id}>
                                                {s.id.length > 18 ? `${s.id.slice(0, 16)}…` : s.id}
                                            </span>
                                        </td>
                                        <td className="p-3">
                                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-base-300 uppercase font-mono text-base-content">
                                                {s.source}
                                            </span>
                                        </td>
                                        <td className="p-3 text-base-content/70">{s.model}</td>
                                        <td className="p-3">{s.start.slice(0, 19).replace('T', ' ')}</td>
                                        <td className="p-3 text-right font-semibold tabular-nums">
                                            {fmtDur(s.durationMs / 60000)}
                                        </td>
                                        <td className="p-3 text-right tabular-nums">{fmtInt(s.messages)}</td>
                                        <td className="p-3 text-right tabular-nums">{fmtInt(s.toolCalls)}</td>
                                        <td className="p-3 text-right font-bold text-primary tabular-nums">
                                            {fmtTok(s.billedTokens)}
                                        </td>
                                        <td className="p-3 text-right text-emerald-400 tabular-nums">
                                            {fmtTok(s.cacheReadTokens)}
                                        </td>
                                        <td className="p-3 text-right text-base-content/70 tabular-nums">
                                            {fmtTok(s.freshInputTokens)}
                                        </td>
                                        <td className="p-3">
                                            <span className="px-1.5 py-0.5 rounded text-[10px] border border-base-content/20 font-mono">
                                                {s.topTool}
                                            </span>
                                        </td>
                                        <td className="p-3 text-center">
                                            <span
                                                className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                                                    s.state === 'error'
                                                        ? 'bg-error/20 text-error font-bold'
                                                        : 'bg-emerald-500/20 text-emerald-400 font-bold'
                                                }`}
                                            >
                                                {s.state}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Pagination Controls */}
            <div className="flex flex-wrap justify-between items-center gap-3 px-1 text-xs">
                <span className="text-base-content/70">
                    Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total} sessions
                </span>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        className="px-2.5 py-1 text-xs rounded border border-base-content/20 hover:bg-base-content/10 font-medium disabled:opacity-40"
                        disabled={page <= 1}
                        onClick={() => onPageChange?.(page - 1)}
                    >
                        « Prev
                    </button>
                    <span className="px-2.5 py-1 text-xs font-mono text-base-content/70">
                        Page {page} / {totalPages}
                    </span>
                    <button
                        type="button"
                        className="px-2.5 py-1 text-xs rounded border border-base-content/20 hover:bg-base-content/10 font-medium disabled:opacity-40"
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
