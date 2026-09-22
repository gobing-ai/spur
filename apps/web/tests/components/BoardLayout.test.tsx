registerHappyDom();

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';
import BoardLayout from '../../src/components/BoardLayout';
import { resetLayoutState, STORAGE_KEY } from '../../src/lib/layout-state';
import { resetFetchForTesting, setFetchForTesting } from '../../src/lib/rpc-client';
import { modules } from '../../src/modules/registry';
import type { WebModule } from '../../src/modules/types';
import { createAppRouter, RETIRED_ROUTES, routes } from '../../src/router';
import { registerHappyDom, teardownHappyDom } from '../happy-dom';

/** The Tasks module is the contract for the kanban-board data-attribute assertions below. */
const TASKS_MODULE: WebModule | undefined = modules.find((m) => m.id === 'tasks');

// The router-wiring suite mounts the REAL Tasks module, whose KanbanBoard/useTasks fire
// `api.task.list` + `api.task.folders` on mount. Without intercept those become real fetches
// to `http://localhost:3000/api` (the no-origin fallback), which happy-dom blocks and logs as
// "Cross-Origin Request Blocked" — passing tests, but leaked stderr noise.
//
// We inject a mock fetch via setFetchForTesting (the rpc-client's test seam)
// rather than `mock.module('rpc-client')`: bun's module mocks are process-global
// and are NOT reverted by `mock.restore()`, so mocking the client here would
// leak into `lib/rpc-client.test.ts` (which sorts *after* this file and asserts
// the REAL client). The injection seam is file-local and fully reset in
// afterAll/afterEach via resetFetchForTesting. Spur API responses are oRPC
// envelopes; an empty-array `{}` body keeps the board mounting with zero rows.
const platformFetch = fetch.bind(globalThis);
function installSilentApiFetch(): void {
    setFetchForTesting((async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        // 0844: BoardLayout now mounts ProjectProvider + ConversationDraftProvider +
        // GlobalAgentBar, so these routes must serve well-formed fixtures. The old
        // `[]` catch-all parsed as a truthy fleet snapshot with no `orchestrator`
        // and crashed GlobalAgentBar mid-render. Shapes mirror AgentsView.test.tsx.
        if (url.includes('/api/project/fleet')) {
            return new Response(
                JSON.stringify({
                    path: '/repo/wt',
                    strategy: { name: 'gtd', version: 1 },
                    orchestrator: { state: 'bound-online', instanceId: 'orch' },
                    members: [],
                    capacity: { total: 0, enabled: 0, writeCapable: 0, missing: [] },
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            );
        }
        if (url.includes('/api/project/requests')) {
            return new Response(JSON.stringify({ requests: [] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        if (url.includes('/api/project')) {
            return new Response(JSON.stringify({ name: 'spur', path: '/repo/wt' }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        if (url.includes('/api/features/F/status')) {
            return new Response(JSON.stringify({ ok: true, data: { status: 'done' } }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        if (url.includes('/api/features/F/check')) {
            return new Response(
                JSON.stringify({
                    ok: true,
                    data: {
                        id: 'F',
                        status: 'active',
                        pass: false,
                        findings: [
                            {
                                layer: 'L2',
                                severity: 'warning',
                                section: 'Scope',
                                message: 'Clarify scope',
                            },
                        ],
                        requiredSections: ['Goal', 'Scope'],
                        missingSections: ['Risks'],
                    },
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            );
        }
        if (url.includes('/api/features/F')) {
            return new Response(
                JSON.stringify({
                    ok: true,
                    data: {
                        id: 'F',
                        name: 'Root',
                        status: 'active',
                        frontmatter: { owner: 'robin', priority: 'P1' },
                        filePath: 'docs/features/F.md',
                        content: [
                            '# F Root',
                            '',
                            '## Goal',
                            'Ship feature workflow.',
                            '',
                            '## Scope',
                            'Feature board and checks.',
                            '',
                            '## Acceptance Criteria',
                            '```gherkin',
                            'Given a feature',
                            'When it is opened',
                            'Then details render',
                            '```',
                        ].join('\n'),
                    },
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            );
        }
        if (url.includes('/api/features')) {
            return new Response(
                JSON.stringify({
                    ok: true,
                    data: [
                        { id: 'F', name: 'Root', status: 'active' },
                        { id: 'F1', name: 'Child', status: 'done' },
                    ],
                }),
                {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                },
            );
        }
        if (url.includes('/api/')) {
            return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return platformFetch(input as RequestInfo, init);
    }) as typeof fetch);
}

/** Settle lazy module + provider fetch chains inside act — happy-dom resolves bodies on macrotasks. */
async function settleInAct(): Promise<void> {
    await act(async () => {
        for (let tick = 0; tick < 10; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

async function renderBoard() {
    const view = render(
        <MemoryRouter initialEntries={['/board/board']}>
            <BoardLayout />
        </MemoryRouter>,
    );
    await settleInAct();
    return view;
}

// File-scoped teardown: reset the injected fetch, then unregister only after BOTH describe blocks
// finish, so the second suite still has a DOM (a describe-scoped afterAll would tear down
// happy-dom before the router suite runs).
afterAll(async () => {
    resetFetchForTesting();
    await teardownHappyDom();
});

describe('BoardLayout', () => {
    beforeEach(() => {
        installSilentApiFetch();
        localStorage.clear();
        resetLayoutState();
    });

    afterEach(() => {
        cleanup();
        resetFetchForTesting();
        localStorage.clear();
    });

    test('renders with the sidebar collapsed and right panel collapsed by default', async () => {
        const { container } = await renderBoard();
        const root = container.querySelector('.board-layout');
        expect(root?.getAttribute('data-sidebar-collapsed')).toBe('true');
        expect(root?.getAttribute('data-rightpanel-collapsed')).toBe('true');
    });

    test('keeps long module content inside the viewport-owned workspace scrollport in BoardLayout', async () => {
        const { container } = await renderBoard();
        const workspace = container.querySelector('main');
        const scrollport = Array.from(workspace?.children ?? []).find((child) =>
            child.classList.contains('overflow-auto'),
        );
        const layoutCss = await Bun.file(new URL('../../src/styles/board-layout.css', import.meta.url)).text();
        const documentRule = layoutCss.match(/html,\s*body\s*\{([^}]*)\}/)?.[1] ?? '';
        const rootRule = layoutCss.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '';

        expect(workspace?.classList.contains('h-full')).toBe(true);
        expect(workspace?.classList.contains('overflow-hidden')).toBe(true);
        expect(scrollport?.classList.contains('min-h-0')).toBe(true);
        expect(documentRule).toContain('overflow: hidden');
        expect(rootRule).toContain('--sidebar-w: 48px');
        expect(rootRule).toContain('--rightpanel-w: 0px');
    });

    test('collapse toggle flips data-sidebar-collapsed and persists', async () => {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                sidebarWidth: 240,
                rightPanelWidth: 320,
                sidebarCollapsed: false,
                rightPanelCollapsed: true,
            }),
        );
        const { container, getByLabelText } = await renderBoard();
        const root = container.querySelector('.board-layout');
        expect(root?.getAttribute('data-sidebar-collapsed')).toBe('false');

        fireEvent.click(getByLabelText('Collapse sidebar'));

        expect(root?.getAttribute('data-sidebar-collapsed')).toBe('true');
        const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        expect(persisted.sidebarCollapsed).toBe(true);
    });

    test('expand toggle restores data-sidebar-collapsed=false and persists', async () => {
        // Fold then unfold — both directions must work; expand was the broken path.
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                sidebarWidth: 240,
                rightPanelWidth: 320,
                sidebarCollapsed: true,
                rightPanelCollapsed: true,
            }),
        );
        const { container, getByTestId } = await renderBoard();
        const root = container.querySelector('.board-layout');
        expect(root?.getAttribute('data-sidebar-collapsed')).toBe('true');

        fireEvent.click(getByTestId('sidebar-expand'));

        expect(root?.getAttribute('data-sidebar-collapsed')).toBe('false');
        const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        expect(persisted.sidebarCollapsed).toBe(false);
        // Unfolded header must expose a collapse control (not only expand-when-folded).
        expect(getByTestId('sidebar-collapse')).toBeTruthy();
    });

    test('right panel toggle expands the panel and persists', async () => {
        const { container, getByLabelText } = await renderBoard();
        const root = container.querySelector('.board-layout');
        expect(root?.getAttribute('data-rightpanel-collapsed')).toBe('true');

        fireEvent.click(getByLabelText('Expand panel'));

        expect(root?.getAttribute('data-rightpanel-collapsed')).toBe('false');
        const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        expect(persisted.rightPanelCollapsed).toBe(false);
    });

    test('restores persisted collapse state on mount', async () => {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                sidebarWidth: 240,
                rightPanelWidth: 320,
                sidebarCollapsed: true,
                rightPanelCollapsed: false,
            }),
        );
        const { container } = await renderBoard();
        const root = container.querySelector('.board-layout');
        expect(root?.getAttribute('data-sidebar-collapsed')).toBe('true');
        expect(root?.getAttribute('data-rightpanel-collapsed')).toBe('false');
    });

    test('migrates legacy unversioned storage key to v3 and enforces folded sidebar default', async () => {
        localStorage.setItem(
            'spur-board-layout',
            JSON.stringify({
                sidebarWidth: 260,
                rightPanelWidth: 340,
                sidebarCollapsed: false,
                rightPanelCollapsed: true,
            }),
        );
        const { container } = await renderBoard();
        const root = container.querySelector('.board-layout');
        // Legacy sidebarCollapsed: false is overridden to true by migration
        expect(root?.getAttribute('data-sidebar-collapsed')).toBe('true');
        expect(root?.getAttribute('data-rightpanel-collapsed')).toBe('true');
        const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        expect(persisted.sidebarCollapsed).toBe(true);
        expect(persisted.sidebarWidth).toBe(260);
        expect(persisted.rightPanelWidth).toBe(340);
    });

    test('migrates v2 storage key to v3 and enforces folded sidebar default', async () => {
        localStorage.setItem(
            'spur-board-layout-v2',
            JSON.stringify({
                version: 2,
                sidebarWidth: 275,
                rightPanelWidth: 335,
                sidebarCollapsed: false,
                rightPanelCollapsed: true,
            }),
        );
        const { container } = await renderBoard();
        const root = container.querySelector('.board-layout');
        // V2 sidebarCollapsed: false is overridden to true by migration
        expect(root?.getAttribute('data-sidebar-collapsed')).toBe('true');
        expect(root?.getAttribute('data-rightpanel-collapsed')).toBe('true');
        const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        expect(persisted.sidebarCollapsed).toBe(true);
        expect(persisted.sidebarWidth).toBe(275);
        expect(persisted.rightPanelWidth).toBe(335);
        expect(localStorage.getItem('spur-board-layout-v2')).toBeNull();
    });

    test('dragging the sidebar handle updates the CSS var and persists sidebarWidth on pointer up', async () => {
        const { container } = await renderBoard();
        const handle = container.querySelectorAll('[data-testid^="resize-handle"]')[0] as HTMLElement;
        expect(handle).toBeDefined();
        // happy-dom needs setPointerCapture stubbed.
        handle.setPointerCapture = () => {};
        document.documentElement.style.setProperty('--sidebar-w', '240px');

        fireEvent.pointerDown(handle, { clientX: 240, pointerId: 1 });
        fireEvent(window, new window.PointerEvent('pointermove', { clientX: 300 }));
        fireEvent(window, new window.PointerEvent('pointerup', {}));

        // onMove writes the live var; onUp reads it back and persists.
        expect(document.documentElement.style.getPropertyValue('--sidebar-w')).toBe('300px');
        const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        expect(persisted.sidebarWidth).toBe(300);
    });

    test('dragging the right-panel handle persists rightPanelWidth on pointer up', async () => {
        const { container, getByLabelText } = await renderBoard();
        // Right panel is collapsed by default; expand so its handle is interactive.
        fireEvent.click(getByLabelText('Expand panel'));
        const handle = container.querySelectorAll('[data-testid^="resize-handle"]')[1] as HTMLElement;
        expect(handle).toBeDefined();
        handle.setPointerCapture = () => {};
        document.documentElement.style.setProperty('--rightpanel-w', '320px');

        fireEvent.pointerDown(handle, { clientX: 320, pointerId: 1 });
        fireEvent(window, new window.PointerEvent('pointermove', { clientX: 380 }));
        fireEvent(window, new window.PointerEvent('pointerup', {}));

        expect(document.documentElement.style.getPropertyValue('--rightpanel-w')).toBe('380px');
        const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        expect(persisted.rightPanelWidth).toBe(380);
    });

    test('single-backdrop invariant: mobile backdrop dismisses drawer and panel, and stylesheet contains no pseudo-scrim', async () => {
        const { getByLabelText, container } = await renderBoard();
        const root = container.querySelector('.board-layout');
        expect(root).toBeDefined();

        // Open mobile sidebar
        fireEvent.click(getByLabelText('Open navigation'));
        expect(root?.getAttribute('data-mobile-sidebar-open')).toBe('true');

        // Single backdrop element exists with aria-hidden="true" and fixed inset-0 z-40
        const backdrops = container.querySelectorAll('[aria-hidden="true"].fixed.inset-0');
        expect(backdrops.length).toBe(1);
        const firstBackdrop = backdrops[0];
        expect(firstBackdrop).toBeDefined();
        if (!firstBackdrop) return;
        expect(firstBackdrop.className).toContain('z-40');

        // Tapping backdrop dismisses the drawer
        fireEvent.click(firstBackdrop);
        expect(root?.getAttribute('data-mobile-sidebar-open')).toBe('false');

        // Open mobile panel
        fireEvent.click(getByLabelText('Open panel'));
        expect(root?.getAttribute('data-mobile-panel-open')).toBe('true');

        const panelBackdrop = container.querySelector('[aria-hidden="true"].fixed.inset-0');
        expect(panelBackdrop).toBeDefined();
        if (panelBackdrop) {
            fireEvent.click(panelBackdrop);
        }
        expect(root?.getAttribute('data-mobile-panel-open')).toBe('false');

        // Verify board-layout.css no longer declares pseudo-scrim ::before/::after
        const layoutCss = await Bun.file(new URL('../../src/styles/board-layout.css', import.meta.url)).text();
        expect(layoutCss).not.toContain('data-mobile-sidebar-open="true"]::before');
        expect(layoutCss).not.toContain('data-mobile-panel-open="true"]::after');
    });
});

describe('router + module wiring', () => {
    beforeEach(() => {
        installSilentApiFetch();
    });

    afterEach(() => {
        cleanup();
        resetFetchForTesting();
    });

    function renderAt(initialPath: string) {
        const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
        return render(<RouterProvider router={router} />);
    }

    test('navigating to /board/<id> renders the module component in the workspace', async () => {
        expect(TASKS_MODULE).toBeDefined();
        const { container } = renderAt(`/board/${TASKS_MODULE?.route}`);
        // The Tasks module renders its board — proves the module element mounts under the Outlet.
        await waitFor(() => expect(container.querySelector('[data-kanban-board]')).not.toBeNull());
    });

    test('root path redirects to the default module route', async () => {
        // Whatever the alphabetically-first module is, the redirect lands on a real module
        // (its data-attribute or a non-empty workspace — Tasks module's data-kanban-board is
        // the simplest unique marker).
        const { container } = renderAt('/');
        await waitFor(() => expect(container.querySelector('main, [data-kanban-board]')).not.toBeNull());
    });

    test('bare /board redirects to the default module route', async () => {
        const { container } = renderAt('/board');
        await waitFor(() => expect(container.querySelector('main, [data-kanban-board]')).not.toBeNull());
    });

    test('sidebar renders one nav item per module and highlights the active one', async () => {
        expect(TASKS_MODULE).toBeDefined();
        const { container } = renderAt(`/board/${TASKS_MODULE?.route}`);
        await waitFor(() => expect(container.querySelector('[data-kanban-board]')).not.toBeNull());

        const navLinks = container.querySelectorAll('nav a');
        expect(navLinks.length).toBe(modules.filter((m) => m.id !== 'settings').length);

        const active = Array.from(navLinks).find((a) => a.className.includes('text-spur-accent'));
        expect(active).toBeDefined();
        expect(active?.getAttribute('href')).toBe(`/board/${TASKS_MODULE?.route}`);
    });

    test('the route tree maps an index redirect, the retired-route redirects, and two child routes per module', () => {
        const boardRoute = routes.find((r) => r.path === '/board');
        // One index redirect, two children per retired route (bare + wildcard), and two per module.
        expect(boardRoute?.children?.length).toBe(1 + RETIRED_ROUTES.length * 2 + modules.length * 2);
        expect(boardRoute?.children?.some((c) => 'index' in c && c.index === true)).toBe(true);
        const childPaths = boardRoute?.children?.flatMap((c) => ('path' in c ? [c.path] : [])) ?? [];
        for (const mod of modules) {
            expect(childPaths).toContain(mod.route);
            expect(childPaths).toContain(`${mod.route}/*`);
        }
        for (const retired of RETIRED_ROUTES) {
            expect(childPaths).toContain(retired.from);
            expect(childPaths).toContain(`${retired.from}/*`);
        }
    });

    // ── 0849 R2: retired Board routes keep their bookmarks working ──

    test('retired board routes redirect into the Projects view that now owns the capability', async () => {
        // The destination must carry the CAPABILITY, not merely the URL (0849 review P3):
        // `useProjectTab` silently falls back to the default tab for an unknown segment, so a
        // pathname-only assertion stays green even when the redirect lands on the wrong tab.
        // Expected tabs are stated as data — deriving them from `RETIRED_ROUTES.to` would re-run the
        // same fallback the app uses and could never fail on a stale tab id.
        const EXPECTED_TAB: Record<string, string> = {
            workspace: 'conversation', // /board/projects → the default tab
            inbox: 'conversation',
            teams: 'agents',
        };
        for (const retired of RETIRED_ROUTES) {
            const router = createMemoryRouter(routes, { initialEntries: [`/board/${retired.from}`] });
            const view = render(<RouterProvider router={router} />);
            await waitFor(() => expect(router.state.location.pathname).toBe(retired.to));
            const active = view.container.querySelector(
                '[data-projects-tab][aria-selected="true"], [data-settings-tab][aria-selected="true"]',
            );
            const activeTab = active?.getAttribute('data-projects-tab') ?? active?.getAttribute('data-settings-tab');
            expect(activeTab).toBe(EXPECTED_TAB[retired.from]);
            view.unmount();
        }
        expect(Object.keys(EXPECTED_TAB).sort()).toEqual(RETIRED_ROUTES.map((r) => r.from).sort());
    });

    test('retired board deep links redirect too, instead of 404ing on the wildcard', async () => {
        for (const retired of RETIRED_ROUTES) {
            const router = createMemoryRouter(routes, { initialEntries: [`/board/${retired.from}/anything`] });
            const view = render(<RouterProvider router={router} />);
            await waitFor(() => expect(router.state.location.pathname).toBe(retired.to));
            view.unmount();
        }
    });

    test('no enabled module reuses a retired route (a shadow would silently kill the redirect)', () => {
        for (const retired of RETIRED_ROUTES) {
            expect(modules.some((m) => m.route === retired.from)).toBe(false);
        }
    });

    test('createAppRouter constructs the browser router lazily', () => {
        expect(createAppRouter()).toBeDefined();
    });
});
