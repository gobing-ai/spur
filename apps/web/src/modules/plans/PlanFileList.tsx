import { useMemo, useState } from 'react';
import type { PlanFileSummary } from '../../lib/plan-client';

interface PlanFileListProps {
    files: PlanFileSummary[];
    selectedPath: string | null;
    onSelect: (path: string) => void;
}

export default function PlanFileList({ files, selectedPath, onSelect }: PlanFileListProps) {
    const [searchQuery, setSearchQuery] = useState('');

    const filteredFiles = useMemo(() => {
        if (!searchQuery.trim()) return files;
        const query = searchQuery.toLowerCase();
        return files.filter(
            (f) =>
                f.name.toLowerCase().includes(query) ||
                f.title.toLowerCase().includes(query) ||
                f.path.toLowerCase().includes(query),
        );
    }, [files, searchQuery]);

    const roadmapFiles = useMemo(() => filteredFiles.filter((f) => f.category === 'roadmap'), [filteredFiles]);

    const planFiles = useMemo(() => filteredFiles.filter((f) => f.category === 'plan'), [filteredFiles]);

    return (
        <div className="flex flex-col h-full overflow-hidden" data-testid="plan-file-list">
            {/* Search Filter Header */}
            <div className="p-2 border-b border-spur-border bg-base-100/50 shrink-0">
                <div className="relative">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Filter plans..."
                        className="w-full text-xs px-2.5 py-1.5 pl-7 rounded border border-spur-border bg-base-100 text-spur-text placeholder:text-spur-text-muted/60 focus:outline-none focus:border-spur-accent"
                        aria-label="Filter plan documents"
                    />
                    <span className="absolute left-2 top-1.5 text-xs text-spur-text-muted pointer-events-none">🔍</span>
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => setSearchQuery('')}
                            className="absolute right-2 top-1 text-xs text-spur-text-muted hover:text-spur-text p-0.5"
                            aria-label="Clear filter"
                        >
                            ✕
                        </button>
                    )}
                </div>
            </div>

            {/* List Body */}
            <div className="flex-1 overflow-y-auto p-2 space-y-3">
                {filteredFiles.length === 0 ? (
                    <div className="p-4 text-xs text-spur-text-muted italic text-center">
                        {searchQuery ? `No documents match "${searchQuery}"` : 'No plan documents found.'}
                    </div>
                ) : (
                    <>
                        {/* Roadmap Group */}
                        {roadmapFiles.length > 0 && (
                            <div>
                                <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-spur-text-muted flex items-center justify-between">
                                    <span>Core Roadmap</span>
                                    <span className="text-[10px] font-mono">{roadmapFiles.length}</span>
                                </div>
                                <div className="space-y-0.5 mt-1">
                                    {roadmapFiles.map((file) => {
                                        const isSelected = selectedPath === file.path;
                                        return (
                                            <button
                                                key={file.id}
                                                type="button"
                                                onClick={() => onSelect(file.path)}
                                                title={file.name}
                                                className={`w-full text-left px-2.5 py-1.5 rounded-md transition-colors flex items-center gap-2 cursor-pointer ${
                                                    isSelected
                                                        ? 'bg-spur-accent/15 text-spur-accent font-semibold shadow-xs'
                                                        : 'hover:bg-base-300 text-spur-text hover:text-spur-text'
                                                }`}
                                            >
                                                <span className="text-sm shrink-0">🗺️</span>
                                                <span
                                                    className="flex-1 min-w-0 text-xs truncate font-medium"
                                                    title={file.name}
                                                >
                                                    {file.title}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Execution Plans Group */}
                        {planFiles.length > 0 && (
                            <div>
                                <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-spur-text-muted flex items-center justify-between">
                                    <span>Execution Plans</span>
                                    <span className="text-[10px] font-mono">{planFiles.length}</span>
                                </div>
                                <div className="space-y-0.5 mt-1">
                                    {planFiles.map((file) => {
                                        const isSelected = selectedPath === file.path;
                                        return (
                                            <button
                                                key={file.id}
                                                type="button"
                                                onClick={() => onSelect(file.path)}
                                                title={file.name}
                                                className={`w-full text-left px-2.5 py-1.5 rounded-md transition-colors flex items-center gap-2 cursor-pointer ${
                                                    isSelected
                                                        ? 'bg-spur-accent/15 text-spur-accent font-semibold shadow-xs'
                                                        : 'hover:bg-base-300 text-spur-text hover:text-spur-text'
                                                }`}
                                            >
                                                <span className="text-xs shrink-0 text-spur-text-muted">📄</span>
                                                <span className="flex-1 min-w-0 text-xs truncate" title={file.name}>
                                                    {file.title}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
