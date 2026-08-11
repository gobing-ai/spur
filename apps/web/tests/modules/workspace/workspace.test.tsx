registerHappyDom();

import { afterAll, describe, expect, test } from 'bun:test';
import { render, waitFor } from '@testing-library/react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import { discoverModules } from '../../../src/modules/discover';
import { WORKSPACE_TABS } from '../../../src/modules/workspace/tabs';
import WorkspaceShell from '../../../src/modules/workspace/WorkspaceShell';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function mockFetch(fn: (req: Request) => Promise<Response>): typeof fetch {
    return fn as unknown as typeof fetch;
}

function findByText(container: HTMLElement, text: string): HTMLElement | null {
    const all = container.querySelectorAll('*');
    for (const el of Array.from(all)) {
        if (el.textContent === text) return el as HTMLElement;
    }
    return null;
}

afterAll(async () => {
    await teardownHappyDom();
});

describe('Workspace module registration (R5)', () => {
    test('discovers the workspace module with id/route workspace, label Workspace, order 0', () => {
        const discovered = discoverModules();
        const workspace = discovered.find((m) => m.id === 'workspace');
        expect(workspace).toBeDefined();
        expect(workspace?.route).toBe('workspace');
        expect(workspace?.sidebarLabel).toBe('Workspace');
        expect(workspace?.order).toBe(0);
        expect(typeof workspace?.component).toBe('function');
        // unique id + route
        expect(discovered.filter((m) => m.id === 'workspace')).toHaveLength(1);
        expect(discovered.filter((m) => m.route === 'workspace')).toHaveLength(1);
    });

    test('WORKSPACE_TABS are Overview, Team, Inbox, Tasks (stable order)', () => {
        expect(WORKSPACE_TABS.map((t) => t.id)).toEqual(['overview', 'team', 'inbox', 'tasks']);
        for (const tab of WORKSPACE_TABS) {
            expect(typeof tab.label).toBe('string');
            expect(typeof tab.component).toBe('function');
        }
    });
});

describe('WorkspaceShell (R5, R6)', () => {
    test('shows an empty state when no project-local team exists', async () => {
        setFetchForTesting(
            mockFetch(async (req: Request) => {
                if (req.url.includes('/team/teams')) {
                    return jsonResponse({
                        teams: [
                            {
                                teamId: 'remote',
                                name: 'Remote',
                                workDir: '/elsewhere',
                                isCurrentProject: false,
                                members: [],
                            },
                        ],
                    });
                }
                return jsonResponse({ ok: true });
            }),
        );
        const { container } = render(<WorkspaceShell />);
        await waitFor(() => expect(container.querySelector('[data-workspace-empty]')).not.toBeNull());
        expect(container.textContent).toContain('.spur/config.yaml');
        resetFetchForTesting();
    });

    test('selects the first isCurrentProject team and renders Overview + scoped tabs', async () => {
        setFetchForTesting(
            mockFetch(async (req: Request) => {
                if (req.url.includes('/team/teams')) {
                    return jsonResponse({
                        teams: [
                            { teamId: 'proj', name: 'Proj', workDir: '/work', isCurrentProject: true, members: [] },
                            {
                                teamId: 'remote',
                                name: 'Remote',
                                workDir: '/elsewhere',
                                isCurrentProject: false,
                                members: [],
                            },
                        ],
                    });
                }
                if (req.url.includes('/messages')) return jsonResponse({ messages: [], count: 0 });
                if (req.url.includes('/events/history')) return jsonResponse({ events: [] });
                if (req.url.includes('/team/processes'))
                    return jsonResponse({ processes: [], count: 0, executions: [], executionsCount: 0 });
                return jsonResponse({ ok: true });
            }),
        );
        const { container } = render(<WorkspaceShell />);
        // Overview tab active by default.
        await waitFor(() => expect(container.querySelector('[data-workspace-overview]')).not.toBeNull());
        // Renders the four tabs.
        expect(container.querySelectorAll('[role="tab"]').length).toBe(4);
        // Team selector present and defaults to the current-project team.
        const select = container.querySelector('[data-workspace-team-select]') as HTMLSelectElement | null;
        expect(select).not.toBeNull();
        expect(select?.value).toBe('proj');
        // Overview shows the selected team's name.
        expect(findByText(container, 'Proj')).not.toBeNull();
        resetFetchForTesting();
    });

    test('scoped team tab renders a scoped TeamsShell for the selected team', async () => {
        setFetchForTesting(
            mockFetch(async (req: Request) => {
                if (req.url.includes('/team/teams')) {
                    return jsonResponse({
                        teams: [
                            { teamId: 'proj', name: 'Proj', workDir: '/work', isCurrentProject: true, members: [] },
                        ],
                    });
                }
                if (req.url.includes('/events/history')) return jsonResponse({ events: [] });
                if (req.url.includes('/team/processes'))
                    return jsonResponse({ processes: [], count: 0, executions: [], executionsCount: 0 });
                return jsonResponse({ ok: true });
            }),
        );
        const { container } = render(<WorkspaceShell />);
        await waitFor(() => expect(container.querySelector('[data-workspace-overview]')).not.toBeNull());
        // Click the Team tab.
        const teamTab = Array.from(container.querySelectorAll('[role="tab"]')).find((t) => t.textContent === 'Team');
        expect(teamTab).toBeDefined();
        (teamTab as HTMLElement).click();
        await waitFor(() => expect(container.querySelector('[data-teams-shell]')).not.toBeNull());
        resetFetchForTesting();
    });
});
