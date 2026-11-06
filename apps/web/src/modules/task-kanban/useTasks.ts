import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import { api, resolveApiUrl } from '../../lib/rpc-client';
import type { TaskSummary } from './types';

const POLL_INTERVAL_MS = 5_000;
type ListFn = (query?: { folder?: string; status?: string; parent?: string }) => Promise<{ data: unknown }>;
const sseUrl = () => `${resolveApiUrl()}/events/planning`;
const defaultListTasks: ListFn = async (query = {}) => api.task.list(query);

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
            // SAFETY: the oRPC list envelope's `data` is typed `unknown` by the JSONified
            // transport, but the contract handler always returns a task array under `data`.
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
// Each KanbanBoard owns its folder-scoped store and provides it to cards/detail.
// The module singleton remains the fallback for consumers outside a board.

/** Subtask progress for one parent WBS: done counts `status === 'done'` children. */
interface SubtaskProgress {
    done: number;
    total: number;
}

interface TaskState {
    tasks: TaskSummary[];
    subtaskProgress: ReadonlyMap<string, SubtaskProgress>;
    loading: boolean;
    error: Error | null;
    connected: boolean;
    lastSyncAt: number | undefined;
}

type Listener = () => void;

/** Identity of one refresh attempt: the folder source and subscription it speaks for. */
interface RefreshToken {
    generation: number;
    lifetime: number;
    promise: Promise<void>;
}

/**
 * Ref-counted task store with SSE stream + polling fallback.
 *
 * On first subscriber: opens an EventSource against `/api/events/planning`,
 * starts a 5s polling interval as a safety net, and triggers an initial refresh.
 * On last unsubscribe: closes the SSE connection and clears the interval.
 */
export class TaskStore {
    private state: TaskState = {
        tasks: [],
        subtaskProgress: new Map(),
        loading: true,
        error: null,
        connected: false,
        lastSyncAt: undefined,
    };
    private listeners: Listener[] = [];
    private interval: ReturnType<typeof setInterval> | undefined;
    private eventSource: EventSource | undefined;
    private refCount = 0;
    private listFn: ListFn;
    /** Bumped by `setListFn`: a response from an older folder can never commit. */
    private sourceGeneration = 0;
    /** Bumped on the first subscribe and on the final unsubscribe: a disposed subscription's response can never commit. */
    private lifetime = 0;
    /** The in-flight request for the current generation+lifetime; same-source refreshes coalesce behind it. */
    private activeRequest: RefreshToken | null = null;
    /** At most one trailing refresh is queued behind the active request. */
    private pendingRefresh = false;

    constructor(listFn: ListFn = defaultListTasks) {
        this.listFn = listFn;
    }

    getState = (): TaskState => this.state;

    /**
     * Swap the list source (e.g. on folder change) without tearing down the SSE
     * connection or polling interval, then refresh from the new source. Keeping
     * the store stable avoids reconnect churn for an infrequent user action.
     *
     * The new source starts immediately: a hung request for the previous folder
     * is abandoned, never awaited, and can never commit its result.
     */
    setListFn = (listFn: ListFn): void => {
        if (listFn === this.listFn) return;
        this.listFn = listFn;
        this.sourceGeneration++;
        this.pendingRefresh = false;
        void this.refresh();
    };

