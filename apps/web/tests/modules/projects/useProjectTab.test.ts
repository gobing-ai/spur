registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { useProjectTab } from '../../../src/modules/projects/useProjectTab';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

afterAll(teardownHappyDom);

afterEach(() => cleanup());

function wrapper(initialEntries: string[]) {
    return ({ children }: { children: ReactNode }) =>
        createElement(
            MemoryRouter,
            { initialEntries },
            createElement(Routes, null, createElement(Route, { path: '*', element: children as never })),
        );
}

describe('useProjectTab (0840 R3)', () => {
    test('parses the active tab from the path segment after projects', () => {
        const { result } = renderHook(() => useProjectTab(), { wrapper: wrapper(['/board/projects/processes']) });
        expect(result.current.activeTab).toBe('processes');
    });

    test('missing or unknown segment falls back to the default tab', () => {
        const none = renderHook(() => useProjectTab(), { wrapper: wrapper(['/board/projects']) });
        expect(none.result.current.activeTab).toBe('conversation');
        const unknown = renderHook(() => useProjectTab(), { wrapper: wrapper(['/board/projects/bogus']) });
        expect(unknown.result.current.activeTab).toBe('conversation');
    });

    test('selectTab navigates to the tab route preserving the query string', () => {
        let tabHook: ReturnType<typeof useProjectTab> | undefined;
        let loc: { pathname: string; search: string } | undefined;
        function TabProbe() {
            tabHook = useProjectTab();
            const location = useLocation();
            loc = { pathname: location.pathname, search: location.search };
            return null;
        }
        render(
            createElement(
                MemoryRouter,
                { initialEntries: ['/board/projects/conversation?feature=G63'] },
                createElement(Routes, null, createElement(Route, { path: '*', element: createElement(TabProbe) })),
            ),
        );
        expect(tabHook?.activeTab).toBe('conversation');
        act(() => tabHook?.selectTab('processes'));
        expect(tabHook?.activeTab).toBe('processes');
        expect(loc?.pathname).toBe('/board/projects/processes');
        expect(loc?.search).toBe('?feature=G63');
    });
});
