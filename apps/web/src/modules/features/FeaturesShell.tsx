import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/ui';
import { loadFeatures } from '../../lib/feature-client';
import type { FeatureSummary } from '../../lib/feature-types';
import { resolveApiUrl } from '../../lib/rpc-client';
import FeatureDetail from './FeatureDetail';
import FeatureTree, { groupFeaturesByParent } from './FeatureTree';
import FloatingAgentBar from './FloatingAgentBar';
import NewFeaturePanel from './NewFeaturePanel';
import { isFeaturesSseEvent } from './sse-helpers';
import { FEATURE_STATUSES, FeatureStatusIcon } from './status-icons';

const sseUrl = () => `${resolveApiUrl()}/events/planning`;

function FilterIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
    return (
        <svg
            className={`inline-block shrink-0 ${className}`}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <polygon points="1.5 2.5 14.5 2.5 9.5 8.5 9.5 13.5 6.5 13.5 6.5 8.5 1.5 2.5" />
        </svg>
    );
}

/**
 * Shell for the features board module (task 0194 / 0326).
 *
 * Full-width detail panel when a feature is selected (FeatureDetail), with the
 * ID-derived tree (status badges + filter menu, FeatureTree) as a floating
 * overlay in the work area below the module header — anchored to the left margin
 * with its right edge clear of the body (no overlap), so the body keeps the full
 * header width. SSE subscription to `feature.*` events keeps the tree + selected
 * detail live without refresh.
 */
