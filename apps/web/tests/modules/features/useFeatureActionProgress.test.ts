import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useFeatureActionProgress } from '../../../src/modules/features/useFeatureActionProgress';
import { registerHappyDom } from '../../happy-dom';

class FakeEventSource {
    static instances: FakeEventSource[] = [];
    onmessage: ((event: MessageEvent) => void) | null = null;
    closed = false;

    constructor(readonly url: string) {
        FakeEventSource.instances.push(this);
    }

    close(): void {
        this.closed = true;
    }
}

let originalEventSource: typeof EventSource | undefined;

beforeAll(() => {
    registerHappyDom();
    originalEventSource = globalThis.EventSource;
});

afterEach(() => {
    cleanup();
    FakeEventSource.instances = [];
    if (originalEventSource) {
        globalThis.EventSource = originalEventSource;
    }
});

describe('useFeatureActionProgress hook', () => {
    test('tracks action progress and handles SSE updates and clearProgress', () => {
        globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;

        const { result, rerender } = renderHook(({ id }) => useFeatureActionProgress(id), {
            initialProps: { id: 'F1' },
        });

        expect(result.current.progress.status).toBe('idle');

        // Track action
        act(() => {
            result.current.trackAction('job-sse-1', 'brainstorm');
        });

        expect(result.current.progress).toEqual({
            status: 'queued',
            runId: 'job-sse-1',
            action: 'brainstorm',
        });

        // EventSource created
        expect(FakeEventSource.instances.length).toBe(1);
        const es = FakeEventSource.instances[0];
        expect(es).toBeDefined();
        if (!es) return;

        // Simulate SSE event frame
        act(() => {
            es.onmessage?.({
                data: JSON.stringify({
                    eventName: 'queue.job.running',
                    payload: { jobId: 'job-sse-1' },
                }),
            } as MessageEvent);
        });

        expect(result.current.progress.status).toBe('running');

        // Test malformed JSON frame (ignored without error)
        act(() => {
            es.onmessage?.({
                data: 'invalid json',
            } as MessageEvent);
        });

        // Test clearProgress
        act(() => {
            result.current.clearProgress();
        });
        expect(result.current.progress.status).toBe('idle');

        // Test featureId change resets progress
        act(() => {
            result.current.trackAction('job-sse-2', 'plan');
        });
        expect(result.current.progress.runId).toBe('job-sse-2');

        rerender({ id: 'F2' });
        expect(result.current.progress.status).toBe('idle');
    });
});
