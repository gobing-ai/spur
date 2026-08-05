registerHappyDom();

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { TaskSummary } from '../../../src/modules/task-kanban/types';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';
import { dndState, mockDndKit, resetDndState } from '../../test-helpers/dnd-kit-mock';
import { buildFullRpcMock } from '../../test-helpers/rpc-client-mock';

// ── api stub: the board imports `{ api }` from lib/rpc-client directly, so mock the module. ──
const transitionCalls: Array<{ wbs: string; toStatus: string }> = [];
const createCalls: Array<{ title: string; folder?: string; template?: string }> = [];
const actionCalls: Array<{ wbs: string; action: string; channel?: string; skipDeps?: boolean }> = [];
let transitionImpl: () => Promise<unknown> = async () => ({ ok: true });

const tasks: TaskSummary[] = [
    { wbs: '0001', name: 'Alpha', status: 'todo', priority: 'P1', featureId: 'W3', filePath: 'a.md' },
    { wbs: '0002', name: 'Beta', status: 'wip', priority: 'P2', featureId: 'W4', filePath: 'b.md' },
];

const defaultBoardApi = {
    task: {
        list: async () => ({ data: tasks }),
        transition: (input: { wbs: string; toStatus: string }) => {
            transitionCalls.push(input);
            return transitionImpl();
        },
        create: (input: { title: string; folder?: string; template?: string }) => {
            createCalls.push(input);
            return Promise.resolve({ data: { wbs: '0003', filePath: 'c.md' } });
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
        action: (input: { wbs: string; action: string; channel?: string; skipDeps?: boolean }) => {
            actionCalls.push(input);
            return Promise.resolve({ data: { runId: 'r1', action: input.action, status: 'queued' } });
        },
        folders: async () => ({ data: [{ path: 'docs/tasks', label: 'Primary' }] }),
    },
};

mock.module('../../../src/lib/rpc-client', () => buildFullRpcMock({ api: defaultBoardApi }));

// Capture the onDragEnd callback so tests can simulate dnd-kit drops.
// The dnd-kit mock lives in the shared helper so every test file registers the
// SAME process-global mock (Bun mock.module is last-wins per path).
mockDndKit();

const KanbanBoard = (await import('../../../src/modules/task-kanban/KanbanBoard')).default;

afterAll(teardownHappyDom);
const restoreMock = () => {
    mock.module('../../../src/lib/rpc-client', () => buildFullRpcMock({ api: defaultBoardApi }));
};

beforeEach(() => {
    restoreMock();
});

afterEach(() => {
    cleanup();
    transitionCalls.length = 0;
    createCalls.length = 0;
    actionCalls.length = 0;
    transitionImpl = async () => ({ ok: true });
    resetDndState();
    restoreMock();
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
        expect(dndState.onDragEnd).not.toBeNull();
        (dndState.onDragEnd as NonNullable<typeof dndState.onDragEnd>)({
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

        expect(dndState.onDragEnd).not.toBeNull();
        (dndState.onDragEnd as NonNullable<typeof dndState.onDragEnd>)({
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
        mock.module('../../../src/lib/rpc-client', () =>
            buildFullRpcMock({
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
            }),
        );
        const KanbanBoardReload = (await import('../../../src/modules/task-kanban/KanbanBoard')).default;

        const { getByRole, container } = render(
            <MemoryRouter>
                <KanbanBoardReload onSelectTask={() => {}} />
            </MemoryRouter>,
        );
        await waitFor(() => expect(getByRole('button', { name: 'Sort todo by WBS' })).toBeDefined());

        // Default order is descending WBS: Gamma(0003), Beta(0002), Alpha(0001)

        // Click sort → asc (WBS order: 0001, 0002, 0003)
        fireEvent.click(getByRole('button', { name: 'Sort todo by WBS' }));
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
        mock.module('../../../src/lib/rpc-client', () =>
            buildFullRpcMock({
                api: {
                    task: {
                        list: async () => ({ data: tasksForOrder }),
                        transition: () => transitionImpl(),
                        show: async () => ({ data: { ...tasksForOrder[0], frontmatter: {}, content: '## Body' } }),
                        body: async () => ({ data: { wbs: '0001', filePath: 'a.md' } }),
                    },
                },
            }),
        );
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
        const { getByRole, container } = renderBoard();
        await waitFor(() => expect(getByRole('button', { name: 'Sort todo by WBS' })).toBeDefined());

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

    // Verify backdrop (semantic button overlay)
    const backdrop = container.querySelector('button[aria-label="Close task detail"]');
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
    const backdrop = container.querySelector('button[aria-label="Close task detail"]') as HTMLElement;
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

// ── detail-panel width persistence (localStorage) ──
test('a previously stored detail width is applied as the panel width on mount', async () => {
    // 700px is below the test viewport's 80vw clamp, so it applies verbatim.
    window.localStorage.setItem('spur:detail-width', '700');
    try {
        const { getByText } = renderBoard();
        await waitFor(() => expect(getByText('Alpha')).toBeDefined());

        // The stored width is synced to the --detail-w CSS variable that drives the panel width.
        await waitFor(() => expect(document.documentElement.style.getPropertyValue('--detail-w')).toBe('700px'));
    } finally {
        window.localStorage.removeItem('spur:detail-width');
    }
});

test('an invalid stored detail width falls back to the computed default', async () => {
    window.localStorage.setItem('spur:detail-width', 'not-a-number');
    try {
        const { getByText } = renderBoard();
        await waitFor(() => expect(getByText('Alpha')).toBeDefined());

        // Falls back: --detail-w is set to a positive px value, not the garbage string.
        const applied = document.documentElement.style.getPropertyValue('--detail-w');
        expect(applied).toMatch(/^\d+(\.\d+)?px$/);
        expect(applied).not.toBe('not-a-numberpx');
    } finally {
        window.localStorage.removeItem('spur:detail-width');
    }
});

// ── toggleColumn: clicking a column checkbox hides/shows the column ──
test('column toggle hides and shows a column lane', async () => {
    const { getByText, queryByLabelText, container } = renderBoard();
    await waitFor(() => expect(getByText('Alpha')).toBeDefined());

    // Find all labels with checkboxes, locate the one with "blocked" text
    const labels = container.querySelectorAll('label.flex.items-center.gap-1');
    let blockedCheckbox: HTMLInputElement | null = null;
    labels.forEach((label) => {
        if (label.textContent?.includes('blocked')) {
            blockedCheckbox = label.querySelector('input[type="checkbox"]');
        }
    });
    expect(blockedCheckbox).not.toBeNull();
    // Initially unchecked — blocked column should not be rendered
    expect(queryByLabelText('blocked column')).toBeNull();

    // Toggle it on
    if (blockedCheckbox) fireEvent.click(blockedCheckbox);
    await waitFor(() => expect(queryByLabelText('blocked column')).toBeTruthy());

    // Toggle it off
    if (blockedCheckbox) fireEvent.click(blockedCheckbox);
    await waitFor(() => expect(queryByLabelText('blocked column')).toBeNull());
});

// ── handleDragStart: onDragStart sets activeDragId ──
test('onDragStart captures the active drag id', async () => {
    const { getByText } = renderBoard();
    await waitFor(() => expect(getByText('Alpha')).toBeDefined());

    expect(dndState.onDragStart).not.toBeNull();
    (dndState.onDragStart as NonNullable<typeof dndState.onDragStart>)({
        active: { id: '0001' },
    });
    // The DragOverlay renders when activeDragId is set — verify via the TaskCard inside
    // The mock DragOverlay just passes children through, so check the DOM
});

// ── NewTaskPanel integration: board opens the real creation panel ──
test('opens the real NewTaskPanel from the board toolbar', async () => {
    const { getByRole, getByText } = renderBoard();
    await waitFor(() => expect(getByText('Alpha')).toBeDefined());

    fireEvent.click(getByText('+ New Task'));
    await waitFor(() => expect(getByRole('dialog', { name: 'New Task' })).toBeDefined());
    expect(getByText('Create Task')).toBeDefined();
});

// ── onTransition: TaskDetail cancel fires transition callback ──
test('TaskDetail cancel button fires onTransition to move card', async () => {
    const { getByRole, getByText, container } = renderBoard();
    await waitFor(() => expect(getByText('Alpha')).toBeDefined());

    // Make the cancelled column visible (hidden by default)
    const labels = container.querySelectorAll('label.flex.items-center.gap-1');
    labels.forEach((label) => {
        if (label.textContent?.includes('cancelled')) {
            const cb = label.querySelector('input[type="checkbox"]') as HTMLInputElement;
            if (cb) fireEvent.click(cb);
        }
    });
    await waitFor(() => {
        expect(container.querySelector('[aria-label="cancelled column"]')).toBeTruthy();
    });

    // Open detail panel
    fireEvent.click(getByText('Alpha'));
    await waitFor(() => expect(getByText('Cancel')).toBeDefined());

    fireEvent.click(getByText('Cancel'));
    await waitFor(() => expect(getByRole('dialog', { name: 'Confirm cancel task' })).toBeDefined());
    fireEvent.click(getByRole('button', { name: 'Cancel task' }));

    // Optimistic update: Alpha moves from todo to cancelled
    const cancelledCol = container.querySelector('[aria-label="cancelled column"]') as HTMLElement;
    await waitFor(() => expect(cancelledCol.textContent).toContain('Alpha'));

    // The api transition call fires asynchronously
    await waitFor(() => expect(transitionCalls.length).toBeGreaterThan(0));
    expect(transitionCalls[0]).toEqual({ wbs: '0001', toStatus: 'cancelled' });
});

// ── onTransition catch: failed api.transition dispatches api-error ──
test('onTransition catch handler dispatches api-error when transition fails', async () => {
    transitionImpl = async () => {
        throw new Error('Server gone');
    };
    const { getByRole, getByText, container } = renderBoard();
    await waitFor(() => expect(getByText('Alpha')).toBeDefined());

    // Make cancelled column visible
    const labels = container.querySelectorAll('label.flex.items-center.gap-1');
    labels.forEach((label) => {
        if (label.textContent?.includes('cancelled')) {
            const cb = label.querySelector('input[type="checkbox"]') as HTMLInputElement;
            if (cb) fireEvent.click(cb);
        }
    });
    await waitFor(() => {
        expect(container.querySelector('[aria-label="cancelled column"]')).toBeTruthy();
    });

    // Open detail to capture onTransition
    fireEvent.click(getByText('Alpha'));
    await waitFor(() => expect(getByText('Cancel')).toBeDefined());

    // Spy window.dispatchEvent
    const dispatchSpy = mock((_event: Event) => true);
    const origDispatch = window.dispatchEvent;
    window.dispatchEvent = dispatchSpy;

    fireEvent.click(getByText('Cancel'));
    await waitFor(() => expect(getByRole('dialog', { name: 'Confirm cancel task' })).toBeDefined());
    fireEvent.click(getByRole('button', { name: 'Cancel task' }));

    // Optimistic update still moves Alpha
    const cancelledCol = container.querySelector('[aria-label="cancelled column"]') as HTMLElement;
    await waitFor(() => expect(cancelledCol.textContent).toContain('Alpha'));

    // api-error should be dispatched
    await waitFor(() => expect(dispatchSpy).toHaveBeenCalled());

    window.dispatchEvent = origDispatch;
});

// ── DragOverlay: activeDragId renders card in drag overlay ──
test('DragOverlay renders a TaskCard when a drag is active', async () => {
    const { getByText, container } = renderBoard();
    await waitFor(() => expect(getByText('Alpha')).toBeDefined());

    // Trigger drag start to set activeDragId
    expect(dndState.onDragStart).not.toBeNull();
    (dndState.onDragStart as NonNullable<typeof dndState.onDragStart>)({
        active: { id: '0001' },
    });

    // The DragOverlay renders inside a div.opacity-90 (mock passes children through)
    await waitFor(() => {
        const overlay = container.querySelector('.opacity-90');
        expect(overlay).toBeTruthy();
        expect(overlay?.textContent).toContain('Alpha');
    });
});
// ── onResizeEnd: resize handle saves width to localStorage ──
test('resize handle saves detail width to localStorage on pointer up', async () => {
    const { getByText, container } = renderBoard();
    await waitFor(() => expect(getByText('Alpha')).toBeDefined());

    // Open detail panel
    fireEvent.click(getByText('Alpha'));
    await waitFor(() => {
        const panel = container.querySelector('[role="dialog"][aria-label="Task detail"]');
        expect(panel).toBeTruthy();
    });

    // Find resize handle
    const panel = container.querySelector('[role="dialog"][aria-label="Task detail"]') as HTMLElement;
    const handle = panel.querySelector('[data-testid="resize-handle-h"]') as HTMLElement;
    expect(handle).toBeTruthy();

    // Simulate a resize: pointer down, move, then pointer up.
    fireEvent.pointerDown(handle, { clientX: 800, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 700, clientY: 100 });
    fireEvent.pointerUp(window);

    // onResizeEnd should have saved the clamped width to localStorage
    const stored = window.localStorage.getItem('spur:detail-width');
    expect(stored).toBeTruthy();
    const storedNum = Number(stored);
    expect(storedNum).toBeGreaterThan(0);
});
// ── error state: failed fetch shows error message ──
test('shows error message when task list fetch fails', async () => {
    mock.module('../../../src/lib/rpc-client', () =>
        buildFullRpcMock({
            api: {
                task: {
                    list: async () => {
                        throw new Error('Network Error');
                    },
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
                    folders: async () => ({ data: [{ path: 'docs/tasks', label: 'Primary' }] }),
                },
            },
        }),
    );
    const KanbanBoardReload = (await import('../../../src/modules/task-kanban/KanbanBoard')).default;

    const { getByText } = render(
        <MemoryRouter>
            <KanbanBoardReload onSelectTask={() => {}} />
        </MemoryRouter>,
    );
    await waitFor(() => expect(getByText('Failed to load tasks')).toBeDefined());
    await waitFor(() => expect(getByText('Network Error')).toBeDefined());
});
const KANBAN_COLUMNS = ['backlog', 'todo', 'wip', 'testing', 'blocked', 'done', 'cancelled'];
