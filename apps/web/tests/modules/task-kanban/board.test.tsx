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
            folders: async () => ({ data: [{ path: 'docs/tasks', label: 'Primary' }] }),
        },
    },
    resolveApiUrl: () => 'http://localhost:3000/api',
}));

// Capture the onDragEnd callback so tests can simulate dnd-kit drops.
let capturedOnDragEnd:
    | ((event: { active: { id: string | number }; over: { id: string | number } | null }) => void)
    | null = null;

mock.module('@dnd-kit/core', () => ({
    DndContext: ({
        children,
        onDragEnd,
    }: {
        children: unknown;
        onDragEnd?: (event: { active: { id: string | number }; over: { id: string | number } | null }) => void;
    }) => {
        capturedOnDragEnd = onDragEnd ?? null;
        return children;
    },
    DragOverlay: ({ children }: { children: unknown }) => children,
    PointerSensor: class {},
    KeyboardSensor: class {},
    useSensor: (..._args: unknown[]) => ({}),
    useSensors: (...s: unknown[]) => s,
    useDraggable: () => ({
        attributes: {},
        listeners: {},
        setNodeRef: () => {},
        transform: null,
        isDragging: false,
        active: null,
    }),
    useDroppable: () => ({
        setNodeRef: () => {},
        isOver: false,
    }),
}));

mock.module('@dnd-kit/utilities', () => ({
    CSS: { Transform: { toString: () => '' } },
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

        // Simulate dnd-kit onDragEnd: drag '0001' into the 'done' column.
        expect(capturedOnDragEnd).not.toBeNull();
        (capturedOnDragEnd as NonNullable<typeof capturedOnDragEnd>)({
            active: { id: '0001' },
            over: { id: 'done' },
        });

        // Optimistic: Alpha appears under done immediately.
        const doneCol = container.querySelector('[aria-label="done column"]') as HTMLElement;
        await waitFor(() => expect(doneCol.textContent).toContain('Alpha'));
        expect(transitionCalls).toEqual([{ wbs: '0001', toStatus: 'done' }]);
    });

    test('a rejected transition reverts the optimistic move', async () => {
        transitionImpl = async () => {
            throw new Error('409 guard denied');
        };
        const { getByText, container } = renderBoard();
        await waitFor(() => expect(getByText('Alpha')).toBeDefined());

        expect(capturedOnDragEnd).not.toBeNull();
        (capturedOnDragEnd as NonNullable<typeof capturedOnDragEnd>)({
            active: { id: '0001' },
            over: { id: 'done' },
        });

        // After the rejection settles, Alpha is back in todo, gone from done.
        const todoCol = container.querySelector('[aria-label="todo column"]') as HTMLElement;
        const doneCol = container.querySelector('[aria-label="done column"]') as HTMLElement;
        await waitFor(() => expect(todoCol.textContent).toContain('Alpha'));
        expect(doneCol.textContent).not.toContain('Alpha');
    });

    test('filters narrow the visible cards', async () => {
        const { getByText, queryByText } = renderBoard({ filters: { status: 'wip' } });
        await waitFor(() => expect(getByText('Beta')).toBeDefined());
        expect(queryByText('Alpha')).toBeNull();
    });

    test('sort toggle cycles through off → asc → desc → off', async () => {
        const tasksForSort: TaskSummary[] = [
            { wbs: '0003', name: 'Gamma', status: 'todo', filePath: 'c.md' },
            { wbs: '0001', name: 'Alpha', status: 'todo', filePath: 'a.md' },
            { wbs: '0002', name: 'Beta', status: 'todo', filePath: 'b.md' },
        ];
        mock.module('../../../src/lib/rpc-client', () => ({
            api: {
                task: {
                    list: async () => ({ data: tasksForSort }),
                    transition: () => transitionImpl(),
                },
            },
        }));
        const KanbanBoardReload = (await import('../../../src/modules/task-kanban/KanbanBoard')).default;

        const { getByLabelText, container } = render(
            <MemoryRouter>
                <KanbanBoardReload onSelectTask={() => {}} />
            </MemoryRouter>,
        );
        await waitFor(() => expect(getByLabelText('Sort todo by WBS')).toBeDefined());

        // Default order: 0003, 0001, 0002 (as returned by list)

        // Click sort → asc (WBS order: 0001, 0002, 0003)
        fireEvent.click(getByLabelText('Sort todo by WBS'));
        const afterAsc = (container.querySelector('[aria-label="todo column"]') as HTMLElement).textContent ?? '';
        expect(afterAsc.indexOf('Alpha')).toBeLessThan(afterAsc.indexOf('Beta'));
        expect(afterAsc.indexOf('Beta')).toBeLessThan(afterAsc.indexOf('Gamma'));
    });

    test('column visibility checkboxes are rendered for each status', async () => {
        const { getByLabelText, container } = renderBoard();
        await waitFor(() => expect(getByLabelText('Sort todo by WBS')).toBeDefined());

        // Checkboxes exist for each column status
        const checkboxes = container.querySelectorAll('input[type="checkbox"]');
        expect(checkboxes.length).toBe(KANBAN_COLUMNS.length);
    });

    test('folder selector renders and shows default folder', async () => {
        const { getByLabelText } = renderBoard();
        await waitFor(() => expect(getByLabelText('Task folder')).toBeDefined());
        const select = getByLabelText('Task folder') as HTMLSelectElement;
        expect(select.value).toBe('docs/tasks');
    });
});

const KANBAN_COLUMNS = ['backlog', 'todo', 'wip', 'testing', 'blocked', 'done', 'cancelled'];

describe('TaskFilters', () => {
    test('renders feature/parent/assignee filter controls (R3 — no status dropdown)', () => {
        const { getByLabelText, queryByLabelText } = render(
            <TaskFilters filters={{ featureId: 'W3', parentWbs: '0001', assignee: 'robin' }} onChange={() => {}} />,
        );
        // R3: status <select> removed
        expect(queryByLabelText('Filter by status')).toBeNull();
        expect((getByLabelText('Filter by feature') as HTMLInputElement).value).toBe('W3');
        expect((getByLabelText('Filter by parent WBS') as HTMLInputElement).value).toBe('0001');
        expect((getByLabelText('Filter by assignee') as HTMLInputElement).value).toBe('robin');
    });
});
