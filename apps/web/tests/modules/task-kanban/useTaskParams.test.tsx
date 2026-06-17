import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { useTaskParams } from '../../../src/modules/task-kanban/useTaskParams';

afterAll(async () => {
    await GlobalRegistrator.unregister();
});

afterEach(() => cleanup());

function wrapper(initialEntries: string[]) {
    return ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
    );
}

describe('useTaskParams', () => {
    test('parses selection and filters out of the query string', () => {
        const { result } = renderHook(() => useTaskParams(), {
            wrapper: wrapper(['/board/tasks?selected=0007&status=wip&feature=W3&parent=0001&assignee=robin']),
        });
        expect(result.current.selected).toBe('0007');
        expect(result.current.filters).toEqual({
            status: 'wip',
            featureId: 'W3',
            parentWbs: '0001',
            assignee: 'robin',
        });
    });

    test('selectTask writes ?selected and clears it on null', () => {
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
});
