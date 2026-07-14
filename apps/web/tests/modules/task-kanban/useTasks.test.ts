registerHappyDom();

import { afterAll, describe, expect, test } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { TaskSummary } from '../../../src/modules/task-kanban/types';
import { createRefresh, TaskStore, useTasks } from '../../../src/modules/task-kanban/useTasks';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

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
    afterAll(teardownHappyDom);

    test('loads tasks from listFn', async () => {
        const listFn = async () => ({ data: [] });
        const { result } = renderHook(() => useTasks(listFn));
        await waitFor(() => expect(result.current.loading).toBe(false));
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

    test('changing listFn re-fetches from the new source without remounting the store', async () => {
        // Folder switch: the store is kept (no SSE/poll teardown) and re-pointed
        // at the new listFn, so the board reflects the newly chosen folder.
        const folderA: TaskSummary[] = [{ wbs: '0001', name: 'A task', status: 'todo', filePath: '/a/0001.md' }];
        const folderB: TaskSummary[] = [{ wbs: '0002', name: 'B task', status: 'todo', filePath: '/b/0002.md' }];
        const listA = async () => ({ data: folderA });
        const listB = async () => ({ data: folderB });

        const { result, rerender, unmount } = renderHook(({ fn }) => useTasks(fn), { initialProps: { fn: listA } });
        await waitFor(() => expect(result.current.tasks).toEqual(folderA));

        rerender({ fn: listB });
        await waitFor(() => expect(result.current.tasks).toEqual(folderB));
        unmount();
    });
});

describe('TaskStore SSE callbacks', () => {
    test('handleSSEOpen sets connected=true and emits', () => {
        const listFn = async () => ({ data: [] });
        const store = new TaskStore(listFn);
        const result = { notified: false };
        store.subscribe(() => {
            result.notified = true;
        });
        // biome-ignore lint/complexity/useLiteralKeys: access private method for testing
        store['handleSSEOpen']();
        expect(store.getState().connected).toBe(true);
        expect(result.notified).toBe(true);
    });

    test('handleSSEMessage triggers refresh', async () => {
        let called = false;
        const listFn = async () => {
            called = true;
            return { data: [] };
        };
        const store = new TaskStore(listFn);
        // biome-ignore lint/complexity/useLiteralKeys: access private method for testing
        store['handleSSEMessage']();

        // refresh is async; wait one microtick
        await new Promise((r) => setTimeout(r, 10));
        expect(called).toBe(true);
    });

    test('handleSSEError sets connected=false and emits', () => {
        const listFn = async () => ({ data: [] });
        const store = new TaskStore(listFn);
        const result = { notified: false };
        store.subscribe(() => {
            result.notified = true;
        });
        // biome-ignore lint/complexity/useLiteralKeys: access private method for testing
        store['handleSSEError']();
        expect(store.getState().connected).toBe(false);
        expect(result.notified).toBe(true);
    });

    test('setListFn swaps the source and refreshes; same fn is a no-op', async () => {
        const first: TaskSummary[] = [{ wbs: '0001', name: 'First', status: 'todo', filePath: '/f/0001.md' }];
        const second: TaskSummary[] = [{ wbs: '0002', name: 'Second', status: 'todo', filePath: '/s/0002.md' }];
        const listFirst = async () => ({ data: first });
        const store = new TaskStore(listFirst);

        let refreshCalls = 0;
        const listSecond = async () => {
            refreshCalls++;
            return { data: second };
        };
        store.setListFn(listSecond);
        // refresh is async; wait one microtick (matches the SSE-callback tests —
        // this block runs after useTasks' afterAll has torn down the DOM, so no
        // DOM-dependent waitFor here).
        await new Promise((r) => setTimeout(r, 10));
        expect(store.getState().tasks).toEqual(second);
        expect(refreshCalls).toBe(1);

        // Passing the identical fn must not trigger another refresh.
        store.setListFn(listSecond);
        await new Promise((r) => setTimeout(r, 10));
        expect(refreshCalls).toBe(1);
    });
});
