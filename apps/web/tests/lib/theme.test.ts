registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { applyTheme, resolveTheme, toggleTheme } from '../../src/lib/theme';
import { registerHappyDom, teardownHappyDom } from '../happy-dom';

afterAll(teardownHappyDom);

function mockMatchMedia(matchesDark: boolean) {
    globalThis.matchMedia = ((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)' ? matchesDark : false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    })) as typeof window.matchMedia;
}

function restoreMatchMedia() {
    // @ts-expect-error reset
    globalThis.matchMedia = undefined;
}

function clearTheme() {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    restoreMatchMedia();
}

describe('resolveTheme', () => {
    afterEach(clearTheme);

    test('returns stored dark when localStorage has dark', () => {
        localStorage.setItem('spur-theme', 'dark');
        expect(resolveTheme()).toBe('dark');
    });

    test('returns stored light when localStorage has light', () => {
        localStorage.setItem('spur-theme', 'light');
        expect(resolveTheme()).toBe('light');
    });

    test('returns dark when prefers-color-scheme is dark and no stored value', () => {
        mockMatchMedia(true);
        expect(resolveTheme()).toBe('dark');
    });

    test('returns light when prefers-color-scheme is light and no stored value', () => {
        mockMatchMedia(false);
        expect(resolveTheme()).toBe('light');
    });

    test('ignores corrupt stored value and falls back to system pref', () => {
        localStorage.setItem('spur-theme', 'invalid');
        mockMatchMedia(true);
        expect(resolveTheme()).toBe('dark');
    });
});

describe('applyTheme', () => {
    afterEach(clearTheme);

    test('sets data-theme on html element', () => {
        applyTheme('dark');
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    test('persists theme to localStorage', () => {
        applyTheme('light');
        expect(localStorage.getItem('spur-theme')).toBe('light');
    });

    test('overwrites previous theme', () => {
        applyTheme('dark');
        applyTheme('light');
        expect(document.documentElement.getAttribute('data-theme')).toBe('light');
        expect(localStorage.getItem('spur-theme')).toBe('light');
    });
});

describe('toggleTheme', () => {
    afterEach(clearTheme);

    test('toggles from dark to light', () => {
        applyTheme('dark');
        const next = toggleTheme('dark');
        expect(next).toBe('light');
        expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    test('toggles from light to dark', () => {
        applyTheme('light');
        const next = toggleTheme('light');
        expect(next).toBe('dark');
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
});
