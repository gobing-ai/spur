import { useRef, useSyncExternalStore } from 'react';
import { api } from '../../lib/rpc-client';
import type { TaskSummary } from './types';

const POLL_INTERVAL_MS = 5_000;

type ListFn = (query?: Record<string, unknown>) => Promise<{ data: unknown }>;
const defaultListTasks: ListFn = (query) => api.task.list(query);

/** Pure refresh factory — exported for unit testing without mocking the oRPC client. */
export function createRefresh(
    listFn: ListFn,
    setTasks: (updater: TaskSummary[] | ((prev: TaskSummary[]) => TaskSummary[])) => void,
    setError: (err: Error | null) => void,
    setLoading: (loading: boolean) => void,
) {
    return async () => {
        try {
            const r = await listFn();
            setTasks((r.data as unknown as TaskSummary[]) ?? []);
            setError(null);
        } catch (e) {
            setError(e as Error);
        } finally {
            setLoading(false);
        }
    };
}

// ─── Module-level singleton store ───────────────────────────────────────────
// KanbanBoard and TaskKanbanDetail are sibling components under BoardLayout
// with no shared React parent state. The singleton ensures a single polling
// interval feeds both — halving the request load. When SSE lands (W6), the
// store is the single subscribe point.

interface TaskState {
    tasks: TaskSummary[];
    loading: boolean;
    error: Error | null;
}

type Listener = () => void;

class TaskStore {
    private state: TaskState = { tasks: [], loading: true, error: null };
    private listeners: Listener[] = [];
    private interval: ReturnType<typeof setInterval> | undefined;
    private refCount = 0;
    private readonly listFn: ListFn;

    constructor(listFn: ListFn = defaultListTasks) {
        this.listFn = listFn;
    }

    getState = (): TaskState => this.state;

    subscribe = (listener: Listener): (() => void) => {
        this.listeners.push(listener);
        this.refCount++;
        if (this.refCount === 1) {
            void this.refresh();
            this.interval = setInterval(this.refresh, POLL_INTERVAL_MS);
        }
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
            this.refCount--;
            if (this.refCount === 0 && this.interval) {
                clearInterval(this.interval);
                this.interval = undefined;
            }
        };
    };
    private refresh = async () => {
        try {
            const r = await this.listFn();
            this.state = { tasks: (r.data as unknown as TaskSummary[]) ?? [], loading: false, error: null };
        } catch (e) {
            this.state = { ...this.state, loading: false, error: e as Error };
        }
        this.emit();
    };

    setTasks = (updater: TaskSummary[] | ((prev: TaskSummary[]) => TaskSummary[])) => {
        const next = typeof updater === 'function' ? updater(this.state.tasks) : updater;
        this.state = { ...this.state, tasks: next };
        this.emit();
    };

    private emit(): void {
        for (const l of this.listeners) l();
    }
}

const sharedStore = new TaskStore();

/**
 * Polling hook for task data. The `list` contract takes no query input, so the full task list is
 * polled and filtering happens client-side in the board. The SSE swap (W6 usePlanningEvents) is a
 * drop-in that feeds the same store — this is invariant #10.
 *
 * Without a `listFn` argument, all callers share a single module-level store
 * (one polling interval). Pass `listFn` for isolated test state.
 */
export function useTasks(listFn?: ListFn) {
    // When a custom listFn is provided (tests), create a per-hook TaskStore
    // backed by that listFn. Otherwise, use the module-level singleton. Both
    // paths go through useSyncExternalStore so hooks are always called
    // unconditionally (Rules of Hooks).
    const localStore = useRef<TaskStore | null>(null);
    if (listFn && !localStore.current) {
        localStore.current = new TaskStore(listFn);
    }
    const store = localStore.current ?? sharedStore;

    const state = useSyncExternalStore(store.subscribe, store.getState);
    return { ...state, setTasks: store.setTasks };
}
