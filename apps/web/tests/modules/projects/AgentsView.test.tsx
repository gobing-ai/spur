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
