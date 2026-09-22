registerHappyDom();

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import AgentsView from '../../../src/modules/projects/AgentsView';
import ProjectsShell from '../../../src/modules/projects/ProjectsShell';
import type { ProjectFleetSnapshot, ResolvedFleetMember } from '../../../src/modules/projects/useProjectContext';
import { ProjectContext } from '../../../src/modules/projects/useProjectContext';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

afterAll(teardownHappyDom);

// happy-dom has no EventSource; MemberTerminal's SSE attach needs an inert stub.
const OriginalEventSource = (globalThis as Record<string, unknown>).EventSource;
beforeAll(() => {
    Object.defineProperty(globalThis, 'EventSource', {
        value: class {
            onmessage: unknown = null;
            onerror: unknown = null;
            close(): void {}
        },
        writable: true,
        configurable: true,
    });
});
afterAll(() => {
    Object.defineProperty(globalThis, 'EventSource', {
        value: OriginalEventSource,
        writable: true,
        configurable: true,
    });
});

afterEach(() => {
    cleanup();
    resetFetchForTesting();
});

function member(overrides: Partial<ResolvedFleetMember> = {}): ResolvedFleetMember {
    return {
        instanceId: 'a1',
        role: 'planner',
        executor: 'claude',
        enabled: true,
        writeCapable: true,
        capabilityState: 'active',
        ...overrides,
    };
}

function fleet(overrides: Partial<ProjectFleetSnapshot> = {}): ProjectFleetSnapshot {
    return {
        path: '/repo/wt',
        enabled: true,
        strategy: { name: 'gtd', version: 1 },
        orchestrator: { state: 'bound-online', instanceId: 'orch' },
        members: [member({ instanceId: 'orch' }), member({ instanceId: 'a1' })],
        capacity: { total: 2, enabled: 2, writeCapable: 2, missing: [] },
        ...overrides,
    };
}

function ctx(overrides: Record<string, unknown> = {}) {
    return { path: '/repo/wt', name: 'spur', fleet: fleet(), state: 'ready' as const, ...overrides };
}

function procRow(agentId: string, status = 'running', pid = 42) {
    return { agentId, pid, status, startedAt: '2026-09-12T10:00:00.000Z', exitCode: null };
}

/** 0897: the session rides the /processes entry; id is only carried by resume mode. */
function procRowWithSession(agentId: string, session: Record<string, unknown>) {
    return { ...procRow(agentId), session };
}

function stubFetch(fleetBody: unknown, processesBody: unknown): typeof fetch {
    return ((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const body = url.includes('/project/fleet') ? fleetBody : processesBody;
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }) as typeof fetch;
}

function harness(projectValue: Record<string, unknown>, initial = ['/board/projects/agents']) {
    return render(
        <MemoryRouter initialEntries={initial}>
            <ProjectContext.Provider value={projectValue as never}>
                <ProjectsShell />
            </ProjectContext.Provider>
        </MemoryRouter>,
    );
}

// ── R1: the roster shows the project fleet ──

describe('AgentsView roster (0842 R1)', () => {
    test('/board/projects/agents renders the roster panel with role, executor, and orchestrator marker', async () => {
        setFetchForTesting(stubFetch(fleet(), { processes: [procRow('orch'), procRow('a1', 'exited')] }));
        const view = harness(ctx());
        await act(async () => {});
        expect(view.container.querySelector('[data-roster-grid]')).not.toBeNull();
        const cards = [...view.container.querySelectorAll('[data-roster-entry]')];
        expect(cards.map((c) => c.getAttribute('data-roster-entry'))).toEqual(['orch', 'a1']);
        const orchCard = cards[0];
        expect(orchCard?.querySelector('[data-roster-orchestrator]')?.textContent).toContain('orchestrator');
        // negative assertion: only the orchestrator card is marked (fix hop — unconditional span deleted)
        expect(cards[1]?.querySelector('[data-roster-orchestrator]')).toBeNull();
        expect(orchCard?.querySelector('[data-roster-role]')?.textContent).toContain('planner');
        expect(orchCard?.querySelector('[data-roster-executor]')?.textContent).toContain('claude');
        expect(orchCard?.querySelector('[data-roster-observed]')?.textContent).toContain('running');
        view.unmount();
    });

    test('cards open the member detail pane via the prototype selector', async () => {
        setFetchForTesting(stubFetch(fleet(), { processes: [procRow('a1')] }));
        const view = harness(ctx());
        await act(async () => {});
        const card = view.container.querySelector('[data-roster-entry="a1"]') as HTMLButtonElement;
        await act(async () => {
            card.click();
        });
        expect(view.container.querySelector('[data-member-detail]')).not.toBeNull();
        view.unmount();
    });

    test('empty fleet explains the expected agent.fleet section, tabs still mounted', async () => {
        setFetchForTesting(
            stubFetch(fleet({ members: [], capacity: { total: 0, enabled: 0, writeCapable: 0, missing: [] } }), {
                processes: [],
            }),
        );
        const view = harness(ctx());
        await act(async () => {});
        // 0858 R5: the empty-roster hint names `agent.fleet` in the project config.
        expect(view.container.querySelector('[data-roster-empty]')?.textContent).toContain('agent.fleet');
        expect(view.container.querySelector('[data-roster-empty]')?.textContent).toContain('.spur/config.yaml');
        expect(view.container.querySelector('[data-projects-tab="agents"]')).not.toBeNull();
        view.unmount();
    });
});

