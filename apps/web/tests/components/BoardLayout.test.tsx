registerHappyDom();

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';
import BoardLayout from '../../src/components/BoardLayout';
import { resetLayoutState } from '../../src/lib/layout-state';
import { resetFetchForTesting, setFetchForTesting } from '../../src/lib/rpc-client';
import { modules } from '../../src/modules/registry';
import type { WebModule } from '../../src/modules/types';
import { createAppRouter, routes } from '../../src/router';
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

function renderBoard() {
    return render(
        <MemoryRouter initialEntries={['/board/board']}>
            <BoardLayout />
        </MemoryRouter>,
    );
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

    test('renders with the sidebar expanded and right panel collapsed by default', () => {
        const { container } = renderBoard();
        const root = container.querySelector('.board-layout');
        expect(root?.getAttribute('data-sidebar-collapsed')).toBe('false');
        expect(root?.getAttribute('data-rightpanel-collapsed')).toBe('true');
    });

    test('keeps long module content inside the viewport-owned workspace scrollport in BoardLayout', async () => {
        const { container } = renderBoard();
        const workspace = container.querySelector('main');
        const scrollport = Array.from(workspace?.children ?? []).find((child) =>
            child.classList.contains('overflow-auto'),
        );
        const layoutCss = await Bun.file(new URL('../../src/styles/board-layout.css', import.meta.url)).text();
        const documentRule = layoutCss.match(/html,\s*body\s*\{([^}]*)\}/)?.[1] ?? '';

        expect(workspace?.classList.contains('h-full')).toBe(true);
        expect(workspace?.classList.contains('overflow-hidden')).toBe(true);
        expect(scrollport?.classList.contains('min-h-0')).toBe(true);
        expect(documentRule).toContain('overflow: hidden');
    });

    test('collapse toggle flips data-sidebar-collapsed and persists', () => {
        const { container, getByLabelText } = renderBoard();
        const root = container.querySelector('.board-layout');
        expect(root?.getAttribute('data-sidebar-collapsed')).toBe('false');

        fireEvent.click(getByLabelText('Collapse sidebar'));

        expect(root?.getAttribute('data-sidebar-collapsed')).toBe('true');
        const persisted = JSON.parse(localStorage.getItem('spur-board-layout') ?? '{}');
        expect(persisted.sidebarCollapsed).toBe(true);
    });

    test('expand toggle restores data-sidebar-collapsed=false and persists', () => {
        // Fold then unfold — both directions must work; expand was the broken path.
        localStorage.setItem(
            'spur-board-layout',
            JSON.stringify({
                sidebarWidth: 240,
                rightPanelWidth: 320,
                sidebarCollapsed: true,
                rightPanelCollapsed: true,
            }),
        );
        const { container, getByTestId } = renderBoard();
        const root = container.querySelector('.board-layout');
        expect(root?.getAttribute('data-sidebar-collapsed')).toBe('true');

        fireEvent.click(getByTestId('sidebar-expand'));

        expect(root?.getAttribute('data-sidebar-collapsed')).toBe('false');
        const persisted = JSON.parse(localStorage.getItem('spur-board-layout') ?? '{}');
        expect(persisted.sidebarCollapsed).toBe(false);
        // Unfolded header must expose a collapse control (not only expand-when-folded).
        expect(getByTestId('sidebar-collapse')).toBeTruthy();
    });

    test('right panel toggle expands the panel and persists', () => {
        const { container, getByLabelText } = renderBoard();
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
                sidebarWidth: 240,
                rightPanelWidth: 320,
                sidebarCollapsed: true,
                rightPanelCollapsed: false,
            }),
        );
        const { container } = renderBoard();
        const root = container.querySelector('.board-layout');
        expect(root?.getAttribute('data-sidebar-collapsed')).toBe('true');
        expect(root?.getAttribute('data-rightpanel-collapsed')).toBe('false');
    });

    test('dragging the sidebar handle updates the CSS var and persists sidebarWidth on pointer up', () => {
        const { container } = renderBoard();
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
        const persisted = JSON.parse(localStorage.getItem('spur-board-layout') ?? '{}');
        expect(persisted.sidebarWidth).toBe(300);
    });

    test('dragging the right-panel handle persists rightPanelWidth on pointer up', () => {
        const { container, getByLabelText } = renderBoard();
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
        const persisted = JSON.parse(localStorage.getItem('spur-board-layout') ?? '{}');
        expect(persisted.rightPanelWidth).toBe(380);
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
        expect(navLinks.length).toBe(modules.length);

        const active = Array.from(navLinks).find((a) => a.className.includes('text-spur-accent'));
        expect(active).toBeDefined();
        expect(active?.getAttribute('href')).toBe(`/board/${TASKS_MODULE?.route}`);
    });

    test('the route tree maps an index redirect plus two child routes per module', () => {
        const boardRoute = routes.find((r) => r.path === '/board');
        // One index redirect plus 2 children per module: `tasks` and `tasks/*`
        expect(boardRoute?.children?.length).toBe(1 + modules.length * 2);
        expect(boardRoute?.children?.some((c) => 'index' in c && c.index === true)).toBe(true);
        const childPaths = boardRoute?.children?.flatMap((c) => ('path' in c ? [c.path] : [])) ?? [];
        for (const mod of modules) {
            expect(childPaths).toContain(mod.route);
            expect(childPaths).toContain(`${mod.route}/*`);
        }
    });

    test('createAppRouter constructs the browser router lazily', () => {
        expect(createAppRouter()).toBeDefined();
    });
});
