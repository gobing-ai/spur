import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

import { afterAll, describe, expect, test } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { TaskSummary } from '../../../src/modules/task-kanban/types';
import { createRefresh, useTasks } from '../../../src/modules/task-kanban/useTasks';

describe('createRefresh', () => {
    test('success: sets tasks and clears error', async () => {
        const items: TaskSummary[] = [{ wbs: '0001', name: 'Test', status: 'todo', filePath: '/t/0001.md' }];
        const listFn = async () => ({ data: items });
        let tasks: TaskSummary[] = [];
        let error: Error | null = null;
        let loading = true;
        const refresh = createRefresh(
            listFn,
            (v) => {
                tasks = typeof v === 'function' ? v([]) : v;
            },
            (e) => {
                error = e;
            },
            (l) => {
                loading = l;
            },
        );
        await refresh();
        expect(tasks).toEqual(items);
        expect(error).toBeNull();
        expect(loading).toBe(false);
    });

    test('failure: sets error', async () => {
        const listFn = async () => {
            throw new Error('boom');
        };
        let error: Error | null = null;
        let loading = true;
        const refresh = createRefresh(
            listFn,
            () => {},
            (e) => {
                error = e;
            },
            (l) => {
                loading = l;
            },
        );
        await refresh();
        expect((error as Error | null)?.message).toBe('boom');
        expect(loading).toBe(false);
    });
});

describe('useTasks', () => {
    afterAll(async () => {
        await GlobalRegistrator.unregister();
    });

    test('starts in loading state with empty tasks', () => {
        const listFn = async () => ({ data: [] });
        const { result } = renderHook(() => useTasks(listFn));
        expect(result.current.loading).toBe(true);
        expect(result.current.tasks).toEqual([]);
        expect(result.current.error).toBeNull();
    });

    test('loads tasks on mount', async () => {
        const items: TaskSummary[] = [{ wbs: '0001', name: 'Test', status: 'todo', filePath: '/t/0001.md' }];
        const listFn = async () => ({ data: items });
        const { result, unmount } = renderHook(() => useTasks(listFn));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.tasks).toEqual(items);
        unmount(); // triggers useEffect cleanup (covers clearInterval)
    });

    test('sets error on fetch failure', async () => {
        const listFn = async () => {
            throw new Error('Network error');
        };
        const { result } = renderHook(() => useTasks(listFn));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect((result.current.error as Error | null)?.message).toBe('Network error');
    });

    test('setTasks allows optimistic updates', async () => {
        const items: TaskSummary[] = [{ wbs: '0001', name: 'Test', status: 'todo', filePath: '/t/0001.md' }];
        const listFn = async () => ({ data: items });
        const { result } = renderHook(() => useTasks(listFn));
        await waitFor(() => expect(result.current.loading).toBe(false));
        const item = items[0] as TaskSummary;
        const updated: TaskSummary = {
            wbs: item.wbs,
            name: item.name,
            status: 'done',
            filePath: item.filePath,
        };
        act(() => {
            result.current.setTasks([updated]);
        });
        expect(result.current.tasks[0]?.status).toBe('done');
    });

    test('connected starts as false when EventSource is unavailable', () => {
        const listFn = async () => ({ data: [] });
        const { result } = renderHook(() => useTasks(listFn));
        expect(result.current.connected).toBe(false);
    });

    test('connected is present in return value with custom listFn', async () => {
        const items: TaskSummary[] = [{ wbs: '0001', name: 'Test', status: 'todo', filePath: '/t/0001.md' }];
        const listFn = async () => ({ data: items });
        const { result, unmount } = renderHook(() => useTasks(listFn));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.connected).toBe(false);
        unmount();
    });
});
