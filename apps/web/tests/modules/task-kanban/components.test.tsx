registerHappyDom();

import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { TaskSummary } from '../../../src/modules/task-kanban/types';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

// Prevent mock leakage from other test files: TaskDetail calls api.task.show on mount
// and imports @uiw/react-md-editor (which has heavy scheduler usage in test environments).
mock.module('@uiw/react-md-editor', () => ({
    default: Object.assign(
        function MockEditor() {
            return null;
        },
        {
            Markdown: function MockMarkdown() {
                return null;
            },
        },
    ),
}));

// Shared full-surface rpc-client mock — prevents "last mock wins" starvation
import '../../test-helpers/rpc-client-mock';

mock.module('@dnd-kit/core', () => ({
    DndContext: ({ children }: { children: unknown }) => children,
    DragOverlay: ({ children }: { children: unknown }) => children,
    PointerSensor: class {},
    KeyboardSensor: class {},
    useSensor: (..._args: unknown[]) => ({}),
    useDraggable: (_params: { id: string; data?: Record<string, unknown> }) => ({
        attributes: {},
        listeners: {},
        setNodeRef: () => {},
        transform: null,
        isDragging: false,
        active: null,
    }),
    useDroppable: (_params: { id: string }) => ({
        setNodeRef: () => {},
        isOver: false,
    }),
}));

import KanbanColumn from '../../../src/modules/task-kanban/KanbanColumn';
import TaskCard from '../../../src/modules/task-kanban/TaskCard';
import TaskDetail from '../../../src/modules/task-kanban/TaskDetail';

afterAll(teardownHappyDom);

afterEach(() => cleanup());

const task = (over: Partial<TaskSummary> = {}): TaskSummary => ({
    wbs: '0001',
    name: 'Build the board',
    status: 'todo',
    priority: 'P1',
    featureId: 'W3',
    filePath: 'docs/tasks/0001.md',
    ...over,
});

describe('TaskCard', () => {
    test('renders WBS, name, and priority/feature badges (no status badge)', () => {
        const { getByText, queryByText } = render(<TaskCard task={task()} onClick={() => {}} />);
        expect(getByText('0001')).toBeDefined();
        expect(getByText('Build the board')).toBeDefined();
        // R7: status badge removed from cards — only type/priority/feature chips remain
        expect(queryByText('todo')).toBeNull();
        expect(getByText('P1')).toBeDefined();
        expect(getByText('W3')).toBeDefined();
    });

    test('R7 — renders type chip when type is not task', () => {
        const { getByText } = render(<TaskCard task={task({ type: 'issue' })} onClick={() => {}} />);
        expect(getByText('issue')).toBeDefined();
    });

    test('R7 — does not render status badge text on card', () => {
        const { container } = render(<TaskCard task={task()} onClick={() => {}} />);
        // The card renders wbs, name, priority, feature — but never the raw status word as a badge
        const badges = container.querySelectorAll('.badge');
        const badgeTexts = Array.from(badges).map((b) => b.textContent);
        expect(badgeTexts).not.toContain('todo');
    });

    test('clicking the card reports the WBS so the detail panel can open', () => {
        const captured: { wbs?: string } = {};
        const { getByText } = render(<TaskCard task={task()} onClick={(w) => (captured.wbs = w)} />);
        fireEvent.click(getByText('Build the board'));
        expect(captured.wbs).toBe('0001');
    });

    test('renders relative timestamp when updatedAt is provided', () => {
        const t = task({ updatedAt: new Date(Date.now() - 120_000).toISOString() });
        const { getByText } = render(<TaskCard task={t} onClick={() => {}} />);
        expect(getByText('2m ago')).toBeDefined();
    });

    test('does not render timestamp when updatedAt is absent', () => {
        const t = task();
        const { container } = render(<TaskCard task={t} onClick={() => {}} />);
        expect(container.textContent).not.toContain('ago');
    });

    test('R7 — priority accent: left border color per P1/P2/P3, none for absent/unrecognized', () => {
        const p1 = render(<TaskCard task={task({ priority: 'P1' })} onClick={() => {}} />);
        expect(p1.container.querySelector('button')?.className).toContain('border-l-spur-error');
        p1.unmount();
        const p2 = render(<TaskCard task={task({ priority: 'P2' })} onClick={() => {}} />);
        expect(p2.container.querySelector('button')?.className).toContain('border-l-spur-warning');
        p2.unmount();
        const p3 = render(<TaskCard task={task({ priority: 'P3' })} onClick={() => {}} />);
        expect(p3.container.querySelector('button')?.className).toContain('border-l-spur-text-muted');
        p3.unmount();
        // Absent or unrecognized priority → no accent border class at all.
        const none = render(<TaskCard task={task({ priority: undefined })} onClick={() => {}} />);
        const cls = none.container.querySelector('button')?.className ?? '';
        expect(cls).not.toContain('border-l-');
        none.unmount();
        const unknown = render(<TaskCard task={task({ priority: 'P9' })} onClick={() => {}} />);
        expect(unknown.container.querySelector('button')?.className).not.toContain('border-l-');
        unknown.unmount();
    });

    test('R7 — staleness tint: timestamp faint when updatedAt older than 7 days', () => {
        const stale = task({ updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() });
        const s = render(<TaskCard task={stale} onClick={() => {}} />);
        const span = s.container.querySelector('button span[title]');
        expect(span?.className).toContain('text-spur-text-faint');
        s.unmount();
        const fresh = task({ updatedAt: new Date(Date.now() - 60_000).toISOString() });
        const f = render(<TaskCard task={fresh} onClick={() => {}} />);
        const span2 = f.container.querySelector('button span[title]');
        expect(span2?.className).toContain('text-spur-text-muted');
        expect(span2?.className).not.toContain('text-spur-text-faint');
        f.unmount();
    });
});

