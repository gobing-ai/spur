import { useEffect, useState } from 'react';
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

/**
 * Polling hook for task data. The `list` contract takes no query input, so the full task list is
 * polled and filtering happens client-side in the board. The SSE swap (W6 usePlanningEvents) is a
 * drop-in that feeds the same `setTasks` reducer — this is invariant #10.
 *
 * Accepts an optional `listFn` for dependency injection in tests.
 */
export function useTasks(listFn: ListFn = defaultListTasks) {
    const [tasks, setTasks] = useState<TaskSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        const refresh = createRefresh(listFn, setTasks, setError, setLoading);
        void refresh();
        const interval = setInterval(refresh, POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [listFn]);

    return { tasks, loading, error, setTasks };
}
