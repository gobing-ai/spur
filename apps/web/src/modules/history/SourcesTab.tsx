import type { HistorySourcesResponse, HistoryTriggerImportResponse } from '@gobing-ai/spur-contracts';
import type React from 'react';
import { useState } from 'react';
import { fmtInt, fmtTok, HeatmapGrid } from './charts';

export interface SourcesTabProps {
    data?: HistorySourcesResponse['data'];
    loading?: boolean;
    error?: string | null;
    onTriggerImport?: (mode: 'full' | 'incremental') => Promise<HistoryTriggerImportResponse['data']>;
}

export const AgentIcon: React.FC<{ id: string }> = ({ id }) => {
    const common = { width: 16, height: 16, viewBox: '0 0 24 24', role: 'img', 'aria-label': `${id} icon` } as const;
    switch (id) {
        case 'claude':
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
                    <title>Claude Code icon</title>
                    <path d="M12 2.5v19M2.5 12h19M5.3 5.3l13.4 13.4M5.3 18.7l13.4-13.4" />
                </svg>
            );
        case 'codex':
            return (
                <svg {...common} fill="currentColor">
                    <title>Codex icon</title>
                    <path d="M21.5 9.8a5.5 5.5 0 0 0-.5-4.2 5.6 5.6 0 0 0-4.6-2.8 5.6 5.6 0 0 0-4.2 1.4A5.5 5.5 0 0 0 7.8 3a5.6 5.6 0 0 0-4.5 3.3 5.5 5.5 0 0 0 .7 4.2 5.5 5.5 0 0 0-.7 4.2 5.6 5.6 0 0 0 4.5 3.3c.3.7.8 1.3 1.4 1.8a5.6 5.6 0 0 0 6.8-.4 5.5 5.5 0 0 0 4.4-1.4 5.6 5.6 0 0 0 1.4-4.2 5.5 5.5 0 0 0-.5-4.2zm-8.5 11.2a3.7 3.7 0 0 1-2.4-.9l2.7-1.6a1 1 0 0 0 .5-.9v-3.7l3.1 1.8v3.6a3.7 3.7 0 0 1-3.9 1.7zm-7.6-3.8a3.7 3.7 0 0 1-.4-2.5l2.7 1.6a1 1 0 0 0 1 0l3.2-1.8v3.6L6.8 20a3.7 3.7 0 0 1-1.4-2.8zm-1.3-8.3a3.7 3.7 0 0 1 2-1.6v3.2a1 1 0 0 0 .5.9l3.2 1.8-3.1 1.8-3.1-1.8a3.7 3.7 0 0 1 .5-4.3zm12.6 1.8l-3.2-1.8 3.1-1.8 3.1 1.8a3.7 3.7 0 0 1-.5 4.3 3.7 3.7 0 0 1-2 1.6v-3.2a1 1 0 0 0-.5-.9zm2.2 4.5l-2.7-1.6a1 1 0 0 0-1 0l-3.2 1.8V11.8l3.1-1.8 3.1 1.8a3.7 3.7 0 0 1 .7 4.4zm-7-1.3l-2.7-1.6 2.7-1.6 2.7 1.6-2.7 1.6z" />
                </svg>
            );
        case 'agy':
            return (
                <svg {...common} fill="currentColor">
                    <title>Antigravity CLI icon</title>
                    <path d="M12 1.5C12 7.3 7.3 12 1.5 12c5.8 0 10.5 4.7 10.5 10.5 0-5.8 4.7-10.5 10.5-10.5-5.8 0-10.5-4.7-10.5-10.5z" />
                </svg>
            );
        case 'omp':
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
                    <title>OMP icon</title>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M10 8.5l5 3.5-5 3.5z" />
                </svg>
            );
        case 'openclaw':
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
                    <title>OpenClaw icon</title>
                    <path d="M12 2C6.5 2 2 6.5 2 12c0 3.8 2.1 7.1 5.2 8.8L6 22l3.8-1.2C10.5 21.5 11.2 22 12 22c5.5 0 10-4.5 10-10S17.5 2 12 2zM8 11.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm5 0a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0z" />
                </svg>
            );
        case 'hermes':
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <title>Hermes icon</title>
                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
            );
        case 'grok':
            return (
                <svg {...common} fill="currentColor">
                    <title>Grok Build icon</title>
                    <path d="M18.2 3H21l-6.5 7.4L22 21h-5.8l-4.5-5.9L6.5 21H3.6l6.9-7.9L3 3h5.9l4.1 5.4L18.2 3zm-1 16.3h1.5L8.7 4.6H7.1l10.1 14.7z" />
                </svg>
            );
        case 'opencode':
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
                    <title>OpenCode icon</title>
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                </svg>
            );
        case 'pi':
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <title>Pi icon</title>
                    <path d="M4 6h16M9 6v13M15 6v11a2 2 0 0 0 2 2" />
                </svg>
            );
        default:
            return null;
    }
};

