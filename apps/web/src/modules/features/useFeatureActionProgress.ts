import { useCallback, useEffect, useState } from 'react';
import { subscribePlanningEvents } from '../../lib/planning-events';
import {
    type FeatureActionProgressState,
    INITIAL_PROGRESS_STATE,
    isFeaturesSseEvent,
    reduceFeatureActionProgress,
} from './sse-helpers';

/**
 * Hook that tracks feature action job progress via board SSE events.
 *
 * Correlates `queue.job.*` events by `runId` and updates status cleanly.
 * Releases its shared planning subscription on unmount (R4).
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
        if (!progress.runId) return;
        return subscribePlanningEvents(({ eventName, payload }) => {
            if (!isFeaturesSseEvent(eventName)) return;
            setProgress((prev) => reduceFeatureActionProgress(prev, eventName, payload));
        });
    }, [progress.runId]);

    return {
        progress,
        trackAction,
        clearProgress,
    };
}
