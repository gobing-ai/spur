import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { cleanup, render, waitFor } from '@testing-library/react';

// Must mock rpc-client before any module that transitively imports it
// (index.tsx → useTaskParams/useTasks → rpc-client). resolveApiUrl reads
// location.origin, which happy-dom's URL() rejects at module-init time.
mock.module('../../../src/lib/rpc-client', () => ({
    resolveApiUrl: () => 'http://localhost:3000/api',
    fetchWithTimeout: mock(async (_r: Request) => new Response()),
    api: { task: { transition: mock(async () => {}) } },
}));

mock.module('../../../src/modules/task-kanban/TaskDetail', () => ({
    default: () => null,
}));

mock.module('../../../src/modules/task-kanban/useTasks', () => ({
    useTasks: () => ({ tasks: [{ wbs: 'A1', title: 'Test', status: 'todo' }], loading: false }),
}));

mock.module('../../../src/modules/task-kanban/useTaskParams', () => ({
    useTaskParams: () => ({ selected: 'A1', selectTask: () => {}, filters: {}, setFilter: () => {} }),
}));

import { teardownHappyDom } from '../../happy-dom';

try {
    GlobalRegistrator.register();
} catch {
    /* already registered */
}

afterAll(teardownHappyDom);

describe('TaskKanbanDetail', () => {
    afterEach(cleanup);

    test('renders the right-panel container with a selected task', async () => {
        const mod = await import('../../../src/modules/task-kanban');
        const Component = mod.module.rightPanelComponent;
        if (!Component) throw new Error('rightPanelComponent not set');

        const { container } = render(<Component />);
        await waitFor(() => expect(container.textContent).toContain('Loading…'));
    });
});

describe('transition', () => {
    const apiErrors: Array<{ message: string }> = [];

    beforeEach(() => {
        apiErrors.length = 0;
        window.addEventListener('api-error', ((e: Event) =>
            apiErrors.push((e as CustomEvent).detail as { message: string })) as EventListener);
    });

    test('dispatches api-error event on failure', async () => {
        const { api } = await import('../../../src/lib/rpc-client');
        const orig = api.task.transition;
        api.task.transition = mock(async () => {
            throw new Error('network down');
        }) as typeof orig;

        const { transition } = await import('../../../src/modules/task-kanban/index');
        transition('A1', 'wip');

        await new Promise((r) => setTimeout(r, 50));
        expect(apiErrors.length).toBeGreaterThan(0);
        expect(apiErrors[0]?.message).toBe('network down');

        api.task.transition = orig;
    });

    test('formats non-Error rejections as generic message', async () => {
        const { api } = await import('../../../src/lib/rpc-client');
        const orig = api.task.transition;
        api.task.transition = mock(async () => {
            throw 'string error';
        }) as typeof orig;

        const { transition } = await import('../../../src/modules/task-kanban/index');
        transition('A1', 'wip');

        await new Promise((r) => setTimeout(r, 50));
        expect(apiErrors.length).toBeGreaterThan(0);
        expect(apiErrors[0]?.message).toBe('Transition failed');

        api.task.transition = orig;
    });
});
