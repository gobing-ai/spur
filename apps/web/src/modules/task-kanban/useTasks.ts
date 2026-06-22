import { useRef, useSyncExternalStore } from 'react';
import { api, resolveApiUrl } from '../../lib/rpc-client';
import type { TaskSummary } from './types';

const POLL_INTERVAL_MS = 5_000;
const SSE_URL = `${resolveApiUrl()}/events/planning`;

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
// interval feeds both — halving the request load. The SSE stream (0097) is a
// drop-in that feeds the same store; polling is the safety net.

interface TaskState {
    tasks: TaskSummary[];
    loading: boolean;
    error: Error | null;
    connected: boolean;
}

type Listener = () => void;

class TaskStore {
    private state: TaskState = { tasks: [], loading: true, error: null, connected: false };
    private listeners: Listener[] = [];
    private interval: ReturnType<typeof setInterval> | undefined;
    private eventSource: EventSource | undefined;
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
            this.connectSSE();
        }
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
            this.refCount--;
            if (this.refCount === 0) {
                if (this.interval) {
                    clearInterval(this.interval);
                    this.interval = undefined;
                }
                this.disconnectSSE();
            }
        };
    };

    private refresh = async () => {
        try {
            const r = await this.listFn();
            this.state = {
                tasks: (r.data as unknown as TaskSummary[]) ?? [],
                loading: false,
                error: null,
                connected: this.state.connected,
            };
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

    private connectSSE(): void {
        if (this.eventSource) return;
        if (typeof EventSource === 'undefined') return;

        const es = new EventSource(SSE_URL);
        this.eventSource = es;

        es.onopen = () => {
            this.state = { ...this.state, connected: true };
            this.emit();
        };

        es.onmessage = () => {
            // Trigger a refresh on any planning event — the polling interval
            // acts as the safety net if the stream is stale.
            void this.refresh();
        };

        es.onerror = () => {
            this.state = { ...this.state, connected: false };
            this.emit();
            // EventSource auto-reconnects by default; polling keeps the board
            // fresh during the gap per R3 fallback contract.
        };
    }

    private disconnectSSE(): void {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = undefined;
            this.state = { ...this.state, connected: false };
        }
    }

    private emit(): void {
        for (const l of this.listeners) l();
    }
}

const sharedStore = new TaskStore();

/**
 * Hook for task data with SSE stream + polling fallback.
 *
 * The SSE stream (GET /api/events/planning) triggers an immediate refresh
 * on any planning event. The 5s polling interval runs in parallel as a
 * safety net — if the stream drops, the board stays fresh from polling
 * and the store's `connected` flag reflects the stream state.
 *
 * Without a `listFn` argument, all callers share a single module-level store
 * (one polling interval + one SSE connection). Pass `listFn` for isolated test state.
 */
export function useTasks(listFn?: ListFn) {
    const localStore = useRef<TaskStore | null>(null);
    if (listFn && !localStore.current) {
        localStore.current = new TaskStore(listFn);
    }
    const store = localStore.current ?? sharedStore;

    const state = useSyncExternalStore(store.subscribe, store.getState);
    return { ...state, setTasks: store.setTasks };
}
