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
        const { result } = renderHook(() => useProjectTab(), { wrapper: wrapper(['/board/projects/fleet']) });
        expect(result.current.activeTab).toBe('fleet');
        const legacy = renderHook(() => useProjectTab(), { wrapper: wrapper(['/board/projects/processes']) });
        expect(legacy.result.current.activeTab).toBe('fleet');
        const inbox = renderHook(() => useProjectTab(), { wrapper: wrapper(['/board/projects/inbox']) });
        expect(inbox.result.current.activeTab).toBe('inbox');
        const legacyConv = renderHook(() => useProjectTab(), {
            wrapper: wrapper(['/board/projects/conversation']),
        });
        expect(legacyConv.result.current.activeTab).toBe('inbox');
    });

    test('missing or unknown segment falls back to the default tab', () => {
        const none = renderHook(() => useProjectTab(), { wrapper: wrapper(['/board/projects']) });
        expect(none.result.current.activeTab).toBe('fleet');
        const unknown = renderHook(() => useProjectTab(), { wrapper: wrapper(['/board/projects/bogus']) });
        expect(unknown.result.current.activeTab).toBe('fleet');
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
                { initialEntries: ['/board/projects/inbox?feature=G63'] },
                createElement(Routes, null, createElement(Route, { path: '*', element: createElement(TabProbe) })),
            ),
        );
        expect(tabHook?.activeTab).toBe('inbox');
        act(() => tabHook?.selectTab('fleet'));
        expect(tabHook?.activeTab).toBe('fleet');
        expect(loc?.pathname).toBe('/board/projects/fleet');
        expect(loc?.search).toBe('?feature=G63');
    });
});
