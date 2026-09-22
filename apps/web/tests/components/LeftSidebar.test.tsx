registerHappyDom();

import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import LeftSidebar from '../../src/components/LeftSidebar';
import { resetFetchForTesting, setFetchForTesting } from '../../src/lib/rpc-client';
import { registerHappyDom, teardownHappyDom } from '../happy-dom';

afterAll(async () => {
    resetFetchForTesting();
    await teardownHappyDom();
});

afterEach(() => {
    cleanup();
    resetFetchForTesting();
});

function silentProjectFetch(): void {
    setFetchForTesting(
        (async (_input: RequestInfo | URL, _init?: RequestInit) =>
            new Response(JSON.stringify({ name: null }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })) as typeof fetch,
    );
}

function renderSidebar(collapsed = false, onToggle: () => void = () => {}) {
    return render(
        <MemoryRouter>
            <LeftSidebar collapsed={collapsed} onToggle={onToggle} />
        </MemoryRouter>,
    );
}

describe('LeftSidebar project name', () => {
    test('shows the project name returned by /api/project instead of Modules', async () => {
        setFetchForTesting(
            (async (_input: RequestInfo | URL, _init?: RequestInit) =>
                new Response(JSON.stringify({ name: 'spur-new' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                })) as typeof fetch,
        );

        const { getByText, queryByText } = renderSidebar();

        await waitFor(() => expect(getByText('spur-new')).toBeTruthy());
        expect(queryByText('Modules')).toBeNull();
    });

    test('falls back to Modules when the fetch fails', async () => {
        setFetchForTesting((async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
            throw new Error('offline');
        }) as typeof fetch);

        const { getByText } = renderSidebar();

        // Fallback must be visible immediately and stay after the rejected fetch settles.
        expect(getByText('Modules')).toBeTruthy();
        await waitFor(() => expect(getByText('Modules')).toBeTruthy());
    });

    test('falls back to Modules when the server reports no project (null name)', async () => {
        setFetchForTesting(
            (async (_input: RequestInfo | URL, _init?: RequestInit) =>
                new Response(JSON.stringify({ name: null }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                })) as typeof fetch,
        );

        const { getByText } = renderSidebar();

        await waitFor(() => expect(getByText('Modules')).toBeTruthy());
    });
});

describe('LeftSidebar fold / unfold controls', () => {
    test('collapsed rail exposes project switcher at top and expand control in footer', () => {
        silentProjectFetch();
        const onToggle = mock(() => {});
        const { getByTestId, queryByTestId, getByLabelText } = renderSidebar(true, onToggle);

        // Top slot has the project switcher and avatar
        expect(getByTestId('project-switcher-trigger')).toBeTruthy();
        expect(getByTestId('project-avatar-icon')).toBeTruthy();

        // Footer houses the expand control as the 3rd icon
        const footer = getByTestId('sidebar-footer');
        expect(footer).toBeTruthy();
        const expandBtn = getByTestId('sidebar-expand');
        expect(footer.contains(expandBtn)).toBe(true);
        expect(queryByTestId('sidebar-collapse')).toBeNull();
        expect(getByLabelText('Expand sidebar')).toBeTruthy();

        fireEvent.click(expandBtn);
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    test('expanded sidebar exposes collapse control in footer as third icon', () => {
        silentProjectFetch();
        const onToggle = mock(() => {});
        const { getByTestId, queryByTestId, getByLabelText, container } = renderSidebar(false, onToggle);

        // Collapse control lives in sidebar-footer
        const footer = getByTestId('sidebar-footer');
        expect(footer).toBeTruthy();
        const collapseBtn = getByTestId('sidebar-collapse');
        expect(footer.contains(collapseBtn)).toBe(true);
        expect(queryByTestId('sidebar-expand')).toBeNull();
        expect(getByLabelText('Collapse sidebar')).toBeTruthy();

        // Theme toggle and settings also live in sidebar-footer
        const theme = getByLabelText(/Switch to (light|dark) mode/);
        expect(footer.contains(theme)).toBe(true);
        expect(footer.contains(getByTestId('sidebar-settings'))).toBe(true);

        // Title still present so the header is not icon-only when expanded
        expect(container.querySelector('aside span.font-semibold')).toBeTruthy();

        fireEvent.click(collapseBtn);
        expect(onToggle).toHaveBeenCalledTimes(1);
    });
});

describe('LeftSidebar footer and settings navigation', () => {
    test('renders footer with ThemeToggle, SettingsButton, and SidebarFoldButton in expanded state', () => {
        silentProjectFetch();
        const { getByTestId, getByLabelText, getAllByLabelText } = renderSidebar(false);
        const footer = getByTestId('sidebar-footer');
        expect(footer).toBeTruthy();
        expect(getByTestId('sidebar-settings')).toBeTruthy();
        expect(getByTestId('sidebar-collapse')).toBeTruthy();
        expect(getByLabelText('Open settings')).toBeTruthy();
        expect(getAllByLabelText(/Switch to (light|dark) mode/).length).toBe(1);
    });

    test('renders footer with ThemeToggle, SettingsButton, and SidebarFoldButton in collapsed state', () => {
        silentProjectFetch();
        const { getByTestId, getByLabelText, getAllByLabelText } = renderSidebar(true);
        const footer = getByTestId('sidebar-footer');
        expect(footer).toBeTruthy();
        expect(getByTestId('sidebar-settings')).toBeTruthy();
        expect(getByTestId('sidebar-expand')).toBeTruthy();
        expect(getByLabelText('Open settings')).toBeTruthy();
        expect(getAllByLabelText(/Switch to (light|dark) mode/).length).toBe(1);
    });

    test('renders SettingsButton as a navigation link pointing to /board/settings', () => {
        silentProjectFetch();
        const { getByTestId } = renderSidebar(false);
        const settingsLink = getByTestId('sidebar-settings');
        expect(settingsLink.getAttribute('href')).toBe('/board/settings');
    });
});

describe('LeftSidebar module ordering, labels, and tooltips', () => {
    test('renders modules in expected order with plural labels when expanded', () => {
        silentProjectFetch();
        const { container } = renderSidebar(false);
        const labels = Array.from(container.querySelectorAll('nav a span:last-child')).map((s) =>
            s.textContent?.trim(),
        );
        // 0849 R1: Workspace, Inbox, and Teams are retired — the five surviving modules keep
        // their declared order (observability 10, history 20, features 30, tasks 40, projects 45).
        expect(labels).toEqual(['Observabilities', 'Histories', 'Features', 'Tasks', 'Projects']);
    });

    test('collapsed nav items render tooltips with label and description', () => {
        silentProjectFetch();
        const { container } = renderSidebar(true);
        const tooltips = Array.from(container.querySelectorAll('nav .tooltip'));
        expect(tooltips.length).toBe(5);
        const firstTip = tooltips[0]?.getAttribute('data-tip');
        expect(firstTip).toContain(
            'Observabilities\nReal-time system events, execution traces, and agent doctor telemetry',
        );
    });
});
