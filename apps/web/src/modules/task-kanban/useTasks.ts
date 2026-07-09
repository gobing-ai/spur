import { useEffect, useRef, useSyncExternalStore } from 'react';
import { api, resolveApiUrl } from '../../lib/rpc-client';
import type { TaskSummary } from './types';

const POLL_INTERVAL_MS = 5_000;
type ListFn = (query?: { folder?: string; status?: string; parent?: string }) => Promise<{ data: unknown }>;
const sseUrl = () => `${resolveApiUrl()}/events/planning`;
const defaultListTasks: ListFn = (query = {}) => api.task.list(query);

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

/**
 * Ref-counted singleton task store with SSE stream + polling fallback.
 *
 * On first subscriber: opens an EventSource against `/api/events/planning`,
 * starts a 5s polling interval as a safety net, and triggers an initial refresh.
 * On last unsubscribe: closes the SSE connection and clears the interval.
 */
export class TaskStore {
    private state: TaskState = { tasks: [], loading: true, error: null, connected: false };
    private listeners: Listener[] = [];
    private interval: ReturnType<typeof setInterval> | undefined;
    private eventSource: EventSource | undefined;
    private refCount = 0;
    private listFn: ListFn;

    constructor(listFn: ListFn = defaultListTasks) {
        this.listFn = listFn;
    }

    getState = (): TaskState => this.state;

    /**
     * Swap the list source (e.g. on folder change) without tearing down the SSE
     * connection or polling interval, then refresh from the new source. Keeping
     * the store stable avoids reconnect churn for an infrequent user action.
     */
    setListFn = (listFn: ListFn): void => {
        if (listFn === this.listFn) return;
        this.listFn = listFn;
        void this.refresh();
    };

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

    private handleSSEOpen = () => {
        this.state = { ...this.state, connected: true };
        this.emit();
    };

    private handleSSEMessage = () => {
        void this.refresh();
    };

    private handleSSEError = () => {
        this.state = { ...this.state, connected: false };
        this.emit();
    };
    private connectSSE(): void {
        if (this.eventSource) return;
        if (typeof EventSource === 'undefined') return;

        const es = new EventSource(sseUrl());
        this.eventSource = es;

        es.onopen = this.handleSSEOpen;

        es.onmessage = this.handleSSEMessage;

        es.onerror = this.handleSSEError;
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

let _sharedStore: TaskStore | null = null;
function getSharedStore(): TaskStore {
    if (!_sharedStore) _sharedStore = new TaskStore();
    return _sharedStore;
}

/**
 * Hook for task data with SSE stream + polling fallback.
 *
 * The SSE stream (GET /api/events/planning) triggers an immediate refresh
 * on any planning event. The 5s polling interval runs in parallel as a
 * safety net — if the stream drops, the board stays fresh from polling
 * and the store's `connected` flag reflects the stream state.
 *
 * Without a `listFn` argument, all callers share a single module-level store
 * (one polling interval + one SSE connection). Pass `listFn` to use an isolated
 * store that is recreated when `listFn` changes (e.g. for folder switching).
 */
export function useTasks(listFn?: ListFn) {
    // With a listFn, use a stable isolated store kept for the hook's lifetime and
    // re-pointed via setListFn when listFn changes (e.g. folder switch) — this
    // avoids tearing down the SSE/poll connection on every change. Without one,
    // share the module-level store.
    const localStore = useRef<TaskStore | null>(null);
    if (listFn && !localStore.current) {
        localStore.current = new TaskStore(listFn);
    }
    const store = localStore.current ?? getSharedStore();

    useEffect(() => {
        if (listFn && localStore.current) {
            localStore.current.setListFn(listFn);
        }
    }, [listFn]);

    const state = useSyncExternalStore(store.subscribe, store.getState);
    return { ...state, setTasks: store.setTasks };
}
