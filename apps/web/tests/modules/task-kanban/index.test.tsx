import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { cleanup } from '@testing-library/react';

// Shared full-surface rpc-client mock — prevents "last mock wins" starvation
import '../../test-helpers/rpc-client-mock';

import { teardownHappyDom } from '../../happy-dom';

try {
    try {
        GlobalRegistrator.register();
    } catch {} // already registered in suite
} catch {
    /* already registered */
}

afterAll(teardownHappyDom);

describe('TaskKanbanDetail', () => {
    afterEach(cleanup);

    test('task detail is shown via modal overlay, not rightPanelComponent', async () => {
        const mod = await import('../../../src/modules/task-kanban');
        // rightPanelComponent is deliberately absent — task details are shown in the
        // KanbanBoard popup overlay (auto-opened from URL WBS), not in the RightPanel.
        expect(mod.module.rightPanelComponent).toBeUndefined();
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
