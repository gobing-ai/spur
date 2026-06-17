import { TASK_STATUSES } from '@gobing-ai/spur-domain/schema';
import { api } from '../../lib/rpc-client';
import KanbanColumn from './KanbanColumn';
import TaskFilters from './TaskFilters';
import type { TaskListFilters, TaskSummary } from './types';
import { useTasks } from './useTasks';

const KANBAN_COLUMNS = TASK_STATUSES;

type TaskStatus = (typeof TASK_STATUSES)[number];

interface Props {
    onSelectTask: (wbs: string) => void;
    filters?: TaskListFilters;
    onFilterChange?: (key: 'status' | 'feature' | 'parent' | 'assignee', value: string | null) => void;
}

/**
 * Narrows the polled task list by the active filters. The `list` contract takes no query input
 * (filtering is not yet server-side — see task 0084 R6 contract-gap note), so filters apply client-side
 * against the already-polled rows. `assignee` is accepted in the URL but inert until TaskSummary carries it.
 */
function applyFilters(tasks: TaskSummary[], filters?: TaskListFilters): TaskSummary[] {
    if (!filters) return tasks;
    return tasks.filter((t) => {
        if (filters.status && t.status !== filters.status) return false;
        if (filters.featureId && t.featureId !== filters.featureId) return false;
        if (filters.parentWbs && t.parentWbs !== filters.parentWbs) return false;
        return true;
    });
}

export default function KanbanBoard({ onSelectTask, filters, onFilterChange }: Props) {
    const { tasks, loading, error, setTasks } = useTasks();

    const visible = applyFilters(tasks, filters);
    const tasksByStatus = (status: string): TaskSummary[] => visible.filter((t) => t.status === status);

    const handleDrop = (wbs: string, newStatus: string) => {
        const card = tasks.find((t) => t.wbs === wbs);
        if (!card || card.status === newStatus) return;

        const previous = [...tasks];
        // Optimistic update — move the card immediately.
        setTasks((prev) => prev.map((t) => (t.wbs === wbs ? { ...t, status: newStatus } : t)));

        api.task.transition({ wbs, toStatus: newStatus as TaskStatus }).catch((err: unknown) => {
            // Revert on error (e.g. a 409 guard denial from the lifecycle).
            setTasks(previous);
            const msg = err instanceof Error ? err.message : 'Transition failed';
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('api-error', { detail: { message: msg } }));
            }
        });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <span className="loading loading-spinner loading-lg text-spur-accent" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center text-spur-text-muted">
                    <p className="text-lg font-semibold">Failed to load tasks</p>
                    <p className="text-sm">{error.message}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {onFilterChange && <TaskFilters filters={filters ?? {}} onChange={onFilterChange} />}
            <div className="flex gap-3 overflow-x-auto h-full p-4">
                {KANBAN_COLUMNS.map((status: string) => (
                    <KanbanColumn
                        key={status}
                        status={status}
                        label={status}
                        tasks={tasksByStatus(status)}
                        onCardClick={onSelectTask}
                        onDrop={handleDrop}
                    />
                ))}
            </div>
        </div>
    );
}
