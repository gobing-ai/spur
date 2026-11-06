import { afterAll, afterEach, beforeAll, expect, spyOn, test } from 'bun:test';
import type { TaskReadinessResponse } from '@gobing-ai/spur-contracts';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import FeaturesShell from '../../../src/modules/features/FeaturesShell';
import { useFeatureActionProgress } from '../../../src/modules/features/useFeatureActionProgress';
import { useTasks } from '../../../src/modules/task-kanban/useTasks';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';
import { FakePlanningSource } from '../../lib/planning-source.fixture';

let originalEventSource: typeof EventSource;
beforeAll(() => {
    registerHappyDom();
    originalEventSource = globalThis.EventSource;
});
afterAll(teardownHappyDom);
afterEach(() => {
    cleanup();
    resetFetchForTesting();
    globalThis.EventSource = originalEventSource;
    FakePlanningSource.instances = [];
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

test('rendered task, feature and action views share one stream, coalesce 100 events and release it on final unmount', async () => {
    globalThis.EventSource = FakePlanningSource as unknown as typeof EventSource;
    let featureReads = 0;
    let taskReads = 0;
    let version = 0;
    let poll: (() => void) | undefined;
    const nativeInterval = globalThis.setInterval;
    const interval = spyOn(globalThis, 'setInterval').mockImplementation(((callback: () => void, ms: number) => {
        if (ms === 5_000) poll = callback;
        return nativeInterval(callback, ms);
    }) as typeof setInterval);
    const firstFeature = deferred<Response>();
    const firstTasks = deferred<{ data: unknown }>();
    const features = () => [{ id: 'F', name: `Feature version ${version}`, status: 'active', filePath: 'F.md' }];
    const tasks = () => [{ wbs: '1301', name: `Task version ${version}`, status: 'todo', filePath: '1301.md' }];
    setFetchForTesting((async () => {
        featureReads++;
        return featureReads === 1 ? firstFeature.promise : Response.json({ ok: true, data: features() });
    }) as unknown as typeof fetch);
    const listTasks = async () => {
        taskReads++;
        return taskReads === 1 ? firstTasks.promise : { data: tasks() };
    };
    function TaskView() {
        const state = useTasks(listTasks);
        return createElement(
            'output',
            { 'data-testid': 'tasks' },
            `${state.tasks[0]?.name ?? 'loading'}:${state.connected}`,
        );
    }
    function ActionView() {
        const { progress, trackAction } = useFeatureActionProgress('F');
        return createElement(
            'button',
            { type: 'button', onClick: () => trackAction('job-1301', 'plan') },
            progress.status,
        );
    }
    const taskView = render(createElement(TaskView));
    interval.mockRestore();
    const featureView = render(createElement(FeaturesShell));
    const actionView = render(createElement(ActionView));
    fireEvent.click(actionView.getByRole('button', { name: 'idle' }));
    expect(FakePlanningSource.instances).toHaveLength(1);
    const source = FakePlanningSource.latest;
    act(() => {
        source.onopen?.();
        source.frame('null');
        source.frame('broken');
        source.emit('process.output', { cursor: 100 });
        source.emit('queue.job.completed', { jobId: 'someone-else' });
        for (version = 1; version <= 100; version++) source.emit('feature.updated', { id: 'F' });
        version = 100;
        source.emit('task.updated', { wbs: '1301' });
        source.emit('queue.job.running', { jobId: 'job-1301' });
    });
    expect(featureReads).toBe(1);
    expect(taskReads).toBe(1);
    expect(actionView.getByRole('button', { name: 'running' })).toBeDefined();
    await act(async () => {
        firstFeature.resolve(Response.json({ ok: true, data: [{ ...features()[0], name: 'old feature' }] }));
        firstTasks.resolve({ data: [{ ...tasks()[0], name: 'old task' }] });
    });
    await featureView.findByText('Feature version 100');
    await waitFor(() => expect(taskView.getByTestId('tasks').textContent).toBe('Task version 100:true'));
    expect(featureReads).toBe(2);
    expect(taskReads).toBe(2);
    // Advance the actual store's 5s polling callback through a controlled 60s window.
    expect(poll).toBeDefined();
    for (let tick = 0; tick < 12; tick++) await act(async () => poll?.());
    expect(taskReads).toBe(14);
    expect(featureReads).toBe(2);
    expect(FakePlanningSource.instances).toHaveLength(1);
    act(() => source.onerror?.());
    expect(taskView.getByTestId('tasks').textContent).toEndWith(':false');
    act(() => source.onopen?.());
    expect(taskView.getByTestId('tasks').textContent).toEndWith(':true');
    actionView.unmount();
    featureView.unmount();
    expect(source.closed).toBe(false);
    const reads = { featureReads, taskReads };
    act(() => source.emit('process.output', { cursor: 101 }));
    expect({ featureReads, taskReads }).toEqual(reads);
    taskView.unmount();
    expect(source.closed).toBe(true);
    await Bun.write(
        new URL('../../../../../.spur/run/1301/planning-live-proof.json', import.meta.url),
        JSON.stringify(
            {
                scenario: 'AC1',
                planningEvents: 100,
                controlledPollingWindowMs: 60_000,
                connections: FakePlanningSource.instances.length,
                taskReads,
                featureReads,
                finalTask: 'Task version 100',
                finalFeature: 'Feature version 100',
                closedAfterFinalUnmount: source.closed,
                processFramesIgnored: true,
            },
            null,
            2,
        ),
    );
});

test('a selected feature detail refresh is coalesced with the final list reload without reconnecting', async () => {
    globalThis.EventSource = FakePlanningSource as unknown as typeof EventSource;
    const reload = deferred<Response>();
    let listReads = 0;
    let detailReads = 0;
    const data = {
        id: 'F',
        name: 'Selected feature',
        status: 'active',
        filePath: 'F.md',
        frontmatter: {},
        content: 'Body',
    };
    setFetchForTesting((async (input: RequestInfo | URL) => {
        const path = new URL((input as Request).url).pathname;
        if (path.endsWith('/tasks/readiness')) {
            return Response.json({
                ok: true,
                data: { tasks: [], pausedRuns: [], diagnostics: [] },
            } satisfies TaskReadinessResponse);
        }
        if (path.endsWith('/features')) {
            listReads++;
            return listReads === 2 ? reload.promise : Response.json({ ok: true, data: [data] });
        }
        if (!path.endsWith('/features/F')) return Response.json({ ok: true, data: [] });
        detailReads++;
        return Response.json({ ok: true, data });
    }) as typeof fetch);
    const view = render(createElement(FeaturesShell));
    fireEvent.click(await view.findByText('Selected feature'));
    await waitFor(() => expect(detailReads).toBe(1));
    const source = FakePlanningSource.latest;
    expect(FakePlanningSource.instances).toHaveLength(1);
    act(() => {
        for (let i = 0; i < 100; i++) source.emit('feature.updated', { id: 'F' });
    });
    expect(listReads).toBe(2);
    expect(detailReads).toBe(1);
    await act(async () => reload.resolve(Response.json({ ok: true, data: [data] })));
    await waitFor(() => expect(detailReads).toBe(2));
    expect(listReads).toBe(3);
    expect(FakePlanningSource.instances).toHaveLength(1);
});

test('feature unmount aborts in-flight reload and discards its trailing work while other views retain the stream', async () => {
    globalThis.EventSource = FakePlanningSource as unknown as typeof EventSource;
    const response = deferred<Response>();
    let signal: AbortSignal | undefined;
    let reads = 0;
    setFetchForTesting((async (input: RequestInfo | URL) => {
        reads++;
        signal = (input as Request).signal;
        return response.promise;
    }) as typeof fetch);
    const view = render(createElement(FeaturesShell));
    const source = FakePlanningSource.latest;
    act(() => source.emit('feature.updated'));
    expect(reads).toBe(1);
    view.unmount();
    expect(signal?.aborted).toBe(true);
    expect(source.closed).toBe(true);
    await act(async () => response.resolve(Response.json({ ok: true, data: [] })));
    expect(reads).toBe(1);
});
