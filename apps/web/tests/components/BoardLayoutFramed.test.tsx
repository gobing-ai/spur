import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { loadLayoutState, resetLayoutState, saveLayoutState } from '../../src/lib/layout-state';
import { BoardRegistryProvider } from '../../src/modules/RegistryProvider';
import { createRegistry } from '../../src/modules/registry';
import type { WebModule } from '../../src/modules/types';
import { createBoardRoutes } from '../../src/router';
import { registerHappyDom, teardownHappyDom } from '../happy-dom';

/**
 * A framed resource owns the workspace (task 0991 R2 / AC2).
 *
 * The requirement is expressed as absences — no empty right panel, no right-panel resize handle,
 * no global agent overlay — so they are asserted directly, along with the promise that suppressing
 * them is render-only and does not disturb a user's saved built-in layout preferences.
 */

registerHappyDom();

afterAll(teardownHappyDom);

/** A framed entry exactly as `composeBoardModules` produces one for an iframe descriptor. */
const FRAMED: WebModule = {
    id: 'modules/frame',
    name: 'Design Docs',
    icon: '▢',
    route: 'modules/frame',
    sidebarLabel: 'Docs',
    contributionType: 'iframe',
    component: () => null,
};

function renderAt(path: string, modules: readonly WebModule[]) {
    const registry = createRegistry([...modules]);
    const router = createMemoryRouter(createBoardRoutes(registry), { initialEntries: [path] });
    return render(
        <BoardRegistryProvider value={{ registry, hostDiagnostics: [] }}>
            <RouterProvider router={router} />
        </BoardRegistryProvider>,
    );
}

let realFetch: typeof fetch;

beforeEach(() => {
    resetLayoutState();
    // The board shell fetches /api/* on mount. Left to happy-dom, those requests run its
    // CORS machinery and print "Cross-Origin Request Blocked" warnings per mount. Reject
    // like a real failed fetch instead — components render their empty state either way.
    realFetch = globalThis.fetch;
    globalThis.fetch = async (): Promise<Response> => {
        throw new TypeError('Failed to fetch');
    };
});

afterEach(() => {
    cleanup();
    globalThis.fetch = realFetch;
});

test('a framed module mounts in the workspace and marks the shell as framed', async () => {
    const { container } = renderAt('/board/modules/frame', [...createRegistry([]).modules, FRAMED]);

    await waitFor(() => expect(container.querySelector('.board-layout')).not.toBeNull());
    const layout = container.querySelector('.board-layout');
    expect(layout?.getAttribute('data-framed-workspace')).toBe('true');
    expect(container.querySelector('main')).not.toBeNull();
});

test('a framed workspace has no right panel and no right-panel resize handle', async () => {
    const { container } = renderAt('/board/modules/frame', [...createRegistry([]).modules, FRAMED]);

    await waitFor(() => expect(container.querySelector('.board-layout')).not.toBeNull());
    // Only the sidebar remains as a direct aside, and only the sidebar's handle remains, so no
    // empty panel column or dead handle is left beside the frame.
    expect(container.querySelectorAll('.board-layout > aside')).toHaveLength(1);
    expect(container.querySelectorAll('.board-layout > .resize-handle')).toHaveLength(1);
});

test('a framed workspace renders no global agent overlay', async () => {
    const { container } = renderAt('/board/modules/frame', [...createRegistry([]).modules, FRAMED]);

    await waitFor(() => expect(container.querySelector('.board-layout')).not.toBeNull());
    expect(container.querySelector('[data-testid="agent-bar"]')).toBeNull();
    expect(container.querySelector('[data-testid="agent-bar-dock"]')).toBeNull();
});

test('suppression is render-only: saved layout preferences survive a framed visit', async () => {
    // A user who explicitly widened the right panel on a built-in module.
    saveLayoutState({ ...loadLayoutState(), rightPanelCollapsed: false });
    const before = loadLayoutState().rightPanelCollapsed;

    const { container, unmount } = renderAt('/board/modules/frame', [...createRegistry([]).modules, FRAMED]);
    await waitFor(() => expect(container.querySelector('.board-layout')).not.toBeNull());
    unmount();

    // Switching to a framed resource must not have rewritten the persisted preference.
    expect(loadLayoutState().rightPanelCollapsed).toBe(before);
    expect(before).toBe(false);
});

test('a built-in module keeps the panel surfaces that the framed workspace suppresses', async () => {
    const builtins = createRegistry([]).modules;
    const { container } = renderAt(`/board/${builtins[0]?.route ?? ''}`, builtins);

    await waitFor(() => expect(container.querySelector('.board-layout')).not.toBeNull());
    const layout = container.querySelector('.board-layout');
    expect(layout?.getAttribute('data-framed-workspace')).toBe('false');
    // Sidebar + right panel, and both resize handles, are back for a built-in.
    expect(container.querySelectorAll('.board-layout > aside')).toHaveLength(2);
    expect(container.querySelectorAll('.board-layout > .resize-handle')).toHaveLength(2);
});
