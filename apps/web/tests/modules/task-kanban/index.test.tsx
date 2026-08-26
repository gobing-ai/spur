import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/react';
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

    test('module shell restores phase, status visibility, and query from the URL', async () => {
        const { api } = await import('../../../src/lib/rpc-client');
        const originalFolders = api.task.folders;
        const originalList = api.task.list;
        const listCalls: unknown[] = [];
        api.task.folders = (async () => ({
            data: [
                { path: 'docs/tasks', label: 'Primary' },
                { path: 'docs/tasks2', label: 'Phase 2' },
            ],
            activeFolder: 'docs/tasks',
        })) as typeof originalFolders;
        api.task.list = (async (input) => {
            listCalls.push(input);
            return originalList(input);
        }) as typeof originalList;

        try {
            const mod = await import('../../../src/modules/task-kanban');
            const View = mod.module.component;
            const { container, getAllByRole, getByLabelText, getByRole, getByTestId } = render(
                <MemoryRouter initialEntries={['/board/tasks?folder=docs%2Ftasks2&status=todo%2Cwip&feature=F72']}>
                    <View />
                </MemoryRouter>,
            );

            expect(getByRole('heading', { name: 'Tasks' })).toBeDefined();
            expect(getByTestId('tasks-live-chip')).toBeDefined();
            expect(getByRole('button', { name: 'Kanban' })).toBeDefined();
            expect(getAllByRole('textbox')).toHaveLength(1);
            expect(getAllByRole('checkbox')).toHaveLength(7);
            expect((container.querySelector('#tasks-status-todo') as HTMLInputElement).checked).toBe(true);
            expect((container.querySelector('#tasks-status-wip') as HTMLInputElement).checked).toBe(true);
            // ADR-081 (amended 2026-08-26): the header rides History's centered 1600px rail
            // while the board body stays full-bleed — max-w appears only in the header.
            expect((container.firstElementChild?.firstElementChild as HTMLElement).className).toContain(
                'max-w-[1600px]',
            );
            expect(container.querySelector('[data-kanban-board] [class*="max-w-"]')).toBeNull();
            expect((container.firstElementChild?.firstElementChild as HTMLElement).className).toContain('px-4');
            await waitFor(() => expect(container.querySelector('[data-kanban-board] .p-4')).not.toBeNull());

            await waitFor(() =>
                expect((getByLabelText('Task phase folder') as HTMLSelectElement).value).toBe('docs/tasks2'),
            );
            await waitFor(() =>
                expect((getByLabelText('Filter by WBS or feature') as HTMLInputElement).value).toBe('F72'),
            );
            expect(listCalls).toEqual([{ folder: 'docs/tasks2' }]);
        } finally {
            api.task.folders = originalFolders;
            api.task.list = originalList;
        }
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
