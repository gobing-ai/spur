import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// Shared full-surface rpc-client mock — prevents "last mock wins" starvation
import '../../test-helpers/rpc-client-mock';

import { registerHappyDom, teardownHappyDom } from '../../happy-dom';
import { mockDndKit } from '../../test-helpers/dnd-kit-mock';

registerHappyDom();

afterAll(teardownHappyDom);

// The module-root scoping test mounts the REAL board against the shared
// rpc-client mock + dnd-kit mock. We deliberately do NOT mock KanbanBoard here:
// Bun's mock.module is process-global and last-wins per path, so a module-scope
// KanbanBoard mock leaks into board.test.tsx when both files share a worker
// (the 4-vCPU GitHub runner), rendering `board-stub` there. The real board
// renders the `.task-kanban` wrapper (index.tsx) regardless of its own internals.
mockDndKit();

describe('TaskKanbanDetail', () => {
    afterEach(cleanup);

    test('task detail is shown via modal overlay, not rightPanelComponent', async () => {
        const mod = await import('../../../src/modules/task-kanban');
        // rightPanelComponent is deliberately absent — task details are shown in the
        // KanbanBoard popup overlay (auto-opened from URL WBS), not in the RightPanel.
        expect(mod.module.rightPanelComponent).toBeUndefined();
    });
});

describe('TaskKanbanView scoping', () => {
    afterEach(cleanup);

    test('module root carries the task-kanban class that confines the DESIGN.md palette', async () => {
        const mod = await import('../../../src/modules/task-kanban');
        const View = mod.module.component;

        const { container } = render(
            <MemoryRouter>
                <View />
            </MemoryRouter>,
        );

        // R6 scoping hook: the module root must keep `.task-kanban` so the scoped
        // custom-property block in global.css does not leak the DESIGN.md surface
        // ladder onto the shared palette (which would regress Teams + Observability).
        expect(container.firstElementChild?.className).toContain('task-kanban');
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
