registerHappyDom();

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import BoardLayout from '../../src/components/BoardLayout';
import GlobalAgentBar from '../../src/components/GlobalAgentBar';
import { resetFetchForTesting, setFetchForTesting } from '../../src/lib/rpc-client';
import { ConversationDraftProvider, saveDraft } from '../../src/modules/projects/drafts';
import { ProjectContext, type ProjectFleetSnapshot } from '../../src/modules/projects/useProjectContext';
import type { WebModule } from '../../src/modules/types';
import { registerHappyDom, teardownHappyDom } from '../happy-dom';

afterAll(async () => {
    resetFetchForTesting();
    await teardownHappyDom();
});

afterEach(() => {
    cleanup();
    resetFetchForTesting();
    localStorage.clear();
});

// Default router so the bar's on-mount polls (/api/project/requests etc.) never hit the
// dev server (CORS noise); tests install their own fetchRouter when they need payloads.
beforeEach(() => {
    setFetchForTesting(fetchRouter({ posts: [] }));
});

/** Settle mount fetches inside act — happy-dom resolves Response bodies on macrotasks. */
async function settleInAct(): Promise<void> {
    await act(async () => {
        for (let tick = 0; tick < 10; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

function setPromptValue(textarea: Element, value: string): void {
    const holder = textarea as unknown as Record<string, Record<string, unknown> | undefined>;
    const key = Object.keys(holder).find((k) => k.startsWith('__reactProps$'));
    const props = key ? holder[key] : undefined;
    const onChange = props?.onChange as ((e: { target: { value: string } }) => void) | undefined;
    if (!onChange) throw new Error('onChange not found on agent-bar-input');
    act(() => onChange({ target: { value } }));
}

// ── 0844 harness: the bar consumes ProjectContext + ConversationDraftContext ──

function fleet(overrides: { orchestrator?: Partial<ProjectFleetSnapshot['orchestrator']> } = {}): ProjectFleetSnapshot {
    return {
        path: '/repo/wt',
        strategy: { name: 'gtd', version: 1 },
        orchestrator: { state: 'bound-online', instanceId: 'lead', ...overrides.orchestrator },
        members: [],
        capacity: { total: 1, enabled: 1, writeCapable: 1, missing: [] },
    };
}

function projectCtx(overrides: Record<string, unknown> = {}) {
    return { path: '/repo/wt', name: 'spur', fleet: fleet(), state: 'ready' as const, ...overrides };
}

function harness(projectValue: Record<string, unknown> = projectCtx(), activeModule?: WebModule) {
    return render(
        <ProjectContext.Provider value={projectValue as never}>
            <ConversationDraftProvider>
                <GlobalAgentBar activeModule={activeModule} />
            </ConversationDraftProvider>
        </ProjectContext.Provider>,
    );
}

interface PostRecord {
    to: string;
    from: string;
    body: string;
    requestKey: string;
    projectPath: string;
}

/** Canned fetch: records POST /api/messages bodies, serves the results feed. */
function fetchRouter(state: { posts: PostRecord[]; requestsPayload?: unknown; postStatus?: number }): typeof fetch {
    return (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const u = new URL(url);
        if (u.pathname === '/api/messages') {
            state.posts.push((await (input as Request).json()) as PostRecord);
            return new Response(
                JSON.stringify({ msgId: `m${state.posts.length}`, toId: 'lead', status: 'queued', injected: false }),
                { status: state.postStatus ?? 201 },
            );
        }
        if (u.pathname === '/api/project/requests') {
            return new Response(JSON.stringify(state.requestsPayload ?? { requests: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ messages: [], count: 0 }), { status: 200 });
    }) as typeof fetch;
}

describe('GlobalAgentBar', () => {
    test('folded by default as a spirit dock, opens to wider 84rem glass bar, and collapses back', () => {
        const { getByTestId, getByLabelText, queryByTestId } = render(<GlobalAgentBar />);
        // Starts folded
        expect(queryByTestId('agent-bar')).toBeNull();
        const dock = getByTestId('agent-bar-dock');
        expect(dock.className).toContain('fixed');
        expect(dock.className).toContain('bottom-6');
        expect(dock.className).toContain('right-6');
        expect(dock.className).toContain('z-30');

        // Click to open
        fireEvent.click(dock);
        const bar = getByTestId('agent-bar');
        expect(bar.className).toContain('fixed');
        expect(bar.className).toContain('backdrop-blur-md');
        expect(bar.className).toContain('bg-base-100/80');
        expect(bar.className).toContain('w-[calc(100vw-2rem)]');
        expect(bar.className).toContain('max-w-[84rem]');
        expect(bar.className).toContain('z-30');

        // Collapse back
        fireEvent.click(getByLabelText('Collapse agent prompt bar'));
        expect(queryByTestId('agent-bar')).toBeNull();
        expect(getByTestId('agent-bar-dock')).toBeDefined();
    });

    test('Send is disabled while the prompt is empty, enabled once text is entered', async () => {
        const { getByTestId, getByText } = harness();
        await settleInAct(); // bar mount polls /api/* on mount
        fireEvent.click(getByTestId('agent-bar-dock'));
        const send = getByText('Send') as HTMLButtonElement;
        expect(send.disabled).toBe(true);
        setPromptValue(getByTestId('agent-bar-input'), 'refine this feature');
        expect((send as HTMLButtonElement).disabled).toBe(false);
    });

    test('BoardLayout renders the global agent bar dock', async () => {
        // Minimal VALID fleet snapshot: the settle drain lets the provider resolve, and
        // GlobalAgentBar destructures fleet.orchestrator (a bare {} would crash it).
        const fleet = {
            path: '/repo/wt',
            strategy: null,
            orchestrator: { state: 'missing' as const },
            members: [],
            capacity: { total: 0, enabled: 0, writeCapable: 0, missing: [] },
        };
        setFetchForTesting(
            (async () => new Response(JSON.stringify(fleet), { status: 200 })) as unknown as typeof fetch,
        );
        const view = render(
            <MemoryRouter initialEntries={['/board/tasks']}>
                <BoardLayout />
            </MemoryRouter>,
        );
        await settleInAct(); // lazy tasks module + agent bar mount fetches
        expect(view.getByTestId('agent-bar-dock')).toBeDefined();
    });
});

describe('GlobalAgentBar submission, durability, and receipts (0844)', () => {
    test('R1+R2: submit persists the request before the ack and clears the submitted revision', async () => {
        const state: { posts: PostRecord[] } = { posts: [] };
        setFetchForTesting(fetchRouter(state));
        // Seed the shared draft with text + a task ref (the envelope path).
        saveDraft({ path: '/repo/wt', text: 'implement F84', refs: [{ kind: 'task', wbs: '0844' }], revision: 1 });
        const view = harness();
        fireEvent.click(view.getByTestId('agent-bar-dock'));
        fireEvent.click(view.getByText('Send'));

        // In flight: the strip names the pending state before any ack.
        expect(view.container.querySelector('[data-receipt-state="pending"]')).not.toBeNull();

        await act(async () => {});

        // R1: the POST carried the durable identity + project scope + envelope.
        expect(state.posts).toHaveLength(1);
        expect(state.posts[0]?.to).toBe('lead');
        expect(state.posts[0]?.from).toBe('board-operator');
        expect(state.posts[0]?.body).toContain('SPUR-REQUEST/1 {"refs":[{"kind":"task","wbs":"0844"}]}');
        expect(state.posts[0]?.body).toContain('implement F84');
        expect(state.posts[0]?.requestKey).toMatch(/[0-9a-f-]{36}/);
        expect(state.posts[0]?.projectPath).toBe('/repo/wt');

        // R2: the submitted revision cleared.
        const input = view.getByTestId('agent-bar-input') as HTMLTextAreaElement;
        expect(input.value).toBe('');

        // The strip classified the durable receipt joined by messageId m1.
        const strip = view.container.querySelector('[data-receipt-state]');
        expect(strip).not.toBeNull();
        expect(strip?.getAttribute('data-receipt-state')).toBe('queued-awaiting-orchestrator');
        expect(strip?.textContent).toContain('queued-awaiting-orchestrator');
        view.unmount();
    });

    test('R3: a failed ack keeps the draft and the retry reuses the SAME requestKey', async () => {
        const state: { posts: PostRecord[] } = { posts: [] };
        setFetchForTesting(fetchRouter({ ...state, postStatus: 500 }));
        const view = harness();
        fireEvent.click(view.getByTestId('agent-bar-dock'));
        setPromptValue(view.getByTestId('agent-bar-input'), 'implement F84');
        fireEvent.click(view.getByText('Send'));
        await act(async () => {});
        expect(state.posts).toHaveLength(1);
        // Draft untouched by the failed ack.
        expect((view.getByTestId('agent-bar-input') as HTMLTextAreaElement).value).toBe('implement F84');

        fireEvent.click(view.getByText('Send'));
        await act(async () => {});
        expect(state.posts).toHaveLength(2);
        expect(state.posts[1]?.requestKey).toBe(state.posts[0]?.requestKey);
        view.unmount();
    });

    test('R2: an edit typed during flight survives the clear and mints a NEW key on resubmit', async () => {
        const state: { posts: PostRecord[] } = { posts: [] };
        setFetchForTesting(fetchRouter(state));
        const view = harness();
        fireEvent.click(view.getByTestId('agent-bar-dock'));
        setPromptValue(view.getByTestId('agent-bar-input'), 'implement F84');
        fireEvent.click(view.getByText('Send'));
        // The edit lands while the POST is still in flight.
        setPromptValue(view.getByTestId('agent-bar-input'), 'implement F84 — with the new constraint');
        await act(async () => {});

        const input = view.getByTestId('agent-bar-input') as HTMLTextAreaElement;
        expect(input.value).toBe('implement F84 — with the new constraint');

        // The edited payload is a different revision → a new key, not the old one.
        fireEvent.click(view.getByText('Send'));
        await act(async () => {});
        expect(state.posts).toHaveLength(2);
        expect(state.posts[1]?.requestKey).not.toBe(state.posts[0]?.requestKey);
        view.unmount();
    });

    test('unbound orchestrator: Send is disabled and the state is named, never a bare disabled control', () => {
        setFetchForTesting(fetchRouter({ posts: [] }));
        const view = harness(
            projectCtx({ fleet: fleet({ orchestrator: { state: 'missing', instanceId: undefined } }) }),
        );
        fireEvent.click(view.getByTestId('agent-bar-dock'));
        expect(view.getByTestId('agent-bar-orchestrator-missing').textContent).toContain(
            'no orchestrator instance is bound',
        );
        setPromptValue(view.getByTestId('agent-bar-input'), 'implement F84');
        expect((view.getByText('Send') as HTMLButtonElement).disabled).toBe(true);
        view.unmount();
    });
});

describe('GlobalAgentBar context, chips, and execution drawer', () => {
    test('renders context badge matching active module label and falls back to Board', () => {
        const mockModule: WebModule = {
            id: 'features',
            name: 'Features',
            sidebarLabel: 'Features',
            route: 'features',
            icon: '🗺️',
            component: () => null,
        };

        const { getByTestId, rerender } = render(<GlobalAgentBar activeModule={mockModule} />);
        fireEvent.click(getByTestId('agent-bar-dock'));
        expect(getByTestId('agent-bar-context').textContent).toBe('Context: Features');

        // Without active module, falls back to Board
        rerender(<GlobalAgentBar activeModule={undefined} />);
        expect(getByTestId('agent-bar-context').textContent).toBe('Context: Board');
    });

    test('renders task-route chip set and clicking a chip populates the prompt input', async () => {
        const tasksModule: WebModule = {
            id: 'tasks',
            name: 'Tasks',
            sidebarLabel: 'Tasks',
            route: 'tasks',
            icon: '📋',
            component: () => null,
        };

        const { getByTestId, getByText } = harness(projectCtx(), tasksModule);
        await settleInAct(); // bar mount polls /api/* inside the provider
        fireEvent.click(getByTestId('agent-bar-dock'));

        const chips = getByTestId('agent-bar-chips');
        expect(chips).toBeDefined();
        expect(chips.textContent).toContain('Run task');
        expect(chips.textContent).toContain('Check readiness');
        expect(chips.textContent).toContain('Refine requirements');

        const input = getByTestId('agent-bar-input') as HTMLTextAreaElement;
        expect(input.value).toBe('');

        fireEvent.click(getByText('Run task'));
        expect(input.value).toBe('Run task');
    });

    test('renders no chip set when module has no quick actions or is undefined', () => {
        const noActionModule: WebModule = {
            id: 'projects',
            name: 'Projects',
            sidebarLabel: 'Projects',
            route: 'projects',
            icon: '📂',
            component: () => null,
        };

        const { getByTestId, queryByTestId, rerender } = render(<GlobalAgentBar activeModule={noActionModule} />);
        fireEvent.click(getByTestId('agent-bar-dock'));
        expect(queryByTestId('agent-bar-chips')).toBeNull();

        rerender(<GlobalAgentBar activeModule={undefined} />);
        expect(queryByTestId('agent-bar-chips')).toBeNull();
    });

    test('toggling execution drawer displays not-wired-yet notice and closes back', () => {
        const { getByTestId, queryByTestId } = render(<GlobalAgentBar />);
        fireEvent.click(getByTestId('agent-bar-dock'));

        // Drawer closed initially
        expect(queryByTestId('agent-bar-drawer')).toBeNull();

        // Toggle open
        fireEvent.click(getByTestId('agent-bar-drawer-toggle'));
        const drawer = getByTestId('agent-bar-drawer');
        expect(drawer).toBeDefined();
        expect(drawer.textContent).toContain('Streamed telemetry and tool calls are not wired yet');

        // Toggle closed
        fireEvent.click(getByTestId('agent-bar-drawer-toggle'));
        expect(queryByTestId('agent-bar-drawer')).toBeNull();
    });
});
