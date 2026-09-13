registerHappyDom();

/**
 * KB-4 + ST-1 + R2 tab navigation ported to production (0845 R2/R3/R5), plus
 * the carried 0841 P3 contract (task chip) and 0844's bar control parity.
 * DOM-contract level: attributes, roles, focus identity — no focus simulation
 * gymnastics.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import GlobalAgentBar from '../../../src/components/GlobalAgentBar';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import { ConversationDraftProvider, saveDraft } from '../../../src/modules/projects/drafts';
import ProjectsShell from '../../../src/modules/projects/ProjectsShell';
import { RECEIPT_LABELS } from '../../../src/modules/projects/receipt';
import {
    ProjectContext,
    type ProjectFleetSnapshot,
    type ResolvedFleetMember,
} from '../../../src/modules/projects/useProjectContext';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

afterAll(teardownHappyDom);

// happy-dom has no EventSource; MemberTerminal (mounted by the detail pane) needs an inert stub.
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
    localStorage.clear();
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
        strategy: { name: 'gtd', version: 1 },
        orchestrator: { state: 'bound-online', instanceId: 'orch' },
        members: [member({ instanceId: 'orch' }), member()],
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

function stubFetch(): typeof fetch {
    return ((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('/project/fleet')) {
            return Promise.resolve(new Response(JSON.stringify(fleet()), { status: 200 }));
        }
        if (url.includes('/team/processes')) {
            return Promise.resolve(
                new Response(JSON.stringify({ processes: [procRow('orch'), procRow('a1')] }), { status: 200 }),
            );
        }
        if (url.includes('/project/requests')) {
            return Promise.resolve(new Response(JSON.stringify({ requests: [] }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ messages: [], count: 0 }), { status: 200 }));
    }) as typeof fetch;
}

function renderShell(initial = ['/board/projects']) {
    // ConversationDraftProvider wraps the shell exactly as BoardLayout does in
    // production — without it useConversationDraft() falls back to noopDraft.
    return render(
        <MemoryRouter initialEntries={initial}>
            <ProjectContext.Provider value={ctx() as never}>
                <ConversationDraftProvider>
                    <ProjectsShell />
                </ConversationDraftProvider>
            </ProjectContext.Provider>
        </MemoryRouter>,
    );
}

function renderBar() {
    return render(
        <ProjectContext.Provider value={ctx() as never}>
            <ConversationDraftProvider>
                <GlobalAgentBar />
            </ConversationDraftProvider>
        </ProjectContext.Provider>,
    );
}

function setPromptValue(textarea: Element, value: string): void {
    const holder = textarea as unknown as Record<string, Record<string, unknown> | undefined>;
    const key = Object.keys(holder).find((k) => k.startsWith('__reactProps$'));
    const onChange = key ? (holder[key]?.onChange as (e: { target: { value: string } }) => void) : undefined;
    if (!onChange) throw new Error('onChange not found on agent-bar-input');
    act(() => onChange({ target: { value } }));
}

describe('R2: tabs are keyboard-navigable with aria-selected (0840 frozen tablist)', () => {
    test('tablist/tab roles, aria-selected, and aria-controls↔id pairing', () => {
        setFetchForTesting(stubFetch());
        const { container } = renderShell();
        const tablist = container.querySelector('[role="tablist"]');
        expect(tablist?.getAttribute('aria-label')).toBe('Projects tabs');
        const tabs = [...container.querySelectorAll('[data-projects-tab]')];
        expect(tabs).toHaveLength(3);
        for (const tab of tabs) {
            expect(tab.getAttribute('role')).toBe('tab');
            expect(tab.getAttribute('aria-selected')).toMatch(/true|false/);
            const id = tab.getAttribute('data-projects-tab') ?? '';
            expect(tab.getAttribute('id')).toBe(`projects-tab-${id}`);
            expect(tab.getAttribute('aria-controls')).toBe(`projects-tab-panel-${id}`);
        }
        // Only the active panel is mounted; it must name its controlling tab.
        const active = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
        expect(active?.getAttribute('data-projects-tab')).toBe('conversation');
        const panel = container.querySelector(`#${active?.getAttribute('aria-controls')}`);
        expect(panel).not.toBeNull();
        expect(panel?.getAttribute('role')).toBe('tabpanel');
        expect(panel?.getAttribute('aria-labelledby')).toBe(active?.getAttribute('id'));
    });

    test('ArrowRight/ArrowLeft move the active tab and focus follows', () => {
        setFetchForTesting(stubFetch());
        const { container } = renderShell();
        const tablist = container.querySelector('[role="tablist"]') as HTMLElement;
        const tab = (id: string) => container.querySelector(`[data-projects-tab="${id}"]`) as HTMLButtonElement;
        tab('conversation').focus();
        expect(document.activeElement).toBe(tab('conversation'));

        fireEvent.keyDown(tablist, { key: 'ArrowRight' });
        expect(tab('agents').getAttribute('aria-selected')).toBe('true');
        expect(tab('conversation').getAttribute('aria-selected')).toBe('false');
        expect(container.querySelector('#projects-tab-panel-agents')).not.toBeNull();
        expect(document.activeElement).toBe(tab('agents'));

        fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
        expect(tab('conversation').getAttribute('aria-selected')).toBe('true');
        expect(document.activeElement).toBe(tab('conversation'));
    });
});

describe('KB-4: Escape closes member detail and restores focus to its opener (0842)', () => {
    test('Escape closes the pane and document.activeElement is the opening card', async () => {
        setFetchForTesting(stubFetch());
        const view = renderShell(['/board/projects/agents']);
        await act(async () => {});
        const card = view.container.querySelector(
            '[data-g6="open-member"][data-roster-entry="a1"]',
        ) as HTMLButtonElement;
        expect(card).not.toBeNull();
        await act(async () => {
            card.click();
        });
        expect(view.container.querySelector('[data-member-detail]')).not.toBeNull();

        fireEvent(document, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(view.container.querySelector('[data-member-detail]')).toBeNull();
        expect(document.activeElement).toBe(card);
        view.unmount();
    });
});

describe('R3: status is never colour-alone and state changes are announced (0844/0845)', () => {
    test('ST-1: every receipt state carries non-empty icon AND label AND meaning AND action, all distinct', () => {
        const states = Object.entries(RECEIPT_LABELS);
        expect(states.length).toBe(12);
        const labels = new Set<string>();
        for (const [state, l] of states) {
            expect(l.icon.length, state).toBeGreaterThan(0);
            expect(l.label.length, state).toBeGreaterThan(0);
            expect(l.meaning.length, state).toBeGreaterThan(0);
            expect(l.action.length, state).toBeGreaterThan(0);
            expect(['ok', 'warn', 'err'], state).toContain(l.tone);
            labels.add(l.label);
        }
        expect(labels.size).toBe(states.length);
    });

    test('a receipt transition writes label + action into data-agent-bar-live; region exists in BOTH branches', async () => {
        const posts: unknown[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            const u = new URL(url);
            if (u.pathname === '/api/messages') {
                posts.push(await (input as Request).json());
                return new Response(JSON.stringify({ msgId: 'm1', status: 'queued' }), { status: 201 });
            }
            if (u.pathname === '/api/project/requests') {
                return new Response(
                    JSON.stringify({
                        requests: [
                            {
                                messageId: 'm1',
                                requestKey: 'rk',
                                deliveryStatus: 'queued',
                                injectAttempts: 0,
                                injectError: null,
                                runId: null,
                                taskId: null,
                                outcome: null,
                                reason: null,
                                hold: null,
                            },
                        ],
                    }),
                    { status: 200 },
                );
            }
            return new Response(JSON.stringify({ messages: [], count: 0 }), { status: 200 });
        }) as typeof fetch);

        saveDraft({ path: '/repo/wt', text: 'announce me', refs: [], revision: 1 });
        const view = renderBar();
        fireEvent.click(view.getByTestId('agent-bar-dock'));

        // Region exists before any receipt (stable node, empty content).
        const live = view.container.querySelector('[data-agent-bar-live]') as HTMLElement;
        expect(live).not.toBeNull();
        expect(live.getAttribute('role')).toBe('status');
        expect(live.getAttribute('aria-live')).toBe('polite');

        fireEvent.click(view.getByText('Send'));
        // In flight: the pending transition is already written.
        expect(view.container.querySelector('[data-agent-bar-live]')?.textContent).toContain('pending');

        await act(async () => {});
        expect(posts).toHaveLength(1);
        const announced = view.container.querySelector('[data-agent-bar-live]') as HTMLElement;
        expect(announced.textContent).toContain('queued-awaiting-orchestrator');
        expect(announced.textContent).toContain('bind/restore an orchestrator');

        // ST-1 in the visible strip: icon (aria-hidden) + label + action, not colour alone.
        const strip = view.container.querySelector(
            '[data-receipt-state="queued-awaiting-orchestrator"]',
        ) as HTMLElement;
        expect(strip).not.toBeNull();
        const icon = strip.querySelector('span[aria-hidden="true"]') as HTMLElement;
        expect(icon.textContent?.length ?? 0).toBeGreaterThan(0);
        expect(strip.textContent).toContain('queued-awaiting-orchestrator');
        expect(strip.textContent).toContain('Next: bind/restore an orchestrator');

        // Fold the bar: the region survives in the dock branch — a change made
        // while collapsed is still announced.
        fireEvent.click(view.getByLabelText('Collapse agent prompt bar'));
        const foldedLive = view.container.querySelector('[data-agent-bar-live]') as HTMLElement;
        expect(foldedLive).not.toBeNull();
        expect(foldedLive.textContent).toContain('queued-awaiting-orchestrator');
        view.unmount();
    });
});

describe('carried 0841 P3: the task chip is keyboard-operable, labeled, and removable', () => {
    test('data-g6="task-chip" is a native button with a remove label and removes via activation', () => {
        setFetchForTesting(stubFetch());
        saveDraft({
            path: '/repo/wt',
            text: 'implement it',
            refs: [{ kind: 'task', wbs: '0841' }],
            revision: 1,
        });
        const { container } = renderShell(['/board/projects/conversation']);
        const chip = container.querySelector('[data-g6="task-chip"]') as HTMLButtonElement;
        expect(chip).not.toBeNull();
        expect(chip.tagName).toBe('BUTTON'); // keyboard-focusable and Enter/Space activatable
        expect(chip.getAttribute('aria-label')).toContain('Remove');
        expect(chip.getAttribute('aria-label')).toContain('task 0841');

        fireEvent.click(chip);
        expect(container.querySelector('[data-g6="task-chip"]')).toBeNull();
    });
});

describe('0844 bar controls stay reachable and labeled (keyboard parity)', () => {
    test('dock, drawer toggle, collapse, composer, and Send are labeled native controls', () => {
        const { getByTestId, getByLabelText, getByText } = renderBar();
        const dock = getByTestId('agent-bar-dock');
        expect(dock.tagName).toBe('BUTTON');
        expect(dock.getAttribute('aria-label')).toBe('Open agent prompt bar');
        expect(dock.getAttribute('aria-expanded')).toBe('false');

        fireEvent.click(dock);
        expect((getByTestId('agent-bar-input') as HTMLTextAreaElement).getAttribute('aria-label')).toBe('Agent prompt');
        expect(getByTestId('agent-bar-drawer-toggle').getAttribute('aria-label')).toBe(
            'Toggle execution telemetry drawer',
        );
        expect(getByLabelText('Collapse agent prompt bar').tagName).toBe('BUTTON');
        expect((getByText('Send') as HTMLButtonElement).tagName).toBe('BUTTON');
    });

    test('unbound orchestrator state is named in a status region while controls stay native', () => {
        setFetchForTesting(stubFetch());
        const view = render(
            <ProjectContext.Provider
                value={
                    ctx({
                        fleet: fleet({ orchestrator: { state: 'missing', instanceId: undefined } }),
                    }) as never
                }
            >
                <ConversationDraftProvider>
                    <GlobalAgentBar />
                </ConversationDraftProvider>
            </ProjectContext.Provider>,
        );
        fireEvent.click(view.getByTestId('agent-bar-dock'));
        const named = view.getByTestId('agent-bar-orchestrator-missing');
        expect(named.getAttribute('role')).toBe('status');
        expect(named.textContent).toContain('no orchestrator instance is bound');
        setPromptValue(view.getByTestId('agent-bar-input'), 'implement F84');
        expect((view.getByText('Send') as HTMLButtonElement).disabled).toBe(true);
        view.unmount();
    });
});
