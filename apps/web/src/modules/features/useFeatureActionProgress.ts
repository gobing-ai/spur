import { useCallback, useEffect, useState } from 'react';
import { resolveApiUrl } from '../../lib/rpc-client';
import {
    type FeatureActionProgressState,
    INITIAL_PROGRESS_STATE,
    isFeaturesSseEvent,
    reduceFeatureActionProgress,
} from './sse-helpers';

const getSseUrl = () => `${resolveApiUrl()}/events/planning`;

/**
 * Hook that tracks feature action job progress via board SSE events.
 *
 * Correlates `queue.job.*` events by `runId` and updates status cleanly.
 * Tears down EventSource subscription on unmount (R4).
 */
export function useFeatureActionProgress(featureId: string) {
    const [progress, setProgress] = useState<FeatureActionProgressState>(INITIAL_PROGRESS_STATE);

    // Reset progress when switching features
    useEffect(() => {
        if (featureId) {
            setProgress(INITIAL_PROGRESS_STATE);
        }
    }, [featureId]);

    const trackAction = useCallback((runId: string, action: string) => {
        setProgress({ status: 'queued', runId, action });
    }, []);

    const clearProgress = useCallback(() => {
        setProgress(INITIAL_PROGRESS_STATE);
    }, []);

    useEffect(() => {
        if (typeof EventSource === 'undefined' || !progress.runId) return;

        const es = new EventSource(getSseUrl());
        es.onmessage = (frame) => {
            try {
                const raw = JSON.parse(frame.data) as { eventName?: string; payload?: unknown };
                const name = raw.eventName;
                if (!isFeaturesSseEvent(name) || !name) return;
                setProgress((prev) => reduceFeatureActionProgress(prev, name, raw.payload));
            } catch {
                // Ignore SSE JSON parse errors
            }
        };

        return () => {
            es.close();
        };
    }, [progress.runId]);

    return {
        progress,
        trackAction,
        clearProgress,
    };
}
