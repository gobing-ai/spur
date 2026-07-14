registerHappyDom();

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import BoardLayout from '../../src/components/BoardLayout';
import { resetLayoutState } from '../../src/lib/layout-state';
import { registerHappyDom, teardownHappyDom } from '../happy-dom';

afterAll(teardownHappyDom);

function renderBoard(route = '/board/tasks') {
    return render(
        <MemoryRouter initialEntries={[route]}>
            <BoardLayout />
        </MemoryRouter>,
    );
}

describe('mobile responsive', () => {
    beforeEach(() => {
        localStorage.clear();
        resetLayoutState();
        document.documentElement.removeAttribute('data-theme');
    });

    afterEach(() => {
        cleanup();
    });

    test('mobile header bar renders with hamburger and panel toggle', () => {
        const { getByLabelText } = renderBoard();
        expect(getByLabelText('Open navigation')).toBeDefined();
        expect(getByLabelText('Open panel')).toBeDefined();
    });

    test('hamburger opens mobile sidebar drawer', () => {
        const { getByLabelText, container } = renderBoard();
        const boardLayout = container.querySelector('.board-layout');
        expect(boardLayout).toBeDefined();
        if (!boardLayout) return;
        expect(boardLayout.getAttribute('data-mobile-sidebar-open')).toBe('false');

        fireEvent.click(getByLabelText('Open navigation'));
        expect(boardLayout.getAttribute('data-mobile-sidebar-open')).toBe('true');
    });

    test('panel button opens mobile bottom sheet', () => {
        const { getByLabelText, container } = renderBoard();
        const boardLayout = container.querySelector('.board-layout');
        expect(boardLayout).toBeDefined();
        if (!boardLayout) return;
        expect(boardLayout.getAttribute('data-mobile-panel-open')).toBe('false');

        fireEvent.click(getByLabelText('Open panel'));
        expect(boardLayout.getAttribute('data-mobile-panel-open')).toBe('true');
    });

    test('sidebar close button closes the drawer', () => {
        const { getByLabelText, container } = renderBoard();
        const boardLayout = container.querySelector('.board-layout');
        expect(boardLayout).toBeDefined();
        if (!boardLayout) return;

        fireEvent.click(getByLabelText('Open navigation'));
        expect(boardLayout.getAttribute('data-mobile-sidebar-open')).toBe('true');

        fireEvent.click(getByLabelText('Close navigation'));
        expect(boardLayout.getAttribute('data-mobile-sidebar-open')).toBe('false');
    });

    test('panel close button closes the bottom sheet', () => {
        const { getByLabelText, container } = renderBoard();
        const boardLayout = container.querySelector('.board-layout');
        expect(boardLayout).toBeDefined();
        if (!boardLayout) return;

        fireEvent.click(getByLabelText('Open panel'));
        expect(boardLayout.getAttribute('data-mobile-panel-open')).toBe('true');

        fireEvent.click(getByLabelText('Close panel'));
        expect(boardLayout.getAttribute('data-mobile-panel-open')).toBe('false');
    });

    test('backdrop closes both drawer and bottom sheet', async () => {
        const { getByLabelText, container } = renderBoard();
        const boardLayout = container.querySelector('.board-layout');
        expect(boardLayout).toBeDefined();
        if (!boardLayout) return;

        fireEvent.click(getByLabelText('Open navigation'));
        fireEvent.click(getByLabelText('Open panel'));
        expect(boardLayout.getAttribute('data-mobile-sidebar-open')).toBe('true');
        expect(boardLayout.getAttribute('data-mobile-panel-open')).toBe('true');

        const backdrop = container.querySelector('.fixed.inset-0');
        expect(backdrop).toBeDefined();
        const backdropEl = backdrop as Element;

        fireEvent.click(backdropEl);

        await waitFor(() => {
            expect(boardLayout.getAttribute('data-mobile-sidebar-open')).toBe('false');
            expect(boardLayout.getAttribute('data-mobile-panel-open')).toBe('false');
        });
    });
});

describe('dark mode', () => {
    beforeEach(() => {
        localStorage.clear();
        resetLayoutState();
        document.documentElement.removeAttribute('data-theme');
    });

    afterEach(() => {
        cleanup();
    });

    test('mobile header shows active module name', () => {
        const { container } = renderBoard('/board/tasks');
        const mobileBar = container.querySelector('.mobile-bar');
        expect(mobileBar).toBeDefined();
        expect(mobileBar?.textContent).toContain('Tasks');
    });

    test('clicking theme toggle switches from light to dark', async () => {
        const { getByLabelText } = renderBoard();
        const toggle = getByLabelText('Switch to dark mode');

        fireEvent.click(toggle);

        await waitFor(() => {
            expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
            expect(localStorage.getItem('spur-theme')).toBe('dark');
        });
    });

    test('clicking theme toggle switches from dark to light', async () => {
        // Pre-set dark theme
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('spur-theme', 'dark');

        const { getByLabelText } = renderBoard();
        const toggle = getByLabelText('Switch to light mode');

        fireEvent.click(toggle);

        await waitFor(() => {
            expect(document.documentElement.getAttribute('data-theme')).toBe('light');
            expect(localStorage.getItem('spur-theme')).toBe('light');
        });
    });

    test('theme persists across re-renders', async () => {
        const { getByLabelText, unmount } = renderBoard();
        const toggle = getByLabelText('Switch to dark mode');
        fireEvent.click(toggle);

        await waitFor(() => {
            expect(localStorage.getItem('spur-theme')).toBe('dark');
        });

        unmount();
        cleanup();

        // Re-render — should restore from localStorage
        const { getByLabelText: getToggle } = renderBoard();
        expect(getToggle('Switch to light mode')).toBeDefined();
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
});

describe('prefers-color-scheme', () => {
    beforeEach(() => {
        localStorage.clear();
        resetLayoutState();
        document.documentElement.removeAttribute('data-theme');
    });

    afterEach(() => {
        cleanup();
        // @ts-expect-error reset matchMedia
        globalThis.matchMedia = undefined;
    });

    test('first load with prefers-color-scheme: dark activates dark mode', () => {
        globalThis.matchMedia = ((query: string) => ({
            matches: query === '(prefers-color-scheme: dark)',
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
        })) as typeof window.matchMedia;

        const { getByLabelText } = renderBoard();
        // The FOUC-prevention script doesn't run in tests, so data-theme isn't set on <html>.
        // The component resolves the correct theme and shows the right toggle label.
        expect(getByLabelText('Switch to light mode')).toBeDefined();
    });
});
