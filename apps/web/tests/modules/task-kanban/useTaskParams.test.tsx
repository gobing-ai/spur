registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { useTaskParams } from '../../../src/modules/task-kanban/useTaskParams';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

afterAll(teardownHappyDom);

afterEach(() => cleanup());

function wrapper(initialEntries: string[]) {
    return ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
    );
}

describe('useTaskParams', () => {
    test('parses selection from query string (legacy compat)', () => {
        const { result } = renderHook(() => useTaskParams(), {
            wrapper: wrapper([
                '/board/tasks?selected=0007&folder=docs%2Ftasks2&status=todo%2Cwip&feature=W3&parent=0001&assignee=robin',
            ]),
        });
        expect(result.current.selected).toBe('0007');
        expect(result.current.filters).toEqual({
            status: 'todo,wip',
            featureId: 'W3',
            parentWbs: '0001',
            assignee: 'robin',
            folder: 'docs/tasks2',
        });
    });

    test('parses selection from path segment (/board/tasks/0016)', () => {
        const { result } = renderHook(() => useTaskParams(), {
            wrapper: wrapper(['/board/tasks/0016']),
        });
        expect(result.current.selected).toBe('0016');
    });

    test('path segment takes priority over query param', () => {
        const { result } = renderHook(() => useTaskParams(), {
            wrapper: wrapper(['/board/tasks/0042?selected=0007']),
        });
        expect(result.current.selected).toBe('0042');
    });

    test('selectTask navigates to path-based URL and clears on null', () => {
        const { result } = renderHook(() => useTaskParams(), { wrapper: wrapper(['/board/tasks']) });
        act(() => result.current.selectTask('0042'));
        expect(result.current.selected).toBe('0042');
        act(() => result.current.selectTask(null));
        expect(result.current.selected).toBeNull();
    });

    test('setFilter reflects the value in the URL and clears on empty', () => {
        const { result } = renderHook(() => useTaskParams(), { wrapper: wrapper(['/board/tasks']) });
        act(() => result.current.setFilter('status', 'done'));
        expect(result.current.filters.status).toBe('done');
        act(() => result.current.setFilter('status', null));
        expect(result.current.filters.status).toBeUndefined();
    });

    test('feature and parent filters replace each other instead of intersecting', () => {
        const { result } = renderHook(() => useTaskParams(), {
            wrapper: wrapper(['/board/tasks?parent=0663.1']),
        });
        act(() => result.current.setFilter('feature', 'F72'));
        expect(result.current.filters).toEqual({ featureId: 'F72' });
        act(() => result.current.setFilter('feature', null));
        expect(result.current.filters).toEqual({});
    });

    test('preserves an explicitly empty status selection', () => {
        const { result } = renderHook(() => useTaskParams(), { wrapper: wrapper(['/board/tasks']) });
        act(() => result.current.setFilter('status', ''));
        expect(result.current.filters.status).toBe('');
    });
});
