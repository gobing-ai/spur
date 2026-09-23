import type { ConfigFile, ConfigFilesResponse } from '@gobing-ai/spur-contracts';
import { useCallback, useEffect, useState } from 'react';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import YamlViewer from './YamlViewer';

const configsUrl = () => `${resolveApiUrl()}/project/configs`;

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(2)} MB`;
}

export type ConfigSubtab = 'global' | 'project';

const CONFIG_SUBTABS = [
    { id: 'global' as const, label: '🌐 Global Config', path: '~/.config/spur/config.yaml' },
    { id: 'project' as const, label: '📁 Project Config', path: '.spur/config.yaml' },
] as const;

export default function GeneralView() {
    const [activeSubtab, setActiveSubtab] = useState<ConfigSubtab>('global');
    const [configs, setConfigs] = useState<ConfigFilesResponse | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const loadConfigs = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetchWithTimeout(new Request(configsUrl()));
            if (!res.ok) {
                throw new Error(`Failed to load configuration files (${res.status})`);
            }
            const data = (await res.json()) as ConfigFilesResponse;
            setConfigs(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadConfigs();
    }, [loadConfigs]);

    const activeConfig: ConfigFile | undefined = configs?.[activeSubtab];

    return (
        <div className="flex flex-col h-full gap-4 overflow-y-auto pr-1" data-general-view>
            {/* Sub-tab Navigation and Info Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-spur-border/60 pb-3 shrink-0">
                {/* Subtab Switcher */}
                <div
                    role="tablist"
                    aria-label="Configuration file targets"
                    className="flex items-center gap-1.5 p-1 bg-spur-surface-2 border border-spur-border rounded-xl"
                    data-config-subtabs
                >
                    {CONFIG_SUBTABS.map((tab) => {
                        const isSelected = activeSubtab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                aria-selected={isSelected}
                                aria-controls={`config-subtab-panel-${tab.id}`}
                                id={`config-subtab-${tab.id}`}
                                onClick={() => setActiveSubtab(tab.id)}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-2 ${
                                    isSelected
                                        ? 'bg-spur-accent text-white shadow-sm'
                                        : 'text-spur-text-muted hover:text-spur-text hover:bg-spur-surface-3'
                                }`}
                                data-subtab={tab.id}
                            >
                                <span>{tab.label}</span>
                                <code className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/20 text-white/90">
                                    {tab.path}
                                </code>
                            </button>
                        );
                    })}
                </div>

                {/* Right Actions & Meta */}
                <div className="flex items-center gap-2.5">
                    {activeConfig && (
                        <div className="flex items-center gap-2 text-xs">
                            <span
                                className={`px-2 py-0.5 rounded-md font-medium text-[11px] flex items-center gap-1 ${
                                    activeConfig.exists
                                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                }`}
                                data-status-badge
                            >
                                <span>{activeConfig.exists ? '✓' : '⚠️'}</span>
                                <span>{activeConfig.exists ? 'Found' : 'Not Created'}</span>
                            </span>
                            {activeConfig.exists && (
                                <span className="font-mono text-spur-text-muted text-[11px]">
                                    {formatBytes(activeConfig.sizeBytes)}
                                </span>
                            )}
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={loadConfigs}
                        disabled={loading}
                        className="px-2.5 py-1 text-xs font-medium rounded-lg border border-spur-border bg-spur-surface-2 hover:bg-spur-surface-3 text-spur-text transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1"
                        title="Reload configuration files from disk"
                        data-reload-button
                    >
                        <span className={loading ? 'animate-spin' : ''}>↻</span>
                        <span>Refresh</span>
                    </button>
                </div>
            </div>

            {/* Error Banner */}
            {error && (
                <div
                    className="p-3 text-xs rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-between"
                    data-error-banner
                >
                    <span>{error}</span>
                    <button
                        type="button"
                        onClick={loadConfigs}
                        className="underline hover:text-rose-300 font-semibold cursor-pointer"
                    >
                        Retry
                    </button>
                </div>
            )}

            {/* Loading Skeleton */}
            {loading && !configs && (
                <div className="flex-1 flex items-center justify-center p-12 text-spur-text-muted text-sm gap-2">
                    <span className="w-4 h-4 border-2 border-spur-accent border-t-transparent rounded-full animate-spin" />
                    <span>Loading configuration files...</span>
                </div>
            )}

            {/* Main Content Area */}
            {activeConfig && (
                <div
                    role="tabpanel"
                    id={`config-subtab-panel-${activeSubtab}`}
                    aria-labelledby={`config-subtab-${activeSubtab}`}
                    className="flex-1 min-h-0 space-y-2"
                >
                    {/* Path Info Banner */}
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-spur-surface-2 border border-spur-border/60 text-xs">
                        <div className="flex items-center gap-2 truncate">
                            <span className="text-spur-text-muted shrink-0">Path:</span>
                            <code className="font-mono text-spur-accent truncate text-[11px]" title={activeConfig.path}>
                                {activeConfig.path}
                            </code>
                        </div>
                        {activeConfig.updatedAt && (
                            <div className="text-[11px] text-spur-text-muted shrink-0">
                                Updated: {new Date(activeConfig.updatedAt).toLocaleString()}
                            </div>
                        )}
                    </div>

                    {/* YAML Code Viewer or Missing File Alert */}
                    {activeConfig.exists ? (
                        <YamlViewer code={activeConfig.content} filePath={activeConfig.displayPath} />
                    ) : (
                        <div
                            className="p-8 text-center bg-spur-surface-2 border border-dashed border-spur-border rounded-xl space-y-3"
                            data-missing-file-card
                        >
                            <div className="text-3xl">⚠️</div>
                            <h3 className="text-sm font-semibold text-spur-text">Configuration File Not Found</h3>
                            <p className="text-xs text-spur-text-muted max-w-md mx-auto">
                                No configuration file exists at{' '}
                                <code className="font-mono text-spur-accent px-1.5 py-0.5 rounded bg-spur-surface border border-spur-border">
                                    {activeConfig.displayPath}
                                </code>
                                . You can initialize it using the Spur CLI.
                            </p>
                            <div className="pt-2">
                                <code className="px-3 py-1.5 rounded-lg bg-spur-surface border border-spur-border font-mono text-xs text-spur-accent">
                                    {activeSubtab === 'global' ? 'spur init --global' : 'spur init'}
                                </code>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
