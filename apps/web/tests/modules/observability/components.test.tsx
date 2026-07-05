import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';

import InboxTab from '../../../src/modules/observability/InboxTab';
import ObservabilityShell from '../../../src/modules/observability/ObservabilityShell';
import SystemEventsTab from '../../../src/modules/observability/SystemEventsTab';
import { teardownHappyDom } from '../../happy-dom';

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

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

let originalFetch: typeof fetch;
let originalEventSource: typeof EventSource | undefined;

beforeAll(() => {
    GlobalRegistrator.register();
    originalFetch = globalThis.fetch;
    originalEventSource = globalThis.EventSource;
});

beforeEach(() => {
    FakeEventSource.instances = [];
    Object.defineProperty(globalThis, 'EventSource', {
        configurable: true,
        value: FakeEventSource,
    });
});

afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'EventSource', {
        configurable: true,
        value: originalEventSource,
    });
});

afterAll(async () => {
    await teardownHappyDom();
});

function installObservabilityFetchMock(): string[] {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('/events/history')) {
            return jsonResponse({
                events: [
                    {
                        id: 'event-job-1',
                        eventName: 'queue.job.completed',
                        occurredAt: '2026-07-04T20:04:00.000Z',
                        actor: null,
                        payload: { jobId: 'job-1', type: 'smoke' },
                    },
                    {
                        id: 'event-1',
                        eventName: 'task.created',
                        occurredAt: '2026-07-04T20:00:00.000Z',
                        actor: 'operator',
                        payload: { wbs: '0199' },
                    },
                ],
                count: 2,
            });
        }
        if (url.includes('/jobs/stats')) {
            return jsonResponse({
                stats: { pending: 2, processing: 1, completed: 3, failed: 0 },
            });
        }
        if (url.includes('/messages/inbox')) {
            return jsonResponse({
                messages: [
                    {
                        id: 'msg-1',
                        fromId: 'operator',
                        toId: 'worker',
                        body: 'Please review the observability board.',
                        status: 'sent',
                        createdAt: '2026-07-04T20:01:00.000Z',
                        inReplyTo: null,
                    },
                    {
                        id: 'msg-2',
                        fromId: 'worker',
                        toId: 'operator',
                        body: 'Review complete.',
                        status: 'sent',
                        createdAt: '2026-07-04T20:02:00.000Z',
                        inReplyTo: 'msg-1',
                    },
                ],
                count: 2,
            });
        }
        return new Response('not found', { status: 404 });
    }) as typeof fetch;
    return calls;
}

describe('observability components', () => {
    test('shell renders tab data and switches from system events to inbox messages', async () => {
        const calls = installObservabilityFetchMock();
        const { getByRole, getByText, container } = render(<ObservabilityShell />);

        await waitFor(() => expect(getByText('task.created')).toBeDefined());
        expect(calls.some((url) => url.includes('/events/history?limit=100'))).toBe(true);

        fireEvent.click(getByRole('tab', { name: 'Inbox Messages' }));

        await waitFor(() => expect(getByText('Please review the observability board.')).toBeDefined());
        expect(getByText('Review complete.')).toBeDefined();
        expect(container.querySelector('[data-inbox-tab]')?.textContent).toContain('reply to msg-1');
        expect(calls.some((url) => url.includes('/messages/inbox?agent=operator&limit=50'))).toBe(true);

        fireEvent.click(getByRole('tab', { name: 'Jobs' }));

        await waitFor(() => expect(getByText('queue.job.completed')).toBeDefined());
        expect(getByText('Pending')).toBeDefined();
        expect(getByText('2')).toBeDefined();
        expect(calls.some((url) => url.includes('/jobs/stats'))).toBe(true);
    });

    test('system events tab fetches history and prepends live SSE events', async () => {
        installObservabilityFetchMock();
        const { getByText } = render(<SystemEventsTab />);

        await waitFor(() => expect(getByText('task.created')).toBeDefined());
        expect(FakeEventSource.instances).toHaveLength(1);
        expect(FakeEventSource.instances[0]?.url).toContain('/events/planning');

        await act(async () => {
            FakeEventSource.instances[0]?.onmessage?.(
                new MessageEvent('message', {
                    data: JSON.stringify({
                        eventName: 'task.updated',
                        occurredAt: '2026-07-04T20:03:00.000Z',
                        actor: 'operator',
                        payload: { status: 'done' },
                    }),
                }),
            );
        });

        await waitFor(() => expect(getByText('task.updated')).toBeDefined());
    });

    test('inbox tab renders sender recipient timestamp metadata and reply grouping', async () => {
        installObservabilityFetchMock();
        const { getByText, container } = render(<InboxTab />);

        await waitFor(() => expect(getByText('Please review the observability board.')).toBeDefined());
        expect(getByText('Review complete.')).toBeDefined();

        const text = container.querySelector('[data-inbox-tab]')?.textContent ?? '';
        expect(text).toContain('operator');
        expect(text).toContain('worker');
        expect(text).toContain('2026-07-04T20:01:00.000Z');
        expect(text).toContain('reply to msg-1');
    });
});