export const SourcesTab: React.FC<SourcesTabProps> = ({ data, loading, error, onTriggerImport }) => {
    const [importing, setImporting] = useState(false);
    const [importStatus, setImportStatus] = useState<string | null>(null);

    const handleImportClick = async () => {
        setImporting(true);
        setImportStatus('Running import & analytics rollup...');
        try {
            const receipt = await onTriggerImport?.('incremental');
            setImportStatus(receipt?.message ?? 'Import queued.');
        } catch (e) {
            setImportStatus(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setImporting(false);
        }
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
                <span>Failed to load sources registry: {error}</span>
            </div>
        );
    }

    if (!data) return null;

    const { overview, agents, roots } = data;

    return (
        <div className="flex flex-col gap-6">
            {/* Overview Banner & Trigger Button */}
            <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                        <span className="text-xl">🗄️</span>
                        <h3 className="font-bold text-base">Transcripts Corpus & Ingestion Registry</h3>
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs font-mono text-base-content/70 mt-1">
                        <span>
                            Files: <strong className="text-base-content">{fmtInt(overview.totalFiles)}</strong>
                        </span>
                        <span>
                            Corpus Size:{' '}
                            <strong className="text-base-content">
                                {(overview.corpusSizeBytes / (1024 * 1024)).toFixed(1)} MB
                            </strong>
                        </span>
                        <span>
                            Total Sessions:{' '}
                            <strong className="text-base-content">{fmtInt(overview.totalSessions)}</strong>
                        </span>
                        <span>
                            Coverage:{' '}
                            <strong className="text-base-content">
                                {overview.dateCoverage.from?.slice(0, 10) ?? 'N/A'} →{' '}
                                {overview.dateCoverage.to?.slice(0, 10) ?? 'N/A'}
                            </strong>
                        </span>
                    </div>
                </div>

                <div className="flex flex-col items-end gap-1.5">
                    <button
                        type="button"
                        className="px-4 py-2 rounded-lg bg-primary text-primary-content font-medium text-xs hover:bg-primary/90 transition-colors disabled:opacity-50"
                        disabled={importing}
                        onClick={handleImportClick}
                    >
                        {importing ? 'Importing...' : '🔄 Import & Analyze'}
                    </button>
                    {importStatus && <span className="text-[11px] font-mono text-info">{importStatus}</span>}
                </div>
            </div>

            {/* 9 Agent Activity Cards Grid */}
            <div>
                <h4 className="font-bold text-sm mb-3">Agent Activity (90-Day Daily Heatmaps)</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {agents.map((ag) => (
                        <div
                            key={ag.id}
                            className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 hover:border-base-content/30 transition-all p-4 flex flex-col justify-between gap-3"
                        >
                            <div className="flex justify-between items-start">
                                <div className="flex items-center gap-2.5">
                                    <div className="relative group">
                                        <button
                                            type="button"
                                            className="w-7 h-7 rounded-lg flex items-center justify-center text-white shadow-xs focus:outline-2 focus:outline-offset-2 focus:outline-primary"
                                            style={{ background: ag.color }}
                                            aria-label={`${ag.name} source metrics`}
                                            aria-describedby={`source-tooltip-${ag.id}`}
                                        >
                                            <AgentIcon id={ag.id} />
                                        </button>
                                        <div
                                            id={`source-tooltip-${ag.id}`}
                                            role="tooltip"
                                            className="pointer-events-none absolute z-20 left-0 top-9 w-64 rounded-lg border border-base-content/15 bg-base-100 p-3 text-[11px] font-mono shadow-xl opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                                        >
                                            <div className="mb-2 font-bold text-sm">{ag.name} Summary</div>
                                            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                                                <span className="text-base-content/60">Imported Files</span>
                                                <strong className="text-right">{fmtInt(ag.filesCount)}</strong>
                                                <span className="text-base-content/60">Sessions</span>
                                                <strong className="text-right">{fmtInt(ag.sessionCount)}</strong>
                                                <span className="text-base-content/60">Total Tokens</span>
                                                <strong className="text-right">{fmtTok(ag.totalTokens)}</strong>
                                                <span className="text-base-content/60">Cache Saved</span>
                                                <strong className="text-right">{fmtTok(ag.cacheSavedTokens)}</strong>
                                                <span className="text-base-content/60">Tool Calls</span>
                                                <strong className="text-right">{fmtInt(ag.toolCalls)}</strong>
                                                <span className="text-base-content/60">Date Range</span>
                                                <strong className="text-right">
                                                    {ag.firstDate?.slice(0, 10) ?? 'N/A'} →{' '}
                                                    {ag.lastDate?.slice(0, 10) ?? 'N/A'}
                                                </strong>
                                            </div>
                                        </div>
                                    </div>
                                    <div>
                                        <div className="font-bold text-sm">{ag.name}</div>
                                        <div className="text-[10px] font-mono text-base-content/60">
                                            {ag.importPath}
                                        </div>
                                    </div>
                                </div>
                                <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-base-300 border border-base-content/10 text-base-content">
                                    {fmtTok(ag.totalTokens)} tok
                                </span>
                            </div>

                            {/* Daily Heatmap */}
                            <div className="bg-base-300/60 p-2 rounded-lg border border-base-content/5">
                                <div className="text-[10px] font-mono text-base-content/50 mb-1 flex justify-between">
                                    <span>90 days ago</span>
                                    <span>Today</span>
                                </div>
                                <HeatmapGrid
                                    days={ag.heatmapDays}
                                    color={ag.color}
                                    maxDailyTokens={ag.maxDailyTokens}
                                />
                            </div>

                            {/* Telemetry Details */}
                            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-base-content/10 font-mono text-[11px]">
                                <div>
                                    <span className="text-base-content/50 block text-[10px]">Sessions</span>
                                    <span className="font-semibold">{fmtInt(ag.sessionCount)}</span>
                                </div>
                                <div>
                                    <span className="text-base-content/50 block text-[10px]">Tool Calls</span>
                                    <span className="font-semibold">{fmtInt(ag.toolCalls)}</span>
                                </div>
                                <div>
                                    <span className="text-base-content/50 block text-[10px]">Cache Saved</span>
                                    <span className="font-semibold text-emerald-400">
                                        {fmtTok(ag.cacheSavedTokens)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Source Directories & Import Roots Registry Table */}
            <div className="bg-base-200 rounded-xl shadow-sm border border-base-content/10 p-5">
                <h4 className="font-bold text-sm mb-3">Source Directories & Import Roots</h4>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left font-mono">
                        <thead>
                            <tr className="border-b border-base-content/10 text-base-content/60">
                                <th className="py-1.5">Agent</th>
                                <th className="py-1.5">Filesystem Path</th>
                                <th className="py-1.5">Match Pattern</th>
                                <th className="py-1.5 text-right">Files Count</th>
                                <th className="py-1.5 text-center">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {roots.map((r) => (
                                <tr key={r.agentId} className="border-b border-base-content/5 hover:bg-base-300/30">
                                    <td className="py-1.5 font-bold">{r.agentName}</td>
                                    <td className="py-1.5 text-base-content/80">{r.path}</td>
                                    <td className="py-1.5 text-base-content/60">{r.matchPattern}</td>
                                    <td className="py-1.5 text-right font-semibold">{fmtInt(r.fileCount)}</td>
                                    <td className="py-1.5 text-center">
                                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-400 uppercase font-bold">
                                            {r.status}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
export default SourcesTab;
