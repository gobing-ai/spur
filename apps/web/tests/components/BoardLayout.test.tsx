import { GlobalRegistrator } from '@happy-dom/global-registrator';

// Register a DOM BEFORE React / testing-library import. Bun runs every test file in one process, so
// the matching afterAll unregister restores the real fetch/localStorage for the lib/ suites.
GlobalRegistrator.register();

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/react';
import BoardLayout from '../../src/components/BoardLayout';
import { resetLayoutState } from '../../src/lib/layout-state';

describe('BoardLayout', () => {
    afterAll(async () => {
        await GlobalRegistrator.unregister();
    });

    beforeEach(() => {
        localStorage.clear();
        resetLayoutState();
    });

    afterEach(() => {
        cleanup();
        localStorage.clear();
    });

    test('renders with the sidebar expanded and right panel collapsed by default', () => {
        const { container } = render(<BoardLayout />);
        const root = container.querySelector('.board-layout');
        expect(root?.getAttribute('data-sidebar-collapsed')).toBe('false');
        expect(root?.getAttribute('data-rightpanel-collapsed')).toBe('true');
    });

    test('collapse toggle flips data-sidebar-collapsed and persists', () => {
        const { container, getByLabelText } = render(<BoardLayout />);
        const root = container.querySelector('.board-layout');
        expect(root?.getAttribute('data-sidebar-collapsed')).toBe('false');

        fireEvent.click(getByLabelText('Collapse sidebar'));

        expect(root?.getAttribute('data-sidebar-collapsed')).toBe('true');
        const persisted = JSON.parse(localStorage.getItem('spur-board-layout') ?? '{}');
        expect(persisted.sidebarCollapsed).toBe(true);
    });

    test('right panel toggle expands the panel and persists', () => {
        const { container, getByLabelText } = render(<BoardLayout />);
        const root = container.querySelector('.board-layout');
        expect(root?.getAttribute('data-rightpanel-collapsed')).toBe('true');

        fireEvent.click(getByLabelText('Expand panel'));

        expect(root?.getAttribute('data-rightpanel-collapsed')).toBe('false');
        const persisted = JSON.parse(localStorage.getItem('spur-board-layout') ?? '{}');
        expect(persisted.rightPanelCollapsed).toBe(false);
    });

    test('restores persisted collapse state on mount', () => {
        localStorage.setItem(
            'spur-board-layout',
            JSON.stringify({
                sidebarWidth: 200,
                rightPanelWidth: 300,
                sidebarCollapsed: true,
                rightPanelCollapsed: false,
            }),
        );
        const { container } = render(<BoardLayout />);
        const root = container.querySelector('.board-layout');
        expect(root?.getAttribute('data-sidebar-collapsed')).toBe('true');
        expect(root?.getAttribute('data-rightpanel-collapsed')).toBe('false');
    });

    test('dragging the sidebar handle updates the CSS var and persists sidebarWidth on pointer up', () => {
        const { container } = render(<BoardLayout />);
        const handle = container.querySelectorAll('.resize-handle')[0] as HTMLElement;
        expect(handle).toBeTruthy();
        // happy-dom needs setPointerCapture stubbed.
        handle.setPointerCapture = () => {};

        fireEvent.pointerDown(handle, { clientX: 240, pointerId: 1 });
        fireEvent(window, new window.PointerEvent('pointermove', { clientX: 300 }));
        document.documentElement.style.setProperty('--sidebar-w', '300px');
        fireEvent(window, new window.PointerEvent('pointerup', {}));

        const persisted = JSON.parse(localStorage.getItem('spur-board-layout') ?? '{}');
        expect(persisted.sidebarWidth).toBe(300);
    });

    test('dragging the right-panel handle persists rightPanelWidth on pointer up', () => {
        const { container, getByLabelText } = render(<BoardLayout />);
        // Right panel is collapsed by default; expand so its handle is interactive.
        fireEvent.click(getByLabelText('Expand panel'));
        const handle = container.querySelectorAll('.resize-handle')[1] as HTMLElement;
        expect(handle).toBeTruthy();
        handle.setPointerCapture = () => {};

        fireEvent.pointerDown(handle, { clientX: 320, pointerId: 1 });
        fireEvent(window, new window.PointerEvent('pointermove', { clientX: 380 }));
        document.documentElement.style.setProperty('--rightpanel-w', '380px');
        fireEvent(window, new window.PointerEvent('pointerup', {}));

        const persisted = JSON.parse(localStorage.getItem('spur-board-layout') ?? '{}');
        expect(persisted.rightPanelWidth).toBe(380);
    });
});
