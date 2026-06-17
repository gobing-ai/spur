import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { TaskSummary } from '../../../src/modules/task-kanban/types';

// ── api stub: the board imports `{ api }` from lib/rpc-client directly, so mock the module. ──
const transitionCalls: Array<{ wbs: string; toStatus: string }> = [];
let transitionImpl: () => Promise<unknown> = async () => ({ ok: true });

const tasks: TaskSummary[] = [
    { wbs: '0001', name: 'Alpha', status: 'todo', priority: 'P1', featureId: 'W3', filePath: 'a.md' },
    { wbs: '0002', name: 'Beta', status: 'wip', priority: 'P2', featureId: 'W4', filePath: 'b.md' },
];

mock.module('../../../src/lib/rpc-client', () => ({
    api: {
        task: {
            list: async () => ({ data: tasks }),
            transition: (input: { wbs: string; toStatus: string }) => {
                transitionCalls.push(input);
                return transitionImpl();
            },
        },
    },
}));

const KanbanBoard = (await import('../../../src/modules/task-kanban/KanbanBoard')).default;
const TaskFilters = (await import('../../../src/modules/task-kanban/TaskFilters')).default;

afterAll(async () => {
    await GlobalRegistrator.unregister();
});

afterEach(() => {
    cleanup();
    transitionCalls.length = 0;
    transitionImpl = async () => ({ ok: true });
});

function renderBoard(props: Partial<Parameters<typeof KanbanBoard>[0]> = {}) {
    return render(
        <MemoryRouter>
            <KanbanBoard onSelectTask={() => {}} {...props} />
        </MemoryRouter>,
    );
}

describe('KanbanBoard', () => {
    test('groups tasks into their status columns after the first poll', async () => {
        const { getByText, container } = renderBoard();
        await waitFor(() => expect(getByText('Alpha')).toBeDefined());

        const todoCol = container.querySelector('[aria-label="todo column"]') as HTMLElement;
        const wipCol = container.querySelector('[aria-label="wip column"]') as HTMLElement;
        expect(todoCol.textContent).toContain('Alpha');
        expect(wipCol.textContent).toContain('Beta');
        expect(todoCol.textContent).not.toContain('Beta');
    });

    test('dropping a card calls api.transition and optimistically moves the card', async () => {
        const { getByText, container } = renderBoard();
        await waitFor(() => expect(getByText('Alpha')).toBeDefined());

        const doneCol = container.querySelector('[aria-label="done column"]') as HTMLElement;
        const dataTransfer = { getData: () => '0001', dropEffect: '' };
        fireEvent.drop(doneCol, { dataTransfer });

        // Optimistic: Alpha appears under done immediately.
        await waitFor(() => expect(doneCol.textContent).toContain('Alpha'));
        expect(transitionCalls).toEqual([{ wbs: '0001', toStatus: 'done' }]);
    });

    test('a rejected transition reverts the optimistic move', async () => {
        transitionImpl = async () => {
            throw new Error('409 guard denied');
        };
        const { getByText, container } = renderBoard();
        await waitFor(() => expect(getByText('Alpha')).toBeDefined());

        const todoCol = container.querySelector('[aria-label="todo column"]') as HTMLElement;
        const doneCol = container.querySelector('[aria-label="done column"]') as HTMLElement;
        fireEvent.drop(doneCol, { dataTransfer: { getData: () => '0001', dropEffect: '' } });

        // After the rejection settles, Alpha is back in todo, gone from done.
        await waitFor(() => expect(todoCol.textContent).toContain('Alpha'));
        expect(doneCol.textContent).not.toContain('Alpha');
    });

    test('filters narrow the visible cards', async () => {
        const { getByText, queryByText } = renderBoard({ filters: { status: 'wip' } });
        await waitFor(() => expect(getByText('Beta')).toBeDefined());
        expect(queryByText('Alpha')).toBeNull();
    });
});

describe('TaskFilters', () => {
    test('renders all four filter controls bound to the current filter values', () => {
        const { getByLabelText } = render(
            <TaskFilters
                filters={{ status: 'wip', featureId: 'W3', parentWbs: '0001', assignee: 'robin' }}
                onChange={() => {}}
            />,
        );
        expect((getByLabelText('Filter by status') as HTMLSelectElement).value).toBe('wip');
        expect((getByLabelText('Filter by feature') as HTMLInputElement).value).toBe('W3');
        expect((getByLabelText('Filter by parent WBS') as HTMLInputElement).value).toBe('0001');
        expect((getByLabelText('Filter by assignee') as HTMLInputElement).value).toBe('robin');
    });

    test('selecting a status reports the key and value', () => {
        const calls: Array<[string, string | null]> = [];
        const { getByLabelText } = render(<TaskFilters filters={{}} onChange={(k, v) => calls.push([k, v])} />);
        fireEvent.change(getByLabelText('Filter by status'), { target: { value: 'done' } });
        expect(calls).toContainEqual(['status', 'done']);
    });

    test('selecting the empty status option reports null', () => {
        const calls: Array<[string, string | null]> = [];
        const { getByLabelText } = render(
            <TaskFilters filters={{ status: 'wip' }} onChange={(k, v) => calls.push([k, v])} />,
        );
        fireEvent.change(getByLabelText('Filter by status'), { target: { value: '' } });
        expect(calls).toContainEqual(['status', null]);
    });
});
