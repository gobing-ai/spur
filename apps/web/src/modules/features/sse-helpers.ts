/**
 * SSE helpers and progress state machine for feature actions (Task 0387).
 *
 * Filters board SSE events and correlates incoming queue.job.* frames
 * with a feature action's tracked runId.
 */

/** Filter predicate for SSE event names that the features module listens to. */
export function isFeaturesSseEvent(eventName: string | null | undefined): boolean {
    if (!eventName) return false;
    return eventName.startsWith('feature.') || eventName.startsWith('queue.job.');
}

/** Extract jobId or runId from an incoming SSE event payload. */
export function extractJobId(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Record<string, unknown>;
    if (typeof p.jobId === 'string' && p.jobId.length > 0) return p.jobId;
    if (typeof p.runId === 'string' && p.runId.length > 0) return p.runId;
    if (p.job && typeof p.job === 'object') {
        const j = p.job as Record<string, unknown>;
        if (typeof j.id === 'string' && j.id.length > 0) return j.id;
        if (typeof j.jobId === 'string' && j.jobId.length > 0) return j.jobId;
    }
    return null;
}

/** Match an incoming event payload against a tracked runId. */
export function matchJobId(payload: unknown, trackedRunId: string | null | undefined): boolean {
    if (!trackedRunId) return false;
    const eventJobId = extractJobId(payload);
    return eventJobId === trackedRunId;
}

/** Action job progress status enum. */
export type ProgressStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed';

/** State shape representing active feature action progress. */
export interface FeatureActionProgressState {
    status: ProgressStatus;
    runId?: string;
    action?: string;
    error?: string;
}

/** Initial idle progress state object. */
export const INITIAL_PROGRESS_STATE: FeatureActionProgressState = {
    status: 'idle',
};

/**
 * Pure state reducer for feature action job progress driven by SSE events.
 *
 * Unmatched jobId events never mutate the tracked progress state (R3 / R7).
 */
export function reduceFeatureActionProgress(
    state: FeatureActionProgressState,
    eventName: string,
    payload: unknown,
): FeatureActionProgressState {
    if (state.status === 'idle' || !state.runId) return state;

    // Reject unmatched job events — prevents cross-feature or stale job corruption (R7)
    if (!matchJobId(payload, state.runId)) {
        return state;
    }

    switch (eventName) {
        case 'queue.job.enqueued':
        case 'queue.job.created':
            return { ...state, status: 'queued' };
        case 'queue.job.started':
        case 'queue.job.running':
            return { ...state, status: 'running' };
        case 'queue.job.completed':
            return { ...state, status: 'succeeded' };
        case 'queue.job.failed': {
            const errStr =
                payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).error === 'string'
                    ? ((payload as Record<string, unknown>).error as string)
                    : 'Job failed';
            return { ...state, status: 'failed', error: errStr };
        }
        default:
            return state;
    }
}