// ── R2/R5: two labeled facts + named issue states ──

describe('declared and observed are separate facts (0842 R2/R5)', () => {
    test('declared-enabled member with no process renders BOTH facts and no combined status element', async () => {
        setFetchForTesting(
            stubFetch(
                fleet({
                    members: [member({ instanceId: 'a1' })],
                    orchestrator: { state: 'bound-online', instanceId: 'orch' },
                }),
                { processes: [] },
            ),
        );
        const view = render(
            <ProjectContext.Provider value={ctx({ fleet: fleet({ members: [member()] }) }) as never}>
                <AgentsView pollMs={10} />
            </ProjectContext.Provider>,
        );
        await act(async () => {});
        const card = view.container.querySelector('[data-roster-entry="a1"]');
        expect(card?.querySelector('[data-roster-declared]')?.textContent).toContain('enabled');
        expect(card?.querySelector('[data-roster-observed]')?.textContent).toContain('not-started');
        expect(card?.querySelector('[data-roster-status]')).toBeNull(); // never one dot
        expect(card?.querySelector('[data-roster-next-action]')?.textContent).toContain('start it');
        view.unmount();
    });

    test('capabilityState unavailable → executor-unavailable as its own state with its next action, not offline', async () => {
        setFetchForTesting(
            stubFetch(fleet({ members: [member({ capabilityState: 'unavailable' })] }), { processes: [] }),
        );
        const view = render(
            <ProjectContext.Provider value={ctx() as never}>
                <AgentsView pollMs={10} />
            </ProjectContext.Provider>,
        );
        await act(async () => {});
        const issue = view.container.querySelector('[data-roster-issue="executor-unavailable"]');
        expect(issue?.textContent).toContain('executor unavailable');
        expect(issue?.textContent).toContain('attestation');
        expect(view.container.textContent).not.toContain('not running — start it');
        view.unmount();
    });

    test('capabilityState unknown renders capability-unknown, never available or unavailable', async () => {
        setFetchForTesting(stubFetch(fleet({ members: [member({ capabilityState: 'unknown' })] }), { processes: [] }));
        const view = render(
            <ProjectContext.Provider value={ctx() as never}>
                <AgentsView pollMs={10} />
            </ProjectContext.Provider>,
        );
        await act(async () => {});
        expect(view.container.querySelector('[data-roster-issue="capability-unknown"]')?.textContent).toContain(
            'capability unknown',
        );
        expect(view.container.querySelector('[data-roster-issue="executor-unavailable"]')).toBeNull();
        view.unmount();
    });

    test('bound-offline names the stale claim ONLY on the orchestrator member; members still get start it', async () => {
        setFetchForTesting(
            stubFetch(fleet({ orchestrator: { state: 'bound-offline', instanceId: 'orch' } }), { processes: [] }),
        );
        const view = render(
            <ProjectContext.Provider value={ctx() as never}>
                <AgentsView pollMs={10} />
            </ProjectContext.Provider>,
        );
        await act(async () => {});
        const orch = view.container.querySelector('[data-roster-entry="orch"]');
        expect(orch?.querySelector('[data-roster-orchestrator]')).not.toBeNull();
        expect(orch?.querySelector('[data-roster-next-action]')?.textContent).toContain('project_claims');
        const member = view.container.querySelector('[data-roster-entry="a1"]');
        expect(member?.querySelector('[data-roster-next-action]')?.textContent).toContain('start it');
        expect(member?.querySelector('[data-roster-next-action]')?.textContent).not.toContain('stale');
        view.unmount();
    });
});

