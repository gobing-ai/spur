registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { discoverModules } from '../../../src/modules/discover';
import { module as projectsModule } from '../../../src/modules/projects/index';
import ProjectsShell from '../../../src/modules/projects/ProjectsShell';
import { ProjectContext, type ProjectFleetSnapshot } from '../../../src/modules/projects/useProjectContext';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

afterAll(teardownHappyDom);

afterEach(() => cleanup());

function fleet(overrides: Partial<ProjectFleetSnapshot> = {}): ProjectFleetSnapshot {
    return {
        path: '/repo/wt',
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

function renderShell(contextValue: Record<string, unknown>, initial = ['/board/projects']) {
    return render(
        <MemoryRouter initialEntries={initial}>
            <ProjectContext.Provider value={contextValue as never}>
                <ProjectsShell />
            </ProjectContext.Provider>
        </MemoryRouter>,
    );
}

describe('Projects module registration (0840 R6)', () => {
    test('registers with unique id/route and order 45 (above Workspace 50)', () => {
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
    test('renders name + path and ready state when everything resolves', () => {
        const { container } = renderShell(ctx());
        const header = container.querySelector('[data-projects-header]');
        expect(header?.getAttribute('data-projects-state')).toBe('ready');
        expect(container.textContent).toContain('spur');
        expect(container.textContent).toContain('/repo/wt');
        expect(container.textContent).toContain('gtd (v1)');
        expect(container.textContent).toContain('online');
        expect(container.textContent).toContain('1 member');
    });

    test('loading state (context default)', () => {
        const { container } = renderShell({ path: null, name: '', fleet: null, state: 'loading' });
        expect(container.querySelector('[data-projects-header]')?.getAttribute('data-projects-state')).toBe('loading');
    });

    test('unresolvable state names the missing path, tabs still mounted', () => {
        const { container } = renderShell({ path: null, name: '', fleet: null, state: 'unresolvable' });
        expect(container.querySelector('[data-projects-header]')?.getAttribute('data-projects-state')).toBe(
            'unresolvable',
        );
        expect(container.textContent).toContain('Project path unavailable');
        expect(container.querySelectorAll('[data-projects-tab]')).toHaveLength(3);
    });

    test('fleet-unavailable when identity is ready but fleet fetch failed', () => {
        const { container } = renderShell(ctx({ fleet: null }));
        expect(container.querySelector('[data-projects-header]')?.getAttribute('data-projects-state')).toBe(
            'fleet-unavailable',
        );
        expect(container.textContent).toContain('Fleet status unavailable');
    });

    test('no-fleet state names the expected fleet.json path', () => {
        const { container } = renderShell(
            ctx({
                fleet: fleet({
                    members: [],
                    capacity: { total: 0, enabled: 0, writeCapable: 0, missing: ['no-declaration'] },
                    orchestrator: { state: 'bound-online', instanceId: 'lead' },
                }),
            }),
        );
        expect(container.querySelector('[data-projects-header]')?.getAttribute('data-projects-state')).toBe('no-fleet');
        expect(container.textContent).toContain('no fleet declared');
        expect(container.textContent).toContain('/repo/wt/.spur/fleet.json');
    });

    test('capacity-missing state lists unresolved members', () => {
        const { container } = renderShell(
            ctx({ fleet: fleet({ capacity: { total: 1, enabled: 0, writeCapable: 0, missing: ['writer-x'] } }) }),
        );
        expect(container.querySelector('[data-projects-header]')?.getAttribute('data-projects-state')).toBe(
            'capacity-missing',
        );
        expect(container.textContent).toContain('writer-x');
    });

    test('bound-offline orchestrator state wins over facts', () => {
        const { container } = renderShell(
            ctx({ fleet: fleet({ orchestrator: { state: 'bound-offline', reason: 'no-live-claim' } }) }),
        );
        expect(container.querySelector('[data-projects-header]')?.getAttribute('data-projects-state')).toBe(
            'bound-offline',
        );
        expect(container.textContent).toContain('bound but not responding');
    });
});

describe('ProjectsShell tabs (0840 R3/R5)', () => {
    test('three tabs render with the WorkspaceShell aria contract and deep-link selection', () => {
        const { container } = renderShell(ctx(), ['/board/projects/agents']);
        const tabs = container.querySelectorAll('[data-projects-tab]');
        expect(tabs).toHaveLength(3);
        const agents = container.querySelector('#projects-tab-agents');
        expect(agents?.getAttribute('aria-selected')).toBe('true');
        expect(container.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Projects tabs');
        const panel = container.querySelector('#projects-tab-panel-agents');
        expect(panel?.getAttribute('role')).toBe('tabpanel');
        expect(panel?.getAttribute('aria-labelledby')).toBe('projects-tab-agents');
    });

    test('tab click swaps the active panel and aria-selected', () => {
        const { container } = renderShell(ctx());
        expect(container.querySelector('#projects-tab-panel-conversation')).not.toBeNull();
        act(() => (container.querySelector('[data-projects-tab="work"]') as HTMLButtonElement).click());
        expect(container.querySelector('#projects-tab-panel-work')).not.toBeNull();
        expect(container.querySelector('#projects-tab-panel-conversation')).toBeNull();
        expect(container.querySelector('#projects-tab-work')?.getAttribute('aria-selected')).toBe('true');
        expect(container.querySelector('#projects-tab-conversation')?.getAttribute('aria-selected')).toBe('false');
    });
});