describe('KanbanColumn', () => {
    test('shows the task count and an empty-state when no tasks', () => {
        const { getByText } = render(<KanbanColumn status="todo" label="todo" tasks={[]} onCardClick={() => {}} />);
        expect(getByText('No tasks')).toBeDefined();
        expect(getByText('0')).toBeDefined();
    });

    test('R7 — column header shows status icon and label', () => {
        // KanbanColumn renders taskStatusIcon(status) before the label — verify both the emoji and label appear
        const { container } = render(<KanbanColumn status="todo" label="todo" tasks={[]} onCardClick={() => {}} />);
        // The header span contains the icon (🔲 for todo) followed by the label text
        const header = container.querySelector('span.text-xs.font-semibold');
        expect(header).not.toBeNull();
        expect(header?.textContent).toContain('🔲');
        expect(header?.textContent).toContain('todo');
    });
    test('renders task cards for the given tasks', () => {
        const { getByText } = render(
            <KanbanColumn status="todo" label="todo" tasks={[task()]} onCardClick={() => {}} />,
        );
        expect(getByText('Build the board')).toBeDefined();
    });

    test('shows sort toggle with neutral icon when no sort is active', () => {
        const { getByRole } = render(
            <KanbanColumn status="todo" label="todo" tasks={[task()]} onCardClick={() => {}} onSortToggle={() => {}} />,
        );
        const btn = getByRole('button', { name: 'Sort todo by WBS' });
        expect(btn).toBeDefined();
        expect(btn.textContent).toBe('⇅');
    });

    test('shows descending arrow when sort is asc', () => {
        const { getByRole } = render(
            <KanbanColumn
                status="todo"
                label="todo"
                tasks={[task()]}
                onCardClick={() => {}}
                sortDir="asc"
                onSortToggle={() => {}}
            />,
        );
        expect(getByRole('button', { name: 'Sort todo by WBS' }).textContent).toBe('↓');
    });

    test('shows ascending arrow when sort is desc', () => {
        const { getByRole } = render(
            <KanbanColumn
                status="todo"
                label="todo"
                tasks={[task()]}
                onCardClick={() => {}}
                sortDir="desc"
                onSortToggle={() => {}}
            />,
        );
        expect(getByRole('button', { name: 'Sort todo by WBS' }).textContent).toBe('↑');
    });

    test('calls onSortToggle when sort button is clicked', () => {
        let toggled = false;
        const { getByRole } = render(
            <KanbanColumn
                status="todo"
                label="todo"
                tasks={[task()]}
                onCardClick={() => {}}
                onSortToggle={() => {
                    toggled = true;
                }}
            />,
        );
        fireEvent.click(getByRole('button', { name: 'Sort todo by WBS' }));
        expect(toggled).toBe(true);
    });
});

describe('TaskDetail', () => {
    test('renders the empty state when nothing is selected', () => {
        const { getByText } = render(<TaskDetail task={null} onTransition={() => {}} />);
        expect(getByText('Select a task to view details')).toBeDefined();
    });

    test('renders the selected task with its title and a plaintext status pill', () => {
        const { getByText, getByTestId } = render(<TaskDetail task={task()} onTransition={() => {}} />);
        // Header title combines wbs + name.
        expect(getByText(/Build the board/)).toBeDefined();
        // Status is shown as a plaintext pill (with icon), not a dropdown.
        const pill = getByTestId('status-pill');
        expect(pill.tagName).not.toBe('SELECT');
        expect(pill.textContent).toContain('todo');
    });
});