// ── poll discipline ──

describe('poll tick (0842 Design: one tick for both facts)', () => {
    test('a malformed process payload skips the tick without clearing the roster', async () => {
        setFetchForTesting(stubFetch(fleet(), { processes: [procRow('a1')] }));
        const view = render(
            <ProjectContext.Provider value={ctx() as never}>
                <AgentsView pollMs={10} />
            </ProjectContext.Provider>,
        );
        await act(async () => {});
        expect(view.container.querySelector('[data-roster-entry="a1"]')).not.toBeNull();
        // Next tick serves a malformed processes payload — the roster persists.
        setFetchForTesting(stubFetch(fleet(), { processes: 'not-a-list' }));
        await act(async () => {
            await new Promise((r) => setTimeout(r, 80));
        });
        expect(view.container.querySelector('[data-roster-entry="a1"]')).not.toBeNull();
        expect(view.container.querySelector('[data-roster-fetch-failed]')).toBeNull();
        view.unmount();
    });

    test('a fleet payload with a shape-broken member skips the tick (ADR-021 member narrowing)', async () => {
        setFetchForTesting(
            stubFetch(fleet({ members: [{ role: 'planner' } as unknown as ResolvedFleetMember] }), {
                processes: [procRow('a1')],
            }),
        );
        const view = render(
            <ProjectContext.Provider value={ctx() as never}>
                <AgentsView pollMs={10} />
            </ProjectContext.Provider>,
        );
        await act(async () => {});
        expect(view.container.querySelector('[data-roster-entry]')).toBeNull();
        expect(view.container.querySelector('[data-roster-fetch-failed]')).toBeNull();
        view.unmount();
    });
});

// ── R4: focus contract ──

describe('member detail focus restore (0842 R4)', () => {
    test('open from a card, dismiss with Escape → focus returns to that card', async () => {
        setFetchForTesting(stubFetch(fleet(), { processes: [procRow('a1')] }));
        const view = harness(ctx());
        await act(async () => {});
        const card = view.container.querySelector('[data-roster-entry="a1"]') as HTMLButtonElement;
        await act(async () => {
            card.click();
        });
        expect(view.container.querySelector('[data-member-detail]')).not.toBeNull();
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(view.container.querySelector('[data-member-detail]')).toBeNull();
        expect(document.activeElement).toBe(card);
        view.unmount();
    });
});

// ── 0897 R3: the member session renders as read-only roster text ──

describe('AgentsView member session (0897 R3)', () => {
    test('resume sessions render mode + shortened id; members without a session render a dash', async () => {
        setFetchForTesting(
            stubFetch(fleet(), {
                processes: [
                    procRowWithSession('orch', { mode: 'resume', id: 'sess-3f9c2a1d-beef' }),
                    procRowWithSession('a1', { mode: 'one-shot' }),
                ],
            }),
        );
        const view = harness(ctx());
        await act(async () => {});
        const cards = new Map(
            [...view.container.querySelectorAll('[data-roster-entry]')].map((c) => [
                c.getAttribute('data-roster-entry'),
                c.querySelector('[data-roster-session]')?.textContent,
            ]),
        );
        expect(cards.get('orch')).toContain('resume · sess-3f9');
        expect(cards.get('a1')).toContain('one-shot');
        view.unmount();
    });

    test('no session on either feed → dash, and the declared snapshot session is the fallback', async () => {
        setFetchForTesting(
            stubFetch(
                fleet({
                    members: [
                        member({ instanceId: 'orch' }),
                        member({ instanceId: 'a1', session: { mode: 'persistent' } }),
                    ],
                }),
                { processes: [procRow('orch'), procRow('a1')] },
            ),
        );
        const view = harness(ctx());
        await act(async () => {});
        const cards = new Map(
            [...view.container.querySelectorAll('[data-roster-entry]')].map((c) => [
                c.getAttribute('data-roster-entry'),
                c.querySelector('[data-roster-session]')?.textContent,
            ]),
        );
        expect(cards.get('orch')).toContain('—');
        expect(cards.get('a1')).toContain('persistent');
        view.unmount();
    });
});

