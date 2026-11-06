import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import PlanningReadinessPanel from '../../../src/modules/task-kanban/PlanningReadinessPanel';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';
import { FakePlanningSource } from '../../lib/planning-source.fixture';

const original = globalThis.EventSource;
beforeAll(registerHappyDom);
afterAll(teardownHappyDom);
afterEach(() => {
    cleanup();
    resetFetchForTesting();
    globalThis.EventSource = original;
    FakePlanningSource.instances = [];
});
const payload = (command = '/sp:dev-run 0001') => ({
    ok: true,
    data: {
        tasks: [
            { wbs: '0001', state: 'ready', reasons: [], nextAction: { kind: 'run-task', wbs: '0001', command } },
            {
                wbs: '0002',
                state: 'blocked',
                reasons: [{ code: 'dependency-missing', message: 'Dependency 0099 is missing' }],
                nextAction: null,
            },
        ],
        pausedRuns: [{ runId: 'paused-2', wbs: '0002' }],
        diagnostics: [],
    },
});

test('native disclosure displays blockers, legal commands and paused links without executing work', async () => {
    globalThis.EventSource = FakePlanningSource as unknown as typeof EventSource;
    const methods: string[] = [];
    setFetchForTesting((async (request: Request) => {
        methods.push(request.method);
        return Response.json(payload());
    }) as typeof fetch);
    const view = render(createElement(PlanningReadinessPanel));
    await view.findByText('/sp:dev-run 0001');
    fireEvent.click(view.getByText('Daily readiness'));
    expect(view.container.querySelector('summary')).toBeDefined();
    expect(view.getByText('Dependency 0099 is missing')).toBeDefined();
    expect(view.getByRole('link', { name: /paused-2/ }).getAttribute('href')).toEndWith('/api/runs/paused-2/progress');
    expect(view.getByText('/sp:dev-run 0001').closest('button')).toBeNull();
    expect(methods).toEqual(['GET']);
    view.unmount();
    expect(FakePlanningSource.latest.closed).toBe(true);
});

test('100 events coalesce to one trailing read and hide stale recommendations', async () => {
    globalThis.EventSource = FakePlanningSource as unknown as typeof EventSource;
    let calls = 0;
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
        release = resolve;
    });
    setFetchForTesting((async () => {
        calls++;
        return calls === 2 ? pending : Response.json(payload());
    }) as unknown as typeof fetch);
    const view = render(createElement(PlanningReadinessPanel));
    await view.findByText('/sp:dev-run 0001');
    act(() => FakePlanningSource.latest.emit('task.updated'));
    await waitFor(() => expect(calls).toBe(2));
    expect(view.queryByText('/sp:dev-run 0001')).toBeNull();
    act(() => {
        for (let i = 0; i < 100; i++) FakePlanningSource.latest.emit('task.updated');
    });
    await act(async () => release(Response.json(payload('/sp:dev-run old'))));
    await waitFor(() => expect(calls).toBe(3));
    await view.findByText('/sp:dev-run 0001');
    expect(view.queryByText('/sp:dev-run old')).toBeNull();
});

test('scope changes abort old reads and reject late results; errors leave no commands', async () => {
    globalThis.EventSource = FakePlanningSource as unknown as typeof EventSource;
    let release!: (response: Response) => void;
    let firstSignal: AbortSignal | undefined;
    let reads = 0;
    setFetchForTesting((async (request: Request) => {
        reads++;
        if (reads === 1) {
            firstSignal = request.signal;
            return new Promise<Response>((resolve) => {
                release = resolve;
            });
        }
        return Response.json(payload());
    }) as typeof fetch);
    const view = render(createElement(PlanningReadinessPanel, { folder: 'docs/old' }));
    await waitFor(() => expect(reads).toBe(1));
    view.rerender(createElement(PlanningReadinessPanel, { folder: 'docs/new', taskWbs: ['0002'] }));
    await view.findByText('Dependency 0099 is missing');
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => release(Response.json(payload('/sp:dev-run stale'))));
    expect(view.queryByText('/sp:dev-run stale')).toBeNull();
    expect(view.queryByText('/sp:dev-run 0001')).toBeNull();
    setFetchForTesting((async () => {
        throw new Error('offline');
    }) as unknown as typeof fetch);
    act(() => FakePlanningSource.latest.emit('task.updated'));
    await view.findByRole('alert');
    expect(view.queryByText('/sp:dev-run 0001')).toBeNull();
});
