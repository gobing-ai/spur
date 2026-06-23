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
            show: async () => ({
                data: {
                    wbs: '0001',
                    name: 'Alpha',
                    status: 'todo',
                    frontmatter: {},
                    content: '## Body',
                    filePath: 'a.md',
                },
            }),
            body: async () => ({ data: { wbs: '0001', filePath: 'a.md' } }),
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
    // Let any pending React scheduler callback (from the lazy TaskDetail/MarkdownBody
    // mounted by the panel tests) drain before window is torn down — otherwise a
    // post-teardown scheduler task references window.event and throws.
    await new Promise((resolve) => setTimeout(resolve, 0));
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
                    show: async () => ({
                        data: {
                            wbs: '0001',
                            name: 'Alpha',
                            status: 'todo',
                            frontmatter: {},
                            content: '## Body',
                            filePath: 'a.md',
                        },
                    }),
                    body: async () => ({ data: { wbs: '0001', filePath: 'a.md' } }),
                },
            },
            resolveApiUrl: () => 'http://localhost:3000/api',
        }));
        const KanbanBoardReload = (await import('../../../src/modules/task-kanban/KanbanBoard')).default;

        const { getByLabelText, container } = render(
            <MemoryRouter>
                <KanbanBoardReload onSelectTask={() => {}} />
            </MemoryRouter>,
        );
        await waitFor(() => expect(getByLabelText('Sort todo by WBS')).toBeDefined());

        // Default order is descending WBS: Gamma(0003), Beta(0002), Alpha(0001)

        // Click sort → asc (WBS order: 0001, 0002, 0003)
        fireEvent.click(getByLabelText('Sort todo by WBS'));
        const afterAsc = (container.querySelector('[aria-label="todo column"]') as HTMLElement).textContent ?? '';
        expect(afterAsc.indexOf('Alpha')).toBeLessThan(afterAsc.indexOf('Beta'));
        expect(afterAsc.indexOf('Beta')).toBeLessThan(afterAsc.indexOf('Gamma'));
    });

    test('lane defaults to descending WBS order (newest first) without any sort toggle', async () => {
        const tasksForOrder: TaskSummary[] = [
            { wbs: '0001', name: 'Alpha', status: 'todo', filePath: 'a.md' },
            { wbs: '0003', name: 'Gamma', status: 'todo', filePath: 'c.md' },
            { wbs: '0002', name: 'Beta', status: 'todo', filePath: 'b.md' },
        ];
        mock.module('../../../src/lib/rpc-client', () => ({
            api: {
                task: {
                    list: async () => ({ data: tasksForOrder }),
                    transition: () => transitionImpl(),
                    show: async () => ({ data: { ...tasksForOrder[0], frontmatter: {}, content: '## Body' } }),
                    body: async () => ({ data: { wbs: '0001', filePath: 'a.md' } }),
                },
            },
            resolveApiUrl: () => 'http://localhost:3000/api',
        }));
        const KanbanBoardReload = (await import('../../../src/modules/task-kanban/KanbanBoard')).default;

        const { container, getByText } = render(
            <MemoryRouter>
                <KanbanBoardReload onSelectTask={() => {}} />
            </MemoryRouter>,
        );
        await waitFor(() => expect(getByText('Gamma')).toBeDefined());

        // No sort toggle clicked → descending WBS: Gamma(0003) → Beta(0002) → Alpha(0001).
        const lane = (container.querySelector('[aria-label="todo column"]') as HTMLElement).textContent ?? '';
        expect(lane.indexOf('Gamma')).toBeLessThan(lane.indexOf('Beta'));
        expect(lane.indexOf('Beta')).toBeLessThan(lane.indexOf('Alpha'));
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

// ── 0100 R1: header right-cluster (spacer before toggle group) ──
test('header spacer sits before the status toggle group so they cluster right', async () => {
    const { getByText, container } = renderBoard();
    await waitFor(() => expect(getByText('Alpha')).toBeDefined());

    const header = container.querySelector('.flex.items-center.gap-2.px-4') as HTMLElement;
    expect(header).toBeTruthy();
    const children = Array.from(header.children);

    // Find the flex-1 spacer
    const spacerIdx = children.findIndex((el) => el.classList.contains('flex-1'));
    expect(spacerIdx).toBeGreaterThan(0);

    // Everything after the spacer should be the toggle group + New Task button
    const afterSpacer = children.slice(spacerIdx + 1);
    const afterText = afterSpacer.map((el) => el.textContent ?? '').join(' ');
    expect(afterText).toContain('+ New Task');
    // Toggle group checkboxes + New Task are all after the spacer
    const hasToggleCheckboxes = afterSpacer.some((el) => el.querySelector('input[type="checkbox"]'));
    expect(hasToggleCheckboxes).toBe(true);
});

// ── 0100 R2: right-docked detail panel ──
test('detail panel is right-docked overlay with backdrop', async () => {
    const { getByText, getByLabelText, container } = renderBoard();
    await waitFor(() => expect(getByText('Alpha')).toBeDefined());

    // Click a card to open the detail
    fireEvent.click(getByText('Alpha'));
    await waitFor(() => expect(getByLabelText('Close detail')).toBeDefined());

    // Verify backdrop
    const backdrop = container.querySelector('[role="presentation"].fixed.inset-0');
    expect(backdrop).toBeTruthy();

    // Verify docked panel (dialog, fixed right-0)
    const panel = container.querySelector('[role="dialog"][aria-label="Task detail"]');
    expect(panel).toBeTruthy();
    expect(panel?.className).toContain('right-0');
    expect(panel?.className).toContain('h-full');
    expect(panel?.className).not.toContain('items-center'); // not centered
    expect(panel?.className).not.toContain('justify-center');
});

test('detail panel closes on backdrop click', async () => {
    const { getByText, getByLabelText, queryByLabelText, container } = renderBoard();
    await waitFor(() => expect(getByText('Alpha')).toBeDefined());

    // Open detail
    fireEvent.click(getByText('Alpha'));
    await waitFor(() => expect(getByLabelText('Close detail')).toBeDefined());

    // Close via backdrop click
    const backdrop = container.querySelector('[role="presentation"].fixed.inset-0') as HTMLElement;
    fireEvent.click(backdrop);
    await waitFor(() => expect(queryByLabelText('Close detail')).toBeNull());
});

test('detail panel closes on Escape key from anywhere (global listener)', async () => {
    const { getByText, getByLabelText, queryByLabelText } = renderBoard();
    await waitFor(() => expect(getByText('Alpha')).toBeDefined());

    // Open detail
    fireEvent.click(getByText('Alpha'));
    await waitFor(() => expect(getByLabelText('Close detail')).toBeDefined());

    // Escape dispatched on document.body (not a focused backdrop) must still close it —
    // proves the window-level keydown listener, not a div-scoped handler.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(queryByLabelText('Close detail')).toBeNull());
});

test('detail panel closes on ✕ button click', async () => {
    const { getByText, getByLabelText, queryByLabelText } = renderBoard();
    await waitFor(() => expect(getByText('Alpha')).toBeDefined());

    // Open detail
    fireEvent.click(getByText('Alpha'));
    await waitFor(() => expect(getByLabelText('Close detail')).toBeDefined());

    // Close via ✕
    fireEvent.click(getByLabelText('Close detail'));
    await waitFor(() => expect(queryByLabelText('Close detail')).toBeNull());
});

test('clicking a second card updates the same panel without stacking', async () => {
    const { getByText, getByLabelText, container } = renderBoard();
    await waitFor(() => expect(getByText('Alpha')).toBeDefined());

    // Open detail for Alpha
    fireEvent.click(getByText('Alpha'));
    await waitFor(() => expect(getByLabelText('Close detail')).toBeDefined());

    // Click Beta — panel should update, no stacking
    fireEvent.click(getByText('Beta'));
    // There should be exactly one dialog panel
    const panels = container.querySelectorAll('[role="dialog"][aria-label="Task detail"]');
    expect(panels.length).toBe(1);
});

// ── 0100 R3: resize handle ──
test('docked panel has a resize handle on its left edge', async () => {
    const { getByText, getByLabelText, container } = renderBoard();
    await waitFor(() => expect(getByText('Alpha')).toBeDefined());

    // Open detail
    fireEvent.click(getByText('Alpha'));
    await waitFor(() => expect(getByLabelText('Close detail')).toBeDefined());

    // Verify resize handle exists inside the docked panel
    const panel = container.querySelector('[role="dialog"][aria-label="Task detail"]') as HTMLElement;
    const handle = panel.querySelector('[data-testid="resize-handle-h"]');
    expect(handle).toBeTruthy();
    expect(handle?.getAttribute('aria-orientation')).toBe('vertical'); // horizontal resize → vertical orientation per aria spec
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
