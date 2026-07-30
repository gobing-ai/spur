import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import ApiErrorToast from '../../../src/components/ApiErrorToast';
import FloatingActionProgress from '../../../src/modules/features/FloatingActionProgress';
import type { FeatureActionProgressState } from '../../../src/modules/features/sse-helpers';
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

describe('FloatingActionProgress component', () => {
    test('renders null when status is idle or runId is missing', () => {
        const { container } = render(
            <FloatingActionProgress
                progress={{ status: 'idle' }}
                isDismissed={false}
                onDismiss={() => {}}
                onReopen={() => {}}
            />,
        );
        expect(container.firstChild).toBeNull();
    });

    test('renders open floating progress panel with action name and status badge', () => {
        const progress: FeatureActionProgressState = {
            status: 'running',
            runId: 'job-123',
            action: 'brainstorm',
        };
        const { getByText, getByLabelText } = render(
            <FloatingActionProgress progress={progress} isDismissed={false} onDismiss={() => {}} onReopen={() => {}} />,
        );

        expect(getByText('Brainstorm')).toBeDefined();
        expect(getByText('running')).toBeDefined();
        expect(getByText('ID: job-123')).toBeDefined();
        expect(getByLabelText('Dismiss progress panel')).toBeDefined();
    });

    test('clicking close/dismiss button calls onDismiss callback', () => {
        let dismissed = false;
        const progress: FeatureActionProgressState = {
            status: 'queued',
            runId: 'job-456',
            action: 'plan',
        };
        const { getByLabelText } = render(
            <FloatingActionProgress
                progress={progress}
                isDismissed={false}
                onDismiss={() => {
                    dismissed = true;
                }}
                onReopen={() => {}}
            />,
        );

        fireEvent.click(getByLabelText('Dismiss progress panel'));
        expect(dismissed).toBe(true);
    });

    test('renders compact chip when layer is dismissed and job is non-terminal (R2)', () => {
        let reopened = false;
        const progress: FeatureActionProgressState = {
            status: 'running',
            runId: 'job-789',
            action: 'brainstorm',
        };
        const { getByText } = render(
            <FloatingActionProgress
                progress={progress}
                isDismissed={true}
                onDismiss={() => {}}
                onReopen={() => {
                    reopened = true;
                }}
            />,
        );

        const chipButton = getByText(/Brainstorm \(running\)/i);
        expect(chipButton).toBeDefined();

        fireEvent.click(chipButton);
        expect(reopened).toBe(true);
    });

    test('dispatches api-error event on terminal failure when layer is dismissed (R5)', () => {
        let capturedMessage = '';
        const handleApiError = (e: Event) => {
            capturedMessage = (e as CustomEvent<{ message?: string }>).detail?.message || '';
        };
        window.addEventListener('api-error', handleApiError);

        const progress: FeatureActionProgressState = {
            status: 'failed',
            runId: 'job-err-1',
            action: 'plan',
            error: 'Agent execution failed with exit code 1',
        };

        render(
            <FloatingActionProgress progress={progress} isDismissed={true} onDismiss={() => {}} onReopen={() => {}} />,
        );

        expect(capturedMessage).toBe('Agent execution failed with exit code 1');
        window.removeEventListener('api-error', handleApiError);
    });
});

describe('ApiErrorToast component', () => {
    test('listens for api-error event and renders transient error toast (R4)', () => {
        const { getByText, queryByText } = render(<ApiErrorToast />);

        expect(queryByText('Global action error')).toBeNull();

        act(() => {
            window.dispatchEvent(
                new CustomEvent('api-error', {
                    detail: { message: 'Global action error' },
                }),
            );
        });

        expect(getByText('Global action error')).toBeDefined();
    });
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
