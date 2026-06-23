import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { TASK_STATUSES, taskStatusIcon } from '@gobing-ai/spur-domain/schema';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import ResizeHandle from '../../components/ResizeHandle';
import { api } from '../../lib/rpc-client';
import KanbanColumn from './KanbanColumn';
import NewTaskPanel from './NewTaskPanel';
import TaskCard from './TaskCard';
import TaskFilters from './TaskFilters';
import type { TaskListFilters, TaskSummary } from './types';
import { useTasks } from './useTasks';

const TaskDetail = lazy(() => import('./TaskDetail'));
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
    const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set(['blocked', 'cancelled']));
    const [folder, setFolder] = useState('docs/tasks');
    const [folders, setFolders] = useState<{ path: string; label?: string }[]>([
        { path: 'docs/tasks', label: 'Primary' },
    ]);
    const [popupTaskWbs, setPopupTaskWbs] = useState<string | null>(null);
    // Default ~3× the old 576px (1728px), clamped to 80vw so it never overflows the viewport.
    const [detailWidth, setDetailWidth] = useState(() =>
        typeof window !== 'undefined' ? Math.min(1728, window.innerWidth * 0.8) : 1728,
    );
    const listWithFolder = useCallback(() => api.task.list({ folder }), [folder]);
    const { tasks, loading, error, connected, setTasks } = useTasks(listWithFolder);
    const [showNewPanel, setShowNewPanel] = useState(false);
    const [activeDragId, setActiveDragId] = useState<string | null>(null);

    useEffect(() => {
        if (typeof api.task.folders !== 'function') return;
        api.task
            .folders({})
            .then((res) => {
                const data = (res as { data?: { path: string; label?: string }[] }).data;
                if (data && data.length > 0) setFolders(data);
            })
            .catch(() => {
                // Fallback to default folder list on error
            });
    }, []);

    // Sync --detail-w CSS variable for the right-docked panel width (R3)
    useEffect(() => {
        document.documentElement.style.setProperty('--detail-w', `${detailWidth}px`);
    }, [detailWidth]);

    // Close the docked detail panel on Escape. A window listener is used because the
    // backdrop <div> never holds focus, so its onKeyDown would not fire.
    useEffect(() => {
        if (!popupTaskWbs) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setPopupTaskWbs(null);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [popupTaskWbs]);
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
        // Default to descending WBS so the newest tasks surface at the top of each lane;
        // the per-column toggle still overrides with an explicit asc/desc.
        const dir = sortState[status] ?? 'desc';
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
                        {folders.map((f) => (
                            <option key={f.path} value={f.path}>
                                {f.label ? `${f.label} (${f.path})` : f.path}
                            </option>
                        ))}
                    </select>
                    <span className="text-xs text-spur-text-muted">|</span>
                    <div className="flex-1" />
                    {KANBAN_COLUMNS.map((status) => (
                        <label key={status} className="flex items-center gap-1 cursor-pointer">
                            <input
                                type="checkbox"
                                className="checkbox checkbox-xs"
                                checked={!hiddenColumns.has(status)}
                                onChange={() => toggleColumn(status)}
                            />
                            <span className="text-[10px] text-spur-text-muted">
                                {taskStatusIcon(status)} {status}
                            </span>
                        </label>
                    ))}
                    <span className="text-xs text-spur-text-muted">|</span>
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
                            onCardClick={(wbs) => {
                                setPopupTaskWbs(wbs);
                                onSelectTask(wbs);
                            }}
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
                {popupTaskWbs && (
                    <>
                        {/* biome-ignore lint/a11y/noStaticElementInteractions: role=presentation with onClick is the standard backdrop pattern */}
                        <div
                            role="presentation"
                            className="fixed inset-0 z-50 bg-black/40"
                            onClick={() => setPopupTaskWbs(null)}
                        />
                        <div
                            role="dialog"
                            aria-modal="true"
                            aria-label="Task detail"
                            className="fixed top-0 right-0 h-full z-50 bg-spur-surface border-l border-spur-border shadow-2xl flex"
                            style={{ width: 'var(--detail-w)', minWidth: '36rem', maxWidth: '80vw' }}
                        >
                            <ResizeHandle
                                targetVar="--detail-w"
                                onResizeEnd={(px) => {
                                    const clamped = Math.max(576, Math.min(px, window.innerWidth * 0.8));
                                    setDetailWidth(clamped);
                                }}
                                direction="horizontal"
                                invert
                            />
                            <div className="flex flex-col flex-1 overflow-hidden">
                                <div className="flex-1 overflow-y-auto" data-testid="detail-body">
                                    {(() => {
                                        const popupTask = tasks.find((t) => t.wbs === popupTaskWbs);
                                        if (!popupTask) return null;
                                        return (
                                            <Suspense
                                                fallback={
                                                    <div className="flex items-center justify-center h-32 text-spur-text-muted text-sm">
                                                        Loading detail...
                                                    </div>
                                                }
                                            >
                                                <TaskDetail
                                                    task={popupTask}
                                                    onClose={() => setPopupTaskWbs(null)}
                                                    onTransition={(wbs, toStatus) => {
                                                        setTasks((prev) =>
                                                            prev.map((t) =>
                                                                t.wbs === wbs ? { ...t, status: toStatus } : t,
                                                            ),
                                                        );
                                                        api.task
                                                            .transition({ wbs, toStatus: toStatus as TaskStatus })
                                                            .catch((err: unknown) => {
                                                                const msg =
                                                                    err instanceof Error
                                                                        ? err.message
                                                                        : 'Transition failed';
                                                                if (typeof window !== 'undefined') {
                                                                    window.dispatchEvent(
                                                                        new CustomEvent('api-error', {
                                                                            detail: { message: msg },
                                                                        }),
                                                                    );
                                                                }
                                                            });
                                                    }}
                                                />
                                            </Suspense>
                                        );
                                    })()}
                                </div>
                            </div>
                        </div>
                    </>
                )}
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
