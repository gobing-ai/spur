import type { TaskStatus } from '@gobing-ai/spur-domain/schema';
import { api } from '../../lib/rpc-client';
import type { WebModule } from '../types';
import KanbanBoard from './KanbanBoard';
import TasksShell from './TasksShell';
import { useTaskParams } from './useTaskParams';
/** Fire a status transition and surface failures the same way the board's optimistic path does. */
export function transition(wbs: string, toStatus: string): void {
    api.task.transition({ wbs, toStatus: toStatus as TaskStatus }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Transition failed';
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('api-error', { detail: { message: msg } }));
        }
    });
}

/** Headerless board container: binds URL filters + card-click selection to the
 * board. Exported so the Workspace module can embed the headerless current-
 * project Task Kanban (task 0197 R6) — no module shell header inside the embed. */
export function TaskKanbanView() {
    const { filters, selectTask, setFilter } = useTaskParams();
    return (
        <div className="task-kanban flex flex-col h-full">
            <div data-kanban-board className="flex-1 overflow-hidden">
                <KanbanBoard onSelectTask={selectTask} filters={filters} onFilterChange={setFilter} />
            </div>
        </div>
    );
}

export const module: WebModule = {
    id: 'tasks',
    name: 'Tasks',
    icon: '📋',
    route: 'tasks',
    component: TasksShell,
};
