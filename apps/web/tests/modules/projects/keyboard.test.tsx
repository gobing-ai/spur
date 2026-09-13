registerHappyDom();

/**
 * KB-1…KB-3 ported to production (0845 R1/R5): the global composer's keyboard
 * contract. happy-dom × React 19 crashes when a native keydown is dispatched
 * at a CONTROLLED textarea whose handler mutates state (React's value-tracker
 * restore), so the suite drives the real `onKeyDown` prop with a
 * contract-shaped event (hook-contract level — the same seam 0844's suite
 * uses for onChange). Real key dispatch is covered by the browser runner.
 * The two composition signals are exercised independently — checking only one
 * is the defect R1 names.
 */
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import GlobalAgentBar from '../../../src/components/GlobalAgentBar';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import { ConversationDraftProvider, DRAFT_STORAGE_KEY } from '../../../src/modules/projects/drafts';
import { ProjectContext, type ProjectFleetSnapshot } from '../../../src/modules/projects/useProjectContext';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

afterAll(async () => {
    resetFetchForTesting();
    await teardownHappyDom();
});

afterEach(() => {
    cleanup();
    resetFetchForTesting();
    localStorage.clear();
});

function fleet(): ProjectFleetSnapshot {
    return {
        path: '/repo/wt',
        strategy: { name: 'gtd', version: 1 },
        orchestrator: { state: 'bound-online', instanceId: 'lead' },
        members: [],
        capacity: { total: 1, enabled: 1, writeCapable: 1, missing: [] },
    };
}

function harness() {
    return render(
        <ProjectContext.Provider
            value={{ path: '/repo/wt', name: 'spur', fleet: fleet(), state: 'ready' as const } as never}
        >
            <ConversationDraftProvider>
                <GlobalAgentBar />
            </ConversationDraftProvider>
        </ProjectContext.Provider>,
    );
}

interface PostRecord {
    requestKey: string;
    body: string;
}

/** Canned fetch: records POST /api/messages bodies, serves the results feed. */
function fetchRouter(state: { posts: PostRecord[] }): typeof fetch {
    return (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const u = new URL(url);
        if (u.pathname === '/api/messages') {
            const body = await (input as Request).json();
            state.posts.push(body as PostRecord);
            return new Response(JSON.stringify({ msgId: `m${state.posts.length}`, status: 'queued' }), { status: 201 });
        }
        if (u.pathname === '/api/project/requests') {
            return new Response(JSON.stringify({ requests: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ messages: [], count: 0 }), { status: 200 });
    }) as typeof fetch;
}

function openComposer(view: ReturnType<typeof harness>): HTMLTextAreaElement {
    const dock = view.getByTestId('agent-bar-dock');
    act(() => {
        (dock as HTMLButtonElement).click();
    });
    return view.getByTestId('agent-bar-input') as HTMLTextAreaElement;
}

/** Type into the composer through the textarea's real React onChange prop. */
function setPromptValue(textarea: Element, value: string): void {
    const holder = textarea as unknown as Record<string, Record<string, unknown> | undefined>;
    const key = Object.keys(holder).find((k) => k.startsWith('__reactProps$'));
    const onChange = key ? (holder[key]?.onChange as (e: { target: { value: string } }) => void) : undefined;
    if (!onChange) throw new Error('onChange not found on agent-bar-input');
    act(() => onChange({ target: { value } }));
}

interface KeyInit {
    key: string;
    shiftKey?: boolean;
    isComposing?: boolean;
    keyCode?: number;
}

/**
 * Invoke the composer's real React onKeyDown prop with a contract-shaped
 * KeyboardEvent (`isComposing` / legacy `keyCode: 229` are the two signals
 * R1 requires). Returns whether the handler called preventDefault.
 */
function fireComposerKeyDown(textarea: Element, init: KeyInit): boolean {
    const holder = textarea as unknown as Record<string, Record<string, unknown> | undefined>;
    const key = Object.keys(holder).find((k) => k.startsWith('__reactProps$'));
    const onKeyDown = key ? (holder[key]?.onKeyDown as (e: unknown) => void) : undefined;
    if (!onKeyDown) throw new Error('onKeyDown not found on agent-bar-input');
    const native = new KeyboardEvent('keydown', {
        key: init.key,
        bubbles: false,
        cancelable: true,
        shiftKey: init.shiftKey ?? false,
        isComposing: init.isComposing ?? false,
        keyCode: init.keyCode ?? 0,
    } as KeyboardEventInit);
    const synthetic = {
        nativeEvent: native,
        key: init.key,
        shiftKey: init.shiftKey ?? false,
        preventDefault: (): void => native.preventDefault(),
    };
    act(() => onKeyDown(synthetic));
    return native.defaultPrevented;
}