describe('AgentsView roles and executors sections', () => {
    test('renders agent roles and executors with filtering support', async () => {
        const customFleet = fleet({
            roles: [
                { name: 'scribe', tier: 'cheap', stages: ['changelog'], isCustom: false },
                { name: 'coder', tier: 'standard', stages: ['implement', 'test'], isCustom: true },
                { name: 'reviewer', tier: 'capable-1', stages: ['verify'], isCustom: false },
                { name: 'planner', tier: 'capable-2', stages: ['plan'], isCustom: false },
            ],
            executors: [
                { name: 'pi-flash', agent: 'pi', model: 'flash-model', tier: 'standard', disabled: false },
                {
                    name: 'claude-opus',
                    agent: 'claude',
                    model: 'opus-5',
                    tier: 'capable-3',
                    disabled: true,
                    disabledReason: 'quota',
                },
            ],
        });
        setFetchForTesting(stubFetch(customFleet, { processes: [procRow('orch'), procRow('a1')] }));
        const view = harness(ctx());
        await act(async () => {});

        // Roles Section
        const rolesSection = view.container.querySelector('[data-roles-section]');
        expect(rolesSection).not.toBeNull();
        const roleCards = [...view.container.querySelectorAll('[data-role-card]')];
        expect(roleCards).toHaveLength(4);
        expect(view.container.querySelector('[data-role-card="coder"]')?.textContent).toContain('project override');

        // Executors Section
        const executorsSection = view.container.querySelector('[data-executors-section]');
        expect(executorsSection).not.toBeNull();
        const executorCards = [...view.container.querySelectorAll('[data-executor-card]')];
        expect(executorCards).toHaveLength(2);
        expect(view.container.querySelector('[data-executor-card="pi-flash"]')?.textContent).toContain('Ready');
        expect(view.container.querySelector('[data-executor-card="claude-opus"]')?.textContent).toContain('Disabled');

        // Fleet Section
        const fleetSection = view.container.querySelector('[data-fleet-section]');
        expect(fleetSection).not.toBeNull();

        // Filter buttons
        const rolesFilter = view.container.querySelector('[data-section-filter="roles"]') as HTMLButtonElement;
        expect(rolesFilter).not.toBeNull();
        await act(async () => {
            rolesFilter.click();
        });
        expect(view.container.querySelector('[data-roles-section]')).not.toBeNull();
        expect(view.container.querySelector('[data-executors-section]')).toBeNull();
        expect(view.container.querySelector('[data-fleet-section]')).toBeNull();

        view.unmount();
    });

    test('executor status toggle renders as switch, opens confirmation modal, and cancels or confirms', async () => {
        const postCalls: Array<{ url: string; body: unknown }> = [];
        const customFleet = fleet({
            executors: [
                {
                    name: 'pi-flash',
                    agent: 'pi',
                    model: 'flash-model',
                    tier: 'standard',
                    disabled: false,
                    sourceLayer: 'project',
                    sourcePath: '/repo/wt/.spur/config.yaml',
                },
                {
                    name: 'claude-opus',
                    agent: 'claude',
                    model: 'opus-5',
                    tier: 'capable-3',
                    disabled: true,
                    disabledReason: 'quota',
                    sourceLayer: 'global',
                    sourcePath: '/home/user/.config/spur/config.yaml',
                },
            ],
        });

        const testFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            if (url.includes('/project/executors/availability')) {
                let bodyStr = '';
                if (typeof input === 'object' && input !== null && 'text' in input) {
                    bodyStr = await (input as Request).text();
                } else if (init?.body) {
                    bodyStr = String(init.body);
                }
                postCalls.push({ url, body: JSON.parse(bodyStr) });
                return new Response(JSON.stringify({ ok: true, status: 'updated' }), { status: 200 });
            }
            const body = url.includes('/project/fleet') ? customFleet : { processes: [] };
            return new Response(JSON.stringify(body), { status: 200 });
        };
        setFetchForTesting(testFetch as typeof fetch);

        const view = harness(ctx());
        await act(async () => {});

        // 1. Check toggle switch rendering
        const piToggle = view.container.querySelector('[data-executor-toggle="pi-flash"]') as HTMLButtonElement;
        const claudeToggle = view.container.querySelector('[data-executor-toggle="claude-opus"]') as HTMLButtonElement;
        expect(piToggle).not.toBeNull();
        expect(claudeToggle).not.toBeNull();

        // Ready is ON (checked = true); Disabled is OFF (checked = false)
        expect(piToggle.getAttribute('aria-checked')).toBe('true');
        expect(claudeToggle.getAttribute('aria-checked')).toBe('false');

        // Check provenance tags rendered
        expect(view.container.querySelector('[data-executor-card="pi-flash"]')?.textContent).toContain('project');
        expect(view.container.querySelector('[data-executor-card="claude-opus"]')?.textContent).toContain('global');

        // 2. Click toggle on pi-flash -> modal opens
        await act(async () => {
            piToggle.click();
        });

        const modal = view.container.querySelector('[data-executor-confirm-modal]');
        expect(modal).not.toBeNull();
        expect(modal?.textContent).toContain('Disable Agent Executor');
        expect(modal?.textContent).toContain('pi-flash');
        expect(modal?.textContent).toContain('Project Config');
        expect(modal?.textContent).toContain('/repo/wt/.spur/config.yaml');

        // 3. Cancel dismisses modal without calling API
        const cancelBtn = view.container.querySelector('[data-modal-cancel]') as HTMLButtonElement;
        await act(async () => {
            cancelBtn.click();
        });
        expect(view.container.querySelector('[data-executor-confirm-modal]')).toBeNull();
        expect(postCalls).toHaveLength(0);

        // 4. Click toggle on claude-opus -> modal opens for enabling
        await act(async () => {
            claudeToggle.click();
        });
        const modal2 = view.container.querySelector('[data-executor-confirm-modal]');
        expect(modal2).not.toBeNull();
        expect(modal2?.textContent).toContain('Enable Agent Executor');
        expect(modal2?.textContent).toContain('claude-opus');
        expect(modal2?.textContent).toContain('Global Config');

        // 5. Confirm calls the API and updates state
        const confirmBtn = view.container.querySelector('[data-modal-confirm]') as HTMLButtonElement;
        await act(async () => {
            confirmBtn.click();
        });

        expect(postCalls).toHaveLength(1);
        expect(postCalls[0]?.body).toEqual({
            name: 'claude-opus',
            disabled: false,
            layer: 'global',
        });
        expect(view.container.querySelector('[data-executor-confirm-modal]')).toBeNull();

        view.unmount();
    });

    test('RoleCard displays all candidate executors in current tier with default first and trailing star', async () => {
        const customFleet = fleet({
            roles: [
                {
                    name: 'coder',
                    tier: 'standard',
                    stages: ['implement', 'test'],
                    isCustom: true,
                    electedExecutor: 'pi-flash-volc',
                },
                {
                    name: 'scribe',
                    tier: 'cheap',
                    stages: ['changelog'],
                    isCustom: false,
                    electedExecutor: 'minimax',
                },
            ],
            executors: [
                { name: 'minimax', agent: 'pi', tier: 'cheap', disabled: false },
                { name: 'pi-flash-volc', agent: 'pi', tier: 'standard', disabled: false },
                { name: 'pi-zai-volc', agent: 'pi', tier: 'standard', disabled: false },
                { name: 'pi-zai', agent: 'pi', tier: 'standard', disabled: false },
                { name: 'pi-deepseek-off', agent: 'pi', tier: 'standard', disabled: true },
                { name: 'agy-opus', agent: 'antigravity-cli', tier: 'capable-1', disabled: false },
            ],
        });
        setFetchForTesting(stubFetch(customFleet, { processes: [] }));
        const view = harness(ctx());
        await act(async () => {});

        const coderExecutors = view.container.querySelector('[data-role-executors="coder"]');
        expect(coderExecutors).not.toBeNull();

        const coderItems = [...(coderExecutors?.querySelectorAll('[data-role-executor-item]') ?? [])];
        // 4 executors in standard tier: pi-flash-volc (default), pi-zai-volc, pi-zai, pi-deepseek-off (disabled)
        expect(coderItems).toHaveLength(4);

        // First item is the default executor with trailing star mark
        expect(coderItems[0]?.textContent).toContain('pi-flash-volc');
        expect(coderItems[0]?.textContent).toContain('⭐');

        // Other candidate executors follow in order
        expect(coderItems[1]?.textContent).toBe('pi-zai-volc');
        expect(coderItems[2]?.textContent).toBe('pi-zai');
        expect(coderItems[3]?.textContent).toBe('pi-deepseek-off');

        // Scribe has 1 executor in cheap tier with trailing star mark
        const scribeExecutors = view.container.querySelector('[data-role-executors="scribe"]');
        const scribeItems = [...(scribeExecutors?.querySelectorAll('[data-role-executor-item]') ?? [])];
        expect(scribeItems).toHaveLength(1);
        expect(scribeItems[0]?.textContent).toContain('minimax');
        expect(scribeItems[0]?.textContent).toContain('⭐');

        view.unmount();
    });
});
