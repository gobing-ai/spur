import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { TASK_STATUSES } from '@gobing-ai/spur-domain/schema';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { Loading } from '@/ui';
import ResizeHandle from '../../components/ResizeHandle';
import { api } from '../../lib/rpc-client';
import KanbanColumn from './KanbanColumn';
import TaskCard from './TaskCard';
import type { TaskListFilters, TaskSummary } from './types';
import { useTasks } from './useTasks';

const TaskDetail = lazy(() => import('./TaskDetail'));
const KANBAN_COLUMNS = TASK_STATUSES;

/**
 * Initial folder shown before the `task.folders` endpoint responds. The server is
 * the authority on the actual phase folders; this is only a first-paint placeholder,
 * immediately replaced on mount for the uncontrolled (embed) default. Mirrors the
 * DEFAULT_TASKS_DIR SSOT in @gobing-ai/spur-config (kept inline to avoid a config
 * dependency in the browser bundle).
 */
export const BOOTSTRAP_FOLDER = 'docs/tasks';

/** localStorage key for the user's last-set detail-panel width (px). */
const DETAIL_WIDTH_KEY = 'spur:detail-width';

/** Default lane visibility when the board is uncontrolled (Workspace embed). */
const DEFAULT_HIDDEN: ReadonlySet<string> = new Set(['blocked', 'cancelled']);

type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Headerless board — the Workspace embed entry point and the Kanban tab body.
 *
 * All added props are optional with uncontrolled in-board defaults, so the
 * Workspace embed renders this board exactly as today (minus the old toolbar).
 * Under the module route, TasksShell controls folder + lane visibility through
 * these props; all filter state stays URL-driven via `useTaskParams`.
 */
interface Props {
    onSelectTask: (wbs: string) => void;
    filters?: TaskListFilters;
    onFilterChange?: (key: 'status' | 'feature' | 'parent' | 'assignee', value: string | null) => void;
    /** Controlled phase folder (module route). Omitted → board resolves its own default. */
    folder?: string;
    /** Controlled lane visibility. Omitted → board defaults `blocked`/`cancelled` hidden. */
    hiddenColumns?: ReadonlySet<string>;
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

export default function KanbanBoard(props: Props) {
    const { onSelectTask, filters, folder: folderProp, hiddenColumns: hiddenProp } = props;
    const [sortState, setSortState] = useState<Record<string, 'asc' | 'desc'>>({});
    // Uncontrolled default folder — server active folder adopted on mount; used only
    // when the shell doesn't pass a controlled `folder` (Workspace embed).
    const [internalFolder, setInternalFolder] = useState(BOOTSTRAP_FOLDER);
    const [popupTaskWbs, setPopupTaskWbs] = useState<string | null>(null);
    // Default ~3× the old 576px (1728px), clamped to 80vw so it never overflows the viewport.
    const [detailWidth, setDetailWidth] = useState(() => {
        const fallback = typeof window !== 'undefined' ? Math.min(1728, window.innerWidth * 0.8) : 1728;
        if (typeof window === 'undefined') return fallback;
        try {
            const stored = Number.parseFloat(window.localStorage.getItem(DETAIL_WIDTH_KEY) ?? '');
            if (Number.isFinite(stored) && stored > 0) {
                return Math.min(stored, window.innerWidth * 0.8);
            }
        } catch {
            // localStorage unavailable (private mode / disabled) — use the fallback.
        }
        return fallback;
    });

    const folder = folderProp ?? internalFolder;
    const hiddenColumns = hiddenProp ?? DEFAULT_HIDDEN;

    const listWithFolder = useCallback(() => api.task.list({ folder }), [folder]);
    const { tasks, loading, error, setTasks } = useTasks(listWithFolder);
    const [activeDragId, setActiveDragId] = useState<string | null>(null);

    // Adopt the server's active folder as the uncontrolled default (embed / no prop).
    useEffect(() => {
        if (typeof api.task.folders !== 'function') return;
        api.task
            .folders({})
            .then((res) => {
                const { data, activeFolder } = res as {
                    data?: { path: string; label?: string }[];
                    activeFolder?: string;
                };
                const active = activeFolder ?? data?.[0]?.path;
                if (active !== undefined) setInternalFolder(active);
            })
            .catch(() => {
                // Fall back to the bootstrap default folder.
            });
    }, []);

    // Sync --detail-w CSS variable for the right-docked panel width.
    useEffect(() => {
        document.documentElement.style.setProperty('--detail-w', `${detailWidth}px`);
    }, [detailWidth]);

    // Close the docked detail panel on Escape.
    useEffect(() => {
        if (!popupTaskWbs) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setPopupTaskWbs(null);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [popupTaskWbs]);

    // Auto-popup task detail when arriving with a WBS in the URL path (e.g. from the combined input).
    const location = useLocation();
    useEffect(() => {
        const parts = location.pathname.split('/');
        const tasksIdx = parts.indexOf('tasks');
        const pathWbs = tasksIdx >= 0 ? parts[tasksIdx + 1] : undefined;
        if (pathWbs && /^\d{4}$/.test(pathWbs)) {
            setPopupTaskWbs(pathWbs);
        }
    }, [location.pathname]);

    const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 5 } });
    const keyboardSensor = useSensor(KeyboardSensor);
    const sensors = useSensors(pointerSensor, keyboardSensor);

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

    const tasksByStatus = (status: string): TaskSummary[] => {
        const cols = visible.filter((t) => t.status === status);
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
                <Loading size="lg" className="text-spur-accent" />
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
                {popupTaskWbs && (
                    <>
                        <button
                            type="button"
                            aria-label="Close task detail"
                            className="fixed inset-0 z-50 bg-black/40 border-0 p-0 cursor-default"
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
                                    try {
                                        window.localStorage.setItem(DETAIL_WIDTH_KEY, String(clamped));
                                    } catch {
                                        // localStorage unavailable — width still applies for this session.
                                    }
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
