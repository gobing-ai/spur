import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { TASK_STATUSES } from '@gobing-ai/spur-domain/schema';
import { useCallback, useState } from 'react';
import { api } from '../../lib/rpc-client';
import KanbanColumn from './KanbanColumn';
import NewTaskPanel from './NewTaskPanel';
import TaskCard from './TaskCard';
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
    const [sortState, setSortState] = useState<Record<string, 'asc' | 'desc'>>({});
    const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
    const [folder, setFolder] = useState('docs/tasks');
    const listWithFolder = useCallback(() => api.task.list({ folder }), [folder]);
    const { tasks, loading, error, connected, setTasks } = useTasks(listWithFolder);
    const [showNewPanel, setShowNewPanel] = useState(false);
    const [activeDragId, setActiveDragId] = useState<string | null>(null);
    const pointerSensor = useSensor(PointerSensor, {
        activationConstraint: { distance: 5 },
    });
    const keyboardSensor = useSensor(KeyboardSensor);
    const sensors = useSensors(pointerSensor, keyboardSensor);

    const handleCreated = async () => {
        try {
            const res = await listWithFolder();
            setTasks((res.data as unknown as TaskSummary[]) ?? []);
        } catch {
            // Poll will catch up on next interval.
        }
    };

    const visible = applyFilters(tasks, filters);

    const toggleSort = (status: string) => {
        setSortState((prev) => {
            const next = { ...prev };
            if (prev[status] === 'asc') next[status] = 'desc';
            else if (prev[status] === 'desc') delete next[status];
            else next[status] = 'asc';
            return next;
        });
    };

    const toggleColumn = (status: string) => {
        setHiddenColumns((prev) => {
            const next = new Set(prev);
            if (next.has(status)) next.delete(status);
            else next.add(status);
            return next;
        });
    };

    const tasksByStatus = (status: string): TaskSummary[] => {
        const cols = visible.filter((t) => t.status === status);
        const dir = sortState[status];
        if (!dir) return cols;
        return [...cols].sort((a, b) => {
            const cmp = a.wbs.localeCompare(b.wbs);
            return dir === 'asc' ? cmp : -cmp;
        });
    };

    const findCard = (wbs: string): TaskSummary | undefined => tasks.find((t) => t.wbs === wbs);

    const handleDragStart = (event: { active: { id: string | number } }) => {
        setActiveDragId(String(event.active.id));
    };

    const handleDragEnd = (event: { active: { id: string | number }; over: { id: string | number } | null }) => {
        setActiveDragId(null);

        const { active, over } = event;
        if (!over) return;

        const wbs = String(active.id);
        const newStatus = String(over.id);
        const card = findCard(wbs);
        if (!card || card.status === newStatus) return;

        const previous = [...tasks];
        setTasks((prev) => prev.map((t) => (t.wbs === wbs ? { ...t, status: newStatus } : t)));

        api.task.transition({ wbs, toStatus: newStatus as TaskStatus }).catch((err: unknown) => {
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
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="flex flex-col h-full">
                <div className="flex items-center gap-2 px-4 pt-3 pb-1 shrink-0">
                    {onFilterChange && <TaskFilters filters={filters ?? {}} onChange={onFilterChange} />}
                    <div
                        className="flex items-center gap-1.5"
                        title={connected ? 'Live updates active' : 'Polling (stream disconnected)'}
                    >
                        <span
                            className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}
                        />
                        <span className="text-xs text-spur-text-muted">{connected ? 'Live' : 'Polling'}</span>
                    </div>
                    <span className="text-xs text-spur-text-muted">|</span>
                    <select
                        className="select select-xs select-ghost text-xs"
                        value={folder}
                        onChange={(e) => setFolder(e.target.value)}
                        aria-label="Task folder"
                    >
                        <option value="docs/tasks">docs/tasks</option>
                    </select>
                    <span className="text-xs text-spur-text-muted">|</span>
                    {KANBAN_COLUMNS.map((status) => (
                        <label key={status} className="flex items-center gap-1 cursor-pointer">
                            <input
                                type="checkbox"
                                className="checkbox checkbox-xs"
                                checked={!hiddenColumns.has(status)}
                                onChange={() => toggleColumn(status)}
                            />
                            <span className="text-[10px] text-spur-text-muted">{status}</span>
                        </label>
                    ))}
                    <span className="text-xs text-spur-text-muted">|</span>
                    <div className="flex-1" />
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => setShowNewPanel(true)}>
                        + New Task
                    </button>
                </div>
                <div className="flex gap-3 overflow-x-auto h-full p-4">
                    {KANBAN_COLUMNS.filter((s) => !hiddenColumns.has(s)).map((status: string) => (
                        <KanbanColumn
                            key={status}
                            status={status}
                            label={status}
                            tasks={tasksByStatus(status)}
                            onCardClick={onSelectTask}
                            sortDir={sortState[status]}
                            onSortToggle={() => toggleSort(status)}
                        />
                    ))}
                </div>
                <NewTaskPanel
                    open={showNewPanel}
                    onClose={() => setShowNewPanel(false)}
                    onCreated={handleCreated}
                    folder={folder}
                />
            </div>

            <DragOverlay dropAnimation={null}>
                {activeDragId
                    ? (() => {
                          const card = findCard(activeDragId);
                          if (!card) return null;
                          return (
                              <div className="opacity-90">
                                  <TaskCard task={card} onClick={() => {}} />
                              </div>
                          );
                      })()
                    : null}
            </DragOverlay>
        </DndContext>
    );
}
