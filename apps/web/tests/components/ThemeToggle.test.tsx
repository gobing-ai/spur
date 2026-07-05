import { GlobalRegistrator } from '@happy-dom/global-registrator';

try {
    GlobalRegistrator.register();
} catch {
    /* already registered */
}

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import ThemeToggle from '../../src/components/ThemeToggle';
import { teardownHappyDom } from '../happy-dom';

afterAll(teardownHappyDom);

type MatchMediaHandler = (e: MediaQueryListEvent) => void;

/** Build a controllable matchMedia mock that records the change listener. */
function mockMatchMedia(initialDark = false) {
    const listeners: MatchMediaHandler[] = [];
    const mql = {
        matches: initialDark,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addEventListener: (_ev: string, fn: MatchMediaHandler) => listeners.push(fn),
        removeEventListener: (_ev: string, fn: MatchMediaHandler) => {
            const i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
        },
        dispatchEvent: () => false,
        addListener: () => {},
        removeListener: () => {},
    };
    const trigger = (nowDark: boolean) => {
        for (const fn of listeners) fn({ matches: nowDark, media: mql.media } as MediaQueryListEvent);
    };
    return { mql, trigger };
}

describe('ThemeToggle system-preference sync', () => {
    beforeEach(() => {
        localStorage.clear();
        document.documentElement.removeAttribute('data-theme');
    });

    afterEach(() => {
        cleanup();
        // @ts-expect-error reset matchMedia between tests
        globalThis.matchMedia = undefined;
    });

    test('follows system preference change when no stored theme', () => {
        const { mql, trigger } = mockMatchMedia(false);
        // @ts-expect-error install matchMedia mock
        globalThis.matchMedia = () => mql;

        render(<ThemeToggle />);
        act(() => trigger(true));
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    test('ignores system preference change when a theme is stored', () => {
        const { mql, trigger } = mockMatchMedia(false);
        // @ts-expect-error install matchMedia mock
        globalThis.matchMedia = () => mql;
        localStorage.setItem('spur-theme', 'light');

        render(<ThemeToggle />);
        act(() => trigger(true));
        // Stored light wins; system dark does not override.
        expect(document.documentElement.getAttribute('data-theme')).not.toBe('dark');
    });

    test('removes the change listener on unmount', () => {
        const { mql, trigger } = mockMatchMedia(false);
        // @ts-expect-error install matchMedia mock
        globalThis.matchMedia = () => mql;

        const { unmount } = render(<ThemeToggle />);
        unmount();
        act(() => trigger(true));
        expect(document.documentElement.getAttribute('data-theme')).not.toBe('dark');
    });
});
