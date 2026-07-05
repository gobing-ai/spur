import type { TaskStatus } from '@gobing-ai/spur-domain/schema';
import { lazy, Suspense } from 'react';
import { api } from '../../lib/rpc-client';
import type { WebModule } from '../types';
import KanbanBoard from './KanbanBoard';
import type { TaskSummary } from './types';
import { useTaskParams } from './useTaskParams';
import { useTasks } from './useTasks';

const TaskDetail = lazy(() => import('./TaskDetail'));
/** Fire a status transition and surface failures the same way the board's optimistic path does. */
export function transition(wbs: string, toStatus: string): void {
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
    return (
        <Suspense fallback={<div className="p-4 text-spur-text-muted text-sm">Loading…</div>}>
            <TaskDetail task={task} onTransition={transition} />
        </Suspense>
    );
}

export const module: WebModule = {
    id: 'tasks',
    name: 'Tasks',
    icon: '📋',
    route: 'tasks',
    component: TaskKanbanView,
    rightPanelComponent: TaskKanbanDetail,
};
