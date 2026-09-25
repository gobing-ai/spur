registerHappyDom();

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import { discoverModules } from '../../../src/modules/discover';
import { module as projectsModule } from '../../../src/modules/projects/index';
import ProjectsShell from '../../../src/modules/projects/ProjectsShell';
import { ProjectContext, type ProjectFleetSnapshot } from '../../../src/modules/projects/useProjectContext';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

afterAll(teardownHappyDom);

// Tab panels poll /api/* on mount; tests that do not install their own fetch stub would
// otherwise hit the dev server and log CORS noise into the reporter stream.
beforeEach(() => {
    setFetchForTesting(((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('/project/requests')) {
            return Promise.resolve(new Response(JSON.stringify({ requests: [] }), { status: 200 }));
        }
        if (url.includes('/processes')) {
            return Promise.resolve(new Response(JSON.stringify({ processes: [] }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ messages: [], count: 0 }), { status: 200 }));
    }) as typeof fetch);
});

afterEach(() => {
    cleanup();
    resetFetchForTesting();
});

function fleet(overrides: Partial<ProjectFleetSnapshot> = {}): ProjectFleetSnapshot {
    return {
        path: '/repo/wt',
        enabled: true,
        strategy: { name: 'gtd', version: 1 },
        orchestrator: { state: 'bound-online', instanceId: 'lead' },
        members: [
            {
                instanceId: 'lead',
                role: 'planner',
                executor: 'claude',
                enabled: true,
                writeCapable: true,
                capabilityState: 'active',
            },
        ],
        capacity: { total: 1, enabled: 1, writeCapable: 1, missing: [] },
        ...overrides,
    };
}

function ctx(overrides: Record<string, unknown> = {}) {
    return { path: '/repo/wt', name: 'spur', fleet: fleet(), state: 'ready' as const, ...overrides };
}

/** Settle lazy-import→fetch→parse macrotask chains inside act (happy-dom resolves bodies on ticks). */
async function settleInAct(): Promise<void> {
    await act(async () => {
        for (let tick = 0; tick < 10; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

async function renderShell(contextValue: Record<string, unknown>, initial = ['/board/projects']) {
    const view = render(
        <MemoryRouter initialEntries={initial}>
            <ProjectContext.Provider value={contextValue as never}>
                <ProjectsShell />
            </ProjectContext.Provider>
        </MemoryRouter>,
    );
    await settleInAct();
    return view;
}

describe('Projects module registration (0840 R6)', () => {
    test('registers with unique id/route and order 45, above every surviving module', () => {
        const discovered = discoverModules();
        const projects = discovered.find((m) => m.id === 'projects');
        expect(projects).toBeDefined();
        expect(projectsModule.route).toBe('projects');
        expect(projectsModule.sidebarLabel).toBe('Projects');
        expect(projectsModule.order).toBe(45);
        expect(discovered.filter((m) => m.id === 'projects')).toHaveLength(1);
        expect(discovered.filter((m) => m.route === 'projects')).toHaveLength(1);
        expect(discovered.map((m) => m.id)).toHaveLength(8);
    });
});

describe('ProjectsShell header (0840 R5)', () => {
    test('renders title, description and ready state when everything resolves', async () => {
        const { container } = await renderShell(ctx());
        const header = container.querySelector('[data-projects-header]');
        expect(header?.getAttribute('data-projects-state')).toBe('ready');
        expect(container.textContent).toContain('Projects');
        expect(container.textContent).toContain('Conversation and processes for this project');
        expect(container.textContent).not.toContain('Orchestrator:');
        expect(container.textContent).not.toContain('Fleet:');
        expect(container.textContent).not.toContain('Strategy:');
    });

    test('loading state (context default)', async () => {
        const { container } = await renderShell({ path: null, name: '', fleet: null, state: 'loading' });
        expect(container.querySelector('[data-projects-header]')?.getAttribute('data-projects-state')).toBe('loading');
    });

    test('unresolvable state sets data-projects-state, tabs still mounted', async () => {
        const { container } = await renderShell({ path: null, name: '', fleet: null, state: 'unresolvable' });
        expect(container.querySelector('[data-projects-header]')?.getAttribute('data-projects-state')).toBe(
            'unresolvable',
        );
        expect(container.querySelectorAll('[data-projects-tab]')).toHaveLength(2);
    });

    test('fleet-unavailable when identity is ready but fleet fetch failed', async () => {
        const { container } = await renderShell(ctx({ fleet: null }));
        expect(container.querySelector('[data-projects-header]')?.getAttribute('data-projects-state')).toBe(
            'fleet-unavailable',
        );
    });

    test('no-fleet state when fleet capacity is 0', async () => {
        const { container } = await renderShell(
            ctx({
                fleet: fleet({
                    members: [],
                    capacity: { total: 0, enabled: 0, writeCapable: 0, missing: ['no-declaration'] },
                    orchestrator: { state: 'bound-online', instanceId: 'lead' },
                }),
            }),
        );
        expect(container.querySelector('[data-projects-header]')?.getAttribute('data-projects-state')).toBe('no-fleet');
    });

    test('capacity-missing state when unresolved members exist', async () => {
        const { container } = await renderShell(
            ctx({ fleet: fleet({ capacity: { total: 1, enabled: 0, writeCapable: 0, missing: ['writer-x'] } }) }),
        );
        expect(container.querySelector('[data-projects-header]')?.getAttribute('data-projects-state')).toBe(
            'capacity-missing',
        );
    });

    test('bound-offline orchestrator state wins over facts', async () => {
        const { container } = await renderShell(
            ctx({ fleet: fleet({ orchestrator: { state: 'bound-offline', reason: 'no-live-claim' } }) }),
        );
        expect(container.querySelector('[data-projects-header]')?.getAttribute('data-projects-state')).toBe(
            'bound-offline',
        );
    });
});

describe('ProjectsShell tabs (0840 R3/R5)', () => {
    test('two tabs render with the WorkspaceShell aria contract and deep-link selection', async () => {
        const { container } = await renderShell(ctx(), ['/board/projects/processes']);
        const tabs = container.querySelectorAll('[data-projects-tab]');
        expect(tabs).toHaveLength(2);
        const processes = container.querySelector('#projects-tab-processes');
        expect(processes?.getAttribute('aria-selected')).toBe('true');
        expect(container.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Projects tabs');
        const panel = container.querySelector('#projects-tab-panel-processes');
        expect(panel?.getAttribute('role')).toBe('tabpanel');
        expect(panel?.getAttribute('aria-labelledby')).toBe('projects-tab-processes');
    });

    test('tab click swaps the active panel and aria-selected', async () => {
        const { container } = await renderShell(ctx());
        expect(container.querySelector('#projects-tab-panel-conversation')).not.toBeNull();
        act(() => (container.querySelector('[data-projects-tab="processes"]') as HTMLButtonElement).click());
        await settleInAct(); // ProcessesView fetches the process list on mount
        expect(container.querySelector('#projects-tab-panel-processes')).not.toBeNull();
        expect(container.querySelector('#projects-tab-panel-conversation')).toBeNull();
        expect(container.querySelector('#projects-tab-processes')?.getAttribute('aria-selected')).toBe('true');
        expect(container.querySelector('#projects-tab-conversation')?.getAttribute('aria-selected')).toBe('false');
    });
});
