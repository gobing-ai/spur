registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { useSettingsTab } from '../../../src/modules/settings/useSettingsTab';
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

describe('useSettingsTab', () => {
    test('parses the active tab from the path segment after settings', () => {
        const { result } = renderHook(() => useSettingsTab(), { wrapper: wrapper(['/board/settings/agents']) });
        expect(result.current.activeTab).toBe('agents');
        const gen = renderHook(() => useSettingsTab(), { wrapper: wrapper(['/board/settings/general']) });
        expect(gen.result.current.activeTab).toBe('general');
    });

    test('missing or unknown segment falls back to the default tab', () => {
        const none = renderHook(() => useSettingsTab(), { wrapper: wrapper(['/board/settings']) });
        expect(none.result.current.activeTab).toBe('general');
        const unknown = renderHook(() => useSettingsTab(), { wrapper: wrapper(['/board/settings/bogus']) });
        expect(unknown.result.current.activeTab).toBe('general');
    });

    test('selectTab navigates to the tab route preserving the query string', () => {
        let tabHook: ReturnType<typeof useSettingsTab> | undefined;
        let loc: { pathname: string; search: string } | undefined;
        function TabProbe() {
            tabHook = useSettingsTab();
            const location = useLocation();
            loc = { pathname: location.pathname, search: location.search };
            return null;
        }
        render(
            createElement(
                MemoryRouter,
                { initialEntries: ['/board/settings/agents?theme=dark'] },
                createElement(Routes, null, createElement(Route, { path: '*', element: createElement(TabProbe) })),
            ),
        );
        expect(tabHook?.activeTab).toBe('agents');
        act(() => tabHook?.selectTab('agents'));
        expect(tabHook?.activeTab).toBe('agents');
        expect(loc?.pathname).toBe('/board/settings/agents');
        expect(loc?.search).toBe('?theme=dark');
    });
});
