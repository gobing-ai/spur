import type { TaskStatus } from '@gobing-ai/spur-domain/schema';
import { api } from '../../lib/rpc-client';
import KanbanBoard from './KanbanBoard';
import TaskDetail from './TaskDetail';
import type { TaskSummary } from './types';
import { useTaskParams } from './useTaskParams';
import { useTasks } from './useTasks';

/** Fire a status transition and surface failures the same way the board's optimistic path does. */
function transition(wbs: string, toStatus: string): void {
    api.task.transition({ wbs, toStatus: toStatus as TaskStatus }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Transition failed';
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('api-error', { detail: { message: msg } }));
        }
    });
}

/** Board container: binds URL filters + card-click selection to the board. */
function TaskKanbanView() {
    const { filters, selectTask, setFilter } = useTaskParams();
    return (
        <div className="flex flex-col h-full">
            <div data-kanban-board className="flex-1 overflow-hidden">
                <KanbanBoard onSelectTask={selectTask} filters={filters} onFilterChange={setFilter} />
            </div>
        </div>
    );
}

/** Right-panel container: resolves `?selected` against the polled list and feeds TaskDetail. */
function TaskKanbanDetail() {
    const { selected } = useTaskParams();
    const { tasks } = useTasks();
    const task: TaskSummary | null = selected ? (tasks.find((t) => t.wbs === selected) ?? null) : null;
    return <TaskDetail task={task} onTransition={transition} />;
}

export const TaskKanbanModule = {
    id: 'tasks',
    name: 'Tasks',
    icon: '📋',
    route: 'tasks',
    component: TaskKanbanView,
    rightPanelComponent: TaskKanbanDetail,
};