    subscribe = (listener: Listener): (() => void) => {
        this.listeners.push(listener);
        this.refCount++;
        if (this.refCount === 1) {
            // A fresh subscription owns its own lifetime: responses started for a
            // previous subscriber set are discarded instead of reviving the store.
            this.lifetime++;
            void this.refresh();
            this.interval = setInterval(() => void this.refresh(), POLL_INTERVAL_MS);
            void this.connectSSE();
        }
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
            this.refCount--;
            if (this.refCount === 0) {
                // Invalidate in-flight work and any queued trailing refresh: a
                // disposed subscription must not emit or overwrite visible state.
                this.lifetime++;
                this.pendingRefresh = false;
                this.activeRequest = null;
                if (this.interval) {
                    clearInterval(this.interval);
                    this.interval = undefined;
                }
                this.disconnectSSE();
            }
        };
    };

    /** True while `token` still speaks for the current folder source and subscription. */
    private isCurrent = (token: RefreshToken): boolean =>
        token.generation === this.sourceGeneration && token.lifetime === this.lifetime;

    /**
     * Refresh ownership gate. A refresh for the current generation+lifetime
     * coalesces behind the in-flight request and queues exactly one trailing run;
     * a refresh after a folder change (or a new subscription) starts immediately.
     */
    private refresh = (): Promise<void> => {
        const active = this.activeRequest;
        if (active !== null && this.isCurrent(active)) {
            this.pendingRefresh = true;
            return active.promise;
        }
        return this.startRequest();
    };

    private startRequest(): Promise<void> {
        const token: RefreshToken = {
            generation: this.sourceGeneration,
            lifetime: this.lifetime,
            promise: Promise.resolve(),
        };
        const listFn = this.listFn;
        token.promise = (async () => {
            try {
                const r = await listFn();
                if (!this.isCurrent(token)) return;
                // SAFETY: the oRPC list envelope's `data` is typed `unknown` by the JSONified
                // transport, but the contract handler always returns a task array under `data`.
                const tasks = (r.data as unknown as TaskSummary[]) ?? [];
                this.state = {
                    tasks,
                    subtaskProgress: deriveSubtaskProgress(tasks),
                    loading: false,
                    error: null,
                    connected: this.state.connected,
                    lastSyncAt: Date.now(),
                };
            } catch (e) {
                if (!this.isCurrent(token)) return;
                this.state = { ...this.state, loading: false, error: e as Error };
            }
            this.emit();
        })();
        this.activeRequest = token;
        void token.promise.finally(() => {
            if (this.activeRequest === token) this.activeRequest = null;
            const trailing = this.pendingRefresh;
            this.pendingRefresh = false;
            // The trailing run is a fresh look: it picks up whatever changed while
            // the previous request was in flight, so the last event is never lost.
            if (trailing && token.lifetime === this.lifetime) void this.refresh();
        });
        return token.promise;
    }

    setTasks = (updater: TaskSummary[] | ((prev: TaskSummary[]) => TaskSummary[])) => {
        const next = typeof updater === 'function' ? updater(this.state.tasks) : updater;
        this.state = {
            ...this.state,
            tasks: next,
            subtaskProgress: deriveSubtaskProgress(next),
            lastSyncAt: Date.now(),
        };
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
    private async connectSSE(): Promise<void> {
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

/** The active board store; descendants keep using the no-argument `useTasks()` hook. */
export const TaskStoreContext = createContext<TaskStore | null>(null);

let _sharedStore: TaskStore | null = null;
function getSharedStore(): TaskStore {
    if (!_sharedStore) _sharedStore = new TaskStore();
    return _sharedStore;
}

/**
 * Derive a subtask-progress map from the loaded tasks (F72 R1): group children by
 * `parentWbs`, count `status === 'done'` per group. Tasks with an absent `parentWbs`
 * join no group. The store computes it when task state changes, never once per card.
 */
export function deriveSubtaskProgress(tasks: TaskSummary[]): Map<string, SubtaskProgress> {
    const map = new Map<string, SubtaskProgress>();
    for (const t of tasks) {
        if (!t.parentWbs) continue;
        const entry = map.get(t.parentWbs) ?? { done: 0, total: 0 };
        entry.total += 1;
        if (t.status === 'done') entry.done += 1;
        map.set(t.parentWbs, entry);
    }
    return map;
}

/**
 * Hook for task data with SSE stream + polling fallback.
 *
 * The SSE stream (GET /api/events/planning) triggers an immediate refresh
 * on any planning event. The 5s polling interval runs in parallel as a
 * safety net — if the stream drops, the board stays fresh from polling
 * and the store's `connected` flag reflects the stream state.
 *
 * Returns tasks/loading/error/connected plus `setTasks`, and the F72 derived
 * `subtaskProgress` map (computed once per store update). Without a `listFn`,
 * callers use the nearest board-provided store, then fall back to the module
 * singleton. Pass `listFn` to own an isolated folder-switchable store.
 */
export function useTasks(listFn?: ListFn) {
    // With a listFn, use a stable isolated store kept for the hook's lifetime and
    // re-pointed via setListFn when listFn changes (e.g. folder switch) — this
    // avoids tearing down the SSE/poll connection on every change. Without one,
    // consume the nearest board store before falling back to the singleton.
    const inheritedStore = useContext(TaskStoreContext);
    const localStore = useRef<TaskStore | null>(null);
    if (listFn && !localStore.current) {
        localStore.current = new TaskStore(listFn);
    }
    const store = localStore.current ?? inheritedStore ?? getSharedStore();

    useEffect(() => {
        if (listFn && localStore.current) {
            localStore.current.setListFn(listFn);
        }
    }, [listFn]);

    const state = useSyncExternalStore(store.subscribe, store.getState);
    return { ...state, setTasks: store.setTasks, store };
}
