registerHappyDom();

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import { discoverModules } from '../../../src/modules/discover';
import { ProjectContext } from '../../../src/modules/projects/useProjectContext';
import { SettingsShell, module as settingsModule } from '../../../src/modules/settings';
import { SETTINGS_TABS } from '../../../src/modules/settings/tabs';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

afterAll(teardownHappyDom);

afterEach(() => {
    cleanup();
    resetFetchForTesting();
});

beforeEach(() => {
    setFetchForTesting(((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('/project/fleet')) {
            return Promise.resolve(new Response(JSON.stringify({ members: [] }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ processes: [] }), { status: 200 }));
    }) as typeof fetch);
});

function ctx(overrides: Record<string, unknown> = {}) {
    return {
        path: '/repo/wt',
        name: 'spur',
        state: 'ready' as const,
        fleet: {
            path: '/repo/wt',
            name: 'spur',
            members: [],
            orchestrator: { state: 'bound-online', instanceId: 'orch' },
            capacity: { total: 0, enabled: 0, writeCapable: 0, missing: [] },
            strategy: 'round-robin',
        },
        error: null,
        ...overrides,
    };
}

function renderShell(initial = ['/board/settings']) {
    return render(
        <MemoryRouter initialEntries={initial}>
            <ProjectContext.Provider value={ctx() as never}>
                <SettingsShell />
            </ProjectContext.Provider>
        </MemoryRouter>,
    );
}

describe('Settings module registration', () => {
    test('registers with unique id/route and order 50', () => {
        const discovered = discoverModules();
        const settings = discovered.find((m) => m.id === 'settings');
        expect(settings).toBeDefined();
        expect(settingsModule.route).toBe('settings');
        expect(settingsModule.sidebarLabel).toBe('Settings');
        expect(settingsModule.order).toBe(50);
        expect(discovered.filter((m) => m.id === 'settings')).toHaveLength(1);
        expect(discovered.filter((m) => m.route === 'settings')).toHaveLength(1);
    });
});

describe('SettingsShell header and layout', () => {
    test('renders Settings title, description, and shell framing', () => {
        const { container } = renderShell();
        const shell = container.querySelector('[data-settings-shell]');
        expect(shell).not.toBeNull();
        const header = container.querySelector('[data-settings-header]');
        expect(header).not.toBeNull();
        expect(container.textContent).toContain('Settings');
        expect(container.textContent).toContain('System configuration, agent executors, and workspace preferences');
    });

    test('renders tablist with Agents tab and active tabpanel', () => {
        const { container } = renderShell(['/board/settings/agents']);
        const tablist = container.querySelector('[role="tablist"]');
        expect(tablist?.getAttribute('aria-label')).toBe('Settings tabs');
        const tabs = container.querySelectorAll('[data-settings-tab]');
        expect(tabs).toHaveLength(SETTINGS_TABS.length);
        const agentsTab = container.querySelector('#settings-tab-agents');
        expect(agentsTab?.getAttribute('aria-selected')).toBe('true');
        const panel = container.querySelector('#settings-tab-panel-agents');
        expect(panel).not.toBeNull();
        expect(panel?.getAttribute('role')).toBe('tabpanel');
        expect(panel?.getAttribute('aria-labelledby')).toBe('settings-tab-agents');
    });
});
