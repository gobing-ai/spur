import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { TaskSummary } from '../../../src/modules/task-kanban/types';

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
mock.module('../../../src/lib/rpc-client', () => ({
    api: {
        task: {
            show: async () => ({
                data: { content: '', wbs: '0001', name: 'Test', status: 'todo', frontmatter: {}, filePath: 'a.md' },
            }),
        },
    },
}));

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

afterAll(async () => {
    await new Promise((r) => setTimeout(r, 50));
    await GlobalRegistrator.unregister();
});

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
    test('renders WBS, name, status badge, and priority/feature badges', () => {
        const { getByText } = render(<TaskCard task={task()} onClick={() => {}} />);
        expect(getByText('0001')).toBeDefined();
        expect(getByText('Build the board')).toBeDefined();
        expect(getByText('todo')).toBeDefined();
        expect(getByText('P1')).toBeDefined();
        expect(getByText('W3')).toBeDefined();
    });

    test('clicking the card reports the WBS so the detail panel can open', () => {
        const captured: { wbs?: string } = {};
        const { getByText } = render(<TaskCard task={task()} onClick={(w) => (captured.wbs = w)} />);
        fireEvent.click(getByText('Build the board'));
        expect(captured.wbs).toBe('0001');
    });
});

describe('KanbanColumn', () => {
    test('shows the task count and an empty-state when no tasks', () => {
        const { getByText } = render(<KanbanColumn status="todo" label="todo" tasks={[]} onCardClick={() => {}} />);
        expect(getByText('No tasks')).toBeDefined();
        expect(getByText('0')).toBeDefined();
    });

    test('renders task cards for the given tasks', () => {
        const { getByText } = render(
            <KanbanColumn status="todo" label="todo" tasks={[task()]} onCardClick={() => {}} />,
        );
        expect(getByText('Build the board')).toBeDefined();
    });
});

describe('TaskDetail', () => {
    test('renders the empty state when nothing is selected', () => {
        const { getByText } = render(<TaskDetail task={null} onTransition={() => {}} />);
        expect(getByText('Select a task to view details')).toBeDefined();
    });

    test('renders the selected task and fires onTransition on a status button', () => {
        const calls: Array<{ wbs: string; status: string }> = [];
        const { getByText, getByRole } = render(
            <TaskDetail task={task()} onTransition={(w, s) => calls.push({ wbs: w, status: s })} />,
        );
        expect(getByText('Build the board')).toBeDefined();
        fireEvent.click(getByRole('button', { name: 'done' }));
        expect(calls).toEqual([{ wbs: '0001', status: 'done' }]);
    });
});