export default function FeaturesShell() {
    const [features, setFeatures] = useState<FeatureSummary[] | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [showNewRootPanel, setShowNewRootPanel] = useState(false);
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [isTreeOpen, setIsTreeOpen] = useState(true);
    const [showFilterMenu, setShowFilterMenu] = useState(false);
    const [error, setError] = useState<string | null>(null);
    /** Bumped to make the detail panel re-fetch the already-selected feature. */
    const [detailRefreshKey, setDetailRefreshKey] = useState(0);
    const filterMenuRef = useRef<HTMLDivElement | null>(null);

    /**
     * ID-prefix children of every feature, derived once from the UNFILTERED list so
     * the detail panel can navigate to real children even when the tree's status
     * filter hides them (task 0525 R5).
     */
    const childrenByParent = useMemo(() => groupFeaturesByParent(features ?? []), [features]);

    const load = useCallback(async (signal?: AbortSignal) => {
        try {
            const data = await loadFeatures(signal);
            setFeatures(data);
            setError(null);
        } catch (err) {
            if (signal?.aborted) return;
            setError(err instanceof Error ? err.message : String(err));
        }
    }, []);

    // Initial load.
    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    // Dismiss the status-filter menu on outside click or Escape.
    useEffect(() => {
        if (!showFilterMenu) return;
        const onMouseDown = (event: MouseEvent) => {
            if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
                setShowFilterMenu(false);
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setShowFilterMenu(false);
        };
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [showFilterMenu]);

    // Live tail: SSE-driven refetch on feature.* and queue.job.* events.
    useEffect(() => {
        if (typeof EventSource === 'undefined') return;
        const es = new EventSource(sseUrl());
        es.onmessage = (frame) => {
            try {
                const raw: unknown = JSON.parse(frame.data);
                const name = (raw as { eventName?: string }).eventName;
                if (!isFeaturesSseEvent(name)) return;
                void load();
                // Also refresh the detail if a feature is selected and its data may have
                // changed. `featureId` is unchanged in that case, so the panel needs an
                // explicit nudge — fetching here instead would just discard the result.
                // FeaturesShell keeps these three planning-event refresh paths intact (F841 R6)
                if (
                    selectedId &&
                    (name === 'feature.updated' || name === 'feature.transitioned' || name === 'queue.job.completed')
                ) {
                    setDetailRefreshKey((n) => n + 1);
                }
            } catch {
                // Malformed frame — drop silently.
            }
        };
        return () => es.close();
    }, [load, selectedId]);

    if (error) {
        return (
            <div className="p-4 text-sm text-error" role="alert">
                Failed to load features: {error}
            </div>
        );
    }

    if (features === null) {
        return (
            <div className="flex items-center justify-center h-full text-spur-text-muted text-sm">
                Loading features…
            </div>
        );
    }

    const handleRootFeatureCreated = () => {
        setShowNewRootPanel(false);
        // Reload the feature list
        void load();
    };

    const getFilteredFeatures = (allFeatures: FeatureSummary[]) => {
        if (statusFilter === 'all') return allFeatures;
        const normFilter = statusFilter.toLowerCase();
        const matchingIds = new Set<string>();

        for (const f of allFeatures) {
            if (f.status.toLowerCase() === normFilter) {
                matchingIds.add(f.id);
                let currentId = f.id;
                while (currentId.length > 1) {
                    currentId = currentId.slice(0, -1);
                    matchingIds.add(currentId);
                }
            }
        }

        return allFeatures.filter((f) => matchingIds.has(f.id));
    };

    const filteredFeatures = getFilteredFeatures(features);
    const selectedChildren = selectedId ? (childrenByParent.get(selectedId) ?? []) : [];

    return (
        <>
            <div className="relative h-full w-full p-4 overflow-hidden" data-features-shell>
                {/* Central Container — contains the module header AND the full-width body, sharing the exact same max-w-[1600px] width constraint as History so the body matches the header width. The tree is a floating overlay docked at the body's left side; it consumes no layout width, so toggling it never resizes the body. */}
                <div className="flex flex-col h-full w-full max-w-[1600px] mx-auto gap-3" data-features-workspace>
                    {/* Module header — R1/R2 */}
                    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-spur-border pb-3 shrink-0">
                        <div className="flex items-center gap-3">
                            <span className="text-2xl" aria-hidden="true">
                                🎯
                            </span>
                            <div>
                                <h1 className="text-xl font-bold tracking-tight text-spur-text">Features</h1>
                                <p className="text-xs text-spur-text-muted">
                                    Hierarchical feature roadmap, acceptance criteria, and lifecycle progression
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-1" data-features-actions>
                            <Button
                                variant="ghost"
                                size="xs"
                                className="text-spur-text-muted hover:text-spur-accent"
                                onClick={() => setIsTreeOpen((prev) => !prev)}
                                aria-label={isTreeOpen ? 'Collapse feature tree' : 'Expand feature tree'}
                                aria-expanded={isTreeOpen}
                                aria-controls="feature-tree-dock"
                                title={isTreeOpen ? 'Collapse feature tree' : 'Expand feature tree'}
                            >
                                {isTreeOpen ? '◧' : '▶'}
                            </Button>
                            <div className="relative" ref={filterMenuRef}>
                                <Button
                                    variant="ghost"
                                    size="xs"
                                    className={`relative text-spur-text-muted hover:text-spur-accent flex items-center gap-1 ${
                                        statusFilter !== 'all' ? 'text-spur-accent font-semibold' : ''
                                    }`}
                                    onClick={() => setShowFilterMenu((prev) => !prev)}
                                    aria-label="Filter features by status"
                                    aria-expanded={showFilterMenu}
                                    title="Filter features by status"
                                >
                                    <FilterIcon className="w-3.5 h-3.5" />
                                    {statusFilter !== 'all' && (
                                        <span
                                            className="w-1.5 h-1.5 rounded-full bg-spur-accent shrink-0"
                                            aria-hidden="true"
                                        />
                                    )}
                                </Button>
                                {showFilterMenu && (
                                    <div
                                        className="absolute right-0 top-full mt-1 z-20 w-44 rounded-md shadow-lg bg-base-100 border border-spur-border py-1 text-xs"
                                        data-filter-menu
                                    >
                                        <div className="px-2.5 py-1 font-semibold text-spur-text-muted border-b border-spur-border flex items-center justify-between">
                                            <span>Filter by Status</span>
                                            {statusFilter !== 'all' && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setStatusFilter('all');
                                                        setShowFilterMenu(false);
                                                    }}
                                                    className="text-[10px] text-spur-accent hover:underline"
                                                >
                                                    Reset
                                                </button>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setStatusFilter('all');
                                                setShowFilterMenu(false);
                                            }}
                                            className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-base-200 ${
                                                statusFilter === 'all'
                                                    ? 'font-semibold text-spur-accent bg-spur-accent/10'
                                                    : 'text-spur-text'
                                            }`}
                                        >
                                            <span className="flex-1">All</span>
                                            {statusFilter === 'all' && <span>✓</span>}
                                        </button>
                                        {FEATURE_STATUSES.map((st) => (
                                            <button
                                                key={st}
                                                type="button"
                                                onClick={() => {
                                                    setStatusFilter(st);
                                                    setShowFilterMenu(false);
                                                }}
                                                className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-base-200 capitalize ${
                                                    statusFilter === st
                                                        ? 'font-semibold text-spur-accent bg-spur-accent/10'
                                                        : 'text-spur-text'
                                                }`}
                                            >
                                                <FeatureStatusIcon status={st} />
                                                <span className="flex-1 capitalize">{st}</span>
                                                {statusFilter === st && <span>✓</span>}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <Button
                                variant="ghost"
                                size="xs"
                                className="text-spur-text-muted hover:text-spur-accent"
                                onClick={() => setShowNewRootPanel(true)}
                                aria-label="Add root feature"
                                title="Add root feature"
                            >
                                +
                            </Button>
                        </div>
                    </header>

                    {/* Body area — relative so the floating tree aligns to the body panel (below the header). The body keeps the full header width. The tree floats in the left margin, its right edge clear of the body (no overlap). */}
                    <div className="relative flex-1 min-h-0">
                        <div
                            id="feature-tree-dock"
                            hidden={!isTreeOpen}
                            className="absolute right-[calc(100%_+_12px)] top-0 bottom-0 z-20 w-72 lg:w-80 flex flex-col overflow-hidden rounded-lg border border-spur-border bg-base-200 shadow-xl"
                        >
                            <div className="flex items-center justify-between px-3 py-2 border-b border-spur-border bg-base-300/60 shrink-0">
                                <span className="text-xs font-semibold text-spur-text flex items-center gap-1.5">
                                    <span>🌳</span> Feature Tree
                                </span>
                            </div>
                            <div className="flex-1 overflow-y-auto p-1">
                                {features.length === 0 ? (
                                    <div className="p-3 text-xs text-spur-text-muted italic">No features found.</div>
                                ) : filteredFeatures.length === 0 ? (
                                    <div className="p-3 text-xs text-spur-text-muted italic">
                                        No features match status filter "{statusFilter}".
                                    </div>
                                ) : (
                                    <FeatureTree
                                        features={filteredFeatures}
                                        selectedId={selectedId}
                                        onSelect={setSelectedId}
                                    />
                                )}
                            </div>
                        </div>
                        <div
                            className="w-full h-full overflow-hidden rounded-lg border border-spur-border bg-base-100 relative"
                            data-testid="detail-workspace"
                        >
                            <div className="w-full h-full overflow-y-auto">
                                {selectedId ? (
                                    <FeatureDetail
                                        featureId={selectedId}
                                        refreshKey={detailRefreshKey}
                                        onClose={() => setSelectedId(null)}
                                        childFeatures={selectedChildren}
                                        onSelectFeature={setSelectedId}
                                    />
                                ) : (
                                    <div className="flex items-center justify-center h-full text-sm text-spur-text-muted italic">
                                        Select a feature to view details
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <NewFeaturePanel
                open={showNewRootPanel}
                parentId=""
                onClose={() => setShowNewRootPanel(false)}
                onCreated={handleRootFeatureCreated}
            />
            <FloatingAgentBar />
        </>
    );
}
