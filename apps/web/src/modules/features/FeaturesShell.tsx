import { useCallback, useEffect, useState } from 'react';
import { loadFeatureShow, loadFeatures } from '../../lib/feature-client';
import type { FeatureSummary } from '../../lib/feature-types';
import { resolveApiUrl } from '../../lib/rpc-client';
import FeatureDetail from './FeatureDetail';
import FeatureTree from './FeatureTree';

const SSE_URL = `${resolveApiUrl()}/events/planning`;

/**
 * Shell for the features board module (task 0194).
 *
 * Left column: ID-derived tree with status badges (FeatureTree). Right column:
 * detail panel when a feature is selected (FeatureDetail). SSE subscription to
 * `feature.*` events keeps the tree + selected detail live without refresh.
 */
export default function FeaturesShell() {
    const [features, setFeatures] = useState<FeatureSummary[] | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (signal: AbortSignal) => {
        try {
            const data = await loadFeatures(signal);
            setFeatures(data);
            setError(null);
        } catch (err) {
            if (signal.aborted) return;
            setError(err instanceof Error ? err.message : String(err));
        }
    }, []);

    // Initial load.
    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    // Live tail: SSE-driven refetch on feature.* events.
    useEffect(() => {
        if (typeof EventSource === 'undefined') return;
        const es = new EventSource(SSE_URL);
        es.onmessage = (frame) => {
            try {
                const raw: unknown = JSON.parse(frame.data);
                const name = (raw as { eventName?: string }).eventName;
                if (!name?.startsWith('feature.')) return;
                void load(new AbortController().signal);
                // Also refresh the detail if a feature is selected and its data may have changed.
                if (selectedId && (name === 'feature.updated' || name === 'feature.transitioned')) {
                    loadFeatureShow(selectedId, new AbortController().signal).catch(() => {});
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

    return (
        <div className="flex h-full overflow-hidden" data-features-shell>
            {/* Left: tree */}
            <div className="w-72 shrink-0 border-r border-spur-border overflow-y-auto bg-base-200">
                <div className="px-3 py-2 border-b border-spur-border">
                    <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">Features</span>
                </div>
                {features.length === 0 ? (
                    <div className="p-3 text-xs text-spur-text-muted italic">No features found.</div>
                ) : (
                    <FeatureTree features={features} selectedId={selectedId} onSelect={setSelectedId} />
                )}
            </div>

            {/* Right: detail panel */}
            <div className="flex-1 overflow-y-auto">
                {selectedId ? (
                    <FeatureDetail featureId={selectedId} />
                ) : (
                    <div className="flex items-center justify-center h-full text-sm text-spur-text-muted italic">
                        Select a feature to view details
                    </div>
                )}
            </div>
        </div>
    );
}