describe('composer keyboard contract (0845 KB-1…KB-3)', () => {
    test('KB-3a: Enter that ends a composition (isComposing) submits nothing', () => {
        const state: { posts: PostRecord[] } = { posts: [] };
        setFetchForTesting(fetchRouter(state));
        const view = harness();
        const input = openComposer(view);
        setPromptValue(input, 'compose 中');

        const prevented = fireComposerKeyDown(input, { key: 'Enter', isComposing: true });

        expect(prevented).toBe(false); // event left alone — the composition continues undisturbed
        expect(state.posts).toHaveLength(0);
        expect(view.container.querySelector('[data-receipt-state]')).toBeNull();
        view.unmount();
    });

    test('KB-3b: Enter carrying the legacy composition keyCode 229 submits nothing', () => {
        const state: { posts: PostRecord[] } = { posts: [] };
        setFetchForTesting(fetchRouter(state));
        const view = harness();
        const input = openComposer(view);
        setPromptValue(input, 'compose 中');

        fireComposerKeyDown(input, { key: 'Enter', keyCode: 229 });

        expect(state.posts).toHaveLength(0);
        expect(view.container.querySelector('[data-receipt-state]')).toBeNull();
        view.unmount();
    });

    test('KB-2: Shift+Enter submits nothing and is NOT prevented (native newline path)', () => {
        const state: { posts: PostRecord[] } = { posts: [] };
        setFetchForTesting(fetchRouter(state));
        const view = harness();
        const input = openComposer(view);
        setPromptValue(input, 'line one');

        const prevented = fireComposerKeyDown(input, { key: 'Enter', shiftKey: true });

        expect(prevented).toBe(false); // textarea inserts the newline natively
        expect(state.posts).toHaveLength(0);
        view.unmount();
    });

    test('KB-1: plain Enter submits exactly once — pending first, then the durable receipt', async () => {
        const state: { posts: PostRecord[] } = { posts: [] };
        let releasePost: (() => Promise<void>) | undefined;
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            if (new URL(url).pathname === '/api/messages') {
                await new Promise<void>((resolve) => {
                    releasePost = async () => {
                        state.posts.push((await (input as Request).clone().json()) as PostRecord);
                        resolve();
                    };
                });
                return new Response(JSON.stringify({ msgId: 'm1', status: 'queued' }), { status: 201 });
            }
            if (new URL(url).pathname === '/api/project/requests') {
                return new Response(JSON.stringify({ requests: [] }), { status: 200 });
            }
            return new Response(JSON.stringify({ messages: [], count: 0 }), { status: 200 });
        }) as typeof fetch);

        const view = harness();
        const input = openComposer(view);
        setPromptValue(input, 'implement F84');

        const prevented = fireComposerKeyDown(input, { key: 'Enter' });

        expect(prevented).toBe(true); // a submitting Enter never also inserts a newline
        // In flight: pending strip BEFORE any ack; the durable identity is already persisted.
        expect(view.container.querySelector('[data-receipt-state="pending"]')).not.toBeNull();
        const stored = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) ?? '{}') as {
            pending?: { requestKey: string };
        };
        expect(stored.pending?.requestKey).toMatch(/[0-9a-f-]{36}/);

        await releasePost?.();
        await act(async () => {});

        expect(state.posts).toHaveLength(1);
        expect(state.posts[0]?.body).toContain('implement F84');
        // Same receipt the Send path renders — one submit path, not two.
        expect(view.container.querySelector('[data-receipt-state="queued-awaiting-orchestrator"]')).not.toBeNull();
        view.unmount();
    });

    test('Enter on an empty composer submits nothing', () => {
        const state: { posts: PostRecord[] } = { posts: [] };
        setFetchForTesting(fetchRouter(state));
        const view = harness();
        const input = openComposer(view);

        fireComposerKeyDown(input, { key: 'Enter' });

        expect(state.posts).toHaveLength(0);
        expect(view.container.querySelector('[data-receipt-state]')).toBeNull();
        view.unmount();
    });
});
