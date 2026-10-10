registerHappyDom();

import { afterAll, describe, expect, test } from 'bun:test';
import { act, render, waitFor } from '@testing-library/react';
import React from 'react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import MemberTerminal, { parseProcessList, stdinUrl } from '../../../src/modules/projects/MemberTerminal';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

/** Cast a mock fetch fn to typeof fetch (the real fetch has preconnect etc). */
function mockFetch(fn: (req: Request) => Promise<Response>): typeof fetch {
    return fn as unknown as typeof fetch;
}

interface MockEventSource {
    url: string;
    onmessage: ((event: { data: string }) => void) | null;
    onerror: (() => void) | null;
    close: () => void;
    _push: (data: unknown) => void;
    _error: () => void;
    _closed: boolean;
}

let mockSources: MockEventSource[] = [];
let originalEventSource: unknown;

function installMockEventSource(): void {
    originalEventSource = (globalThis as Record<string, unknown>).EventSource;
    const factory = function MockEventSourceImpl(url: string): MockEventSource {
        const inst: MockEventSource = {
            url,
            onmessage: null,
            onerror: null,
            _closed: false,
            close() {
                inst._closed = true;
            },
            _push(data: unknown) {
                if (inst._closed) return;
                inst.onmessage?.({ data: JSON.stringify(data) });
            },
            _error() {
                if (inst._closed) return;
                inst.onerror?.();
            },
        };
        mockSources.push(inst);
        return inst;
    };
    Object.defineProperty(globalThis, 'EventSource', { value: factory, writable: true, configurable: true });
}

function restoreEventSource(): void {
    if (originalEventSource !== undefined) {
        Object.defineProperty(globalThis, 'EventSource', {
            value: originalEventSource,
            writable: true,
            configurable: true,
        });
    } else {
        Object.defineProperty(globalThis, 'EventSource', { value: undefined, writable: true, configurable: true });
    }
}

function resetMockSources(): void {
    mockSources = [];
}

/**
 * Scoped fake `setTimeout`/`clearTimeout` (1163): the reconnect backoff is a real
 * 1000 ms wall-clock sleep otherwise. Only the window between scheduling and
 * advancing is faked, so `waitFor` and the status poll — which run on real timers —
 * are unaffected; `restore()` puts both globals back and belongs in a `finally`.
 */
interface ScopedTimers {
    handles: number[];
    delays: number[];
    cleared: number[];
    advanceByDelay: (delay: number) => void;
    restore: () => void;
}

function scopedFakeTimeouts(): ScopedTimers {
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const pending = new Map<number, () => void>();
    const timers: ScopedTimers = {
        handles: [],
        delays: [],
        cleared: [],
        advanceByDelay(delay) {
            for (const [id, fn] of [...pending]) {
                const index = timers.handles.indexOf(id);
                if (timers.delays[index] === delay) {
                    pending.delete(id);
                    fn();
                }
            }
        },
        restore() {
            Object.defineProperty(globalThis, 'setTimeout', {
                value: realSetTimeout,
                writable: true,
                configurable: true,
            });
            Object.defineProperty(globalThis, 'clearTimeout', {
                value: realClearTimeout,
                writable: true,
                configurable: true,
            });
        },
    };
    let next = 1;
    Object.defineProperty(globalThis, 'setTimeout', {
        value: (fn: () => void, delay?: number) => {
            const id = next++;
            pending.set(id, fn);
            timers.handles.push(id);
            timers.delays.push(delay ?? 0);
            return id;
        },
        writable: true,
        configurable: true,
    });
    Object.defineProperty(globalThis, 'clearTimeout', {
        value: (id: number) => {
            timers.cleared.push(id);
            pending.delete(id);
        },
        writable: true,
        configurable: true,
    });
    return timers;
}

/** The keyed caller under test: the identity key MemberDetail puts on the terminal (1163 R1). */
const KeyedTerminal = ({ agentId, sessionId }: { agentId: string; sessionId: string }) =>
    React.createElement(MemberTerminal, { key: agentId, agentId, sessionId });

/**
 * Read a node's React fiber props (`onChange`, `onKeyDown`, …) and invoke the
 * handler directly. happy-dom + React 19 do not deliver `fireEvent.change` to a
 * controlled input's onChange (capricorn86/happy-dom#856), so — matching the
 * sibling `components.test.tsx` convention — the test bypasses DOM dispatch and
 * reads the handler off the real node.
 */
function reactProps(el: Element): Record<string, unknown> | undefined {
    const holder = el as unknown as Record<string, Record<string, unknown> | undefined>;
    const key = Object.keys(holder).find((k) => k.startsWith('__reactProps$'));
    return key ? holder[key] : undefined;
}

function findByText(container: HTMLElement, text: string): HTMLElement | null {
    const all = container.querySelectorAll('*');
    for (const el of Array.from(all)) {
        if (el.textContent === text) return el as HTMLElement;
    }
    return null;
}

// ── Pure function tests (0422 R9: parseFrame/appendFrame/nextBackoff/streamUrl
//    moved to tests/lib/process-stream.test.ts) ─────────────────────────────

describe('parseProcessList', () => {
    test('accepts a well-formed response', () => {
        const list = parseProcessList({
            processes: [
                { agentId: 'alpha-claude', pid: 123, status: 'running', startedAt: 'x', exitCode: null },
                { agentId: 'beta-omp', pid: 456, status: 'exited', startedAt: 'y', exitCode: 0 },
            ],
        });
        expect(list).toHaveLength(2);
        expect(list?.[0]?.status).toBe('running');
    });

    test('rejects malformed input', () => {
        expect(parseProcessList(null)).toBeNull();
        expect(parseProcessList({})).toBeNull();
        expect(parseProcessList({ processes: 'not-array' })).toBeNull();
        expect(parseProcessList({ processes: [{ agentId: 1 }] })).toBeNull();
    });

    test('0897: a well-formed session passes through; malformed sessions are dropped, not fatal', () => {
        const list = parseProcessList({
            processes: [
                {
                    agentId: 'a',
                    pid: 1,
                    status: 'running',
                    startedAt: 'x',
                    exitCode: null,
                    session: { mode: 'resume', id: 'sess-9' },
                },
                { agentId: 'b', pid: 2, status: 'running', startedAt: 'x', exitCode: null, session: 'bogus' },
                { agentId: 'c', pid: 3, status: 'running', startedAt: 'x', exitCode: null },
            ],
        });
        expect(list?.[0]?.session).toEqual({ mode: 'resume', id: 'sess-9' });
        expect(list?.[1]?.session).toBeUndefined();
        expect(list?.[2]?.session).toBeUndefined();
    });
});

// ── Component rendering tests ─────────────────────────────────────────

describe('stdinUrl', () => {
    test('AC2: stdin endpoint is correctly constructed for POST', () => {
        const url = stdinUrl('alpha-claude');
        expect(url).toContain('/processes/alpha-claude/stdin');
    });
});

describe('MemberTerminal (component)', () => {
    afterAll(async () => {
        // Must await: teardownHappyDom unregisters happy-dom asynchronously, and an
        // un-awaited teardown lets the unregister call land inside the next test
        // file, tearing its DOM out mid-run (tests/happy-dom.ts).
        await teardownHappyDom();
        restoreEventSource();
    });

    test('AC1: mounting opens an EventSource to /stream and renders pushed frames', async () => {
        installMockEventSource();
        resetMockSources();
        setFetchForTesting(mockFetch(async () => new Response(JSON.stringify({ processes: [] }), { status: 200 })));

        const { container } = render(React.createElement(MemberTerminal, { agentId: 'alpha-claude' }));

        await waitFor(() => expect(mockSources.length).toBe(1));
        const es = mockSources[0] as MockEventSource;
        expect(es.url).toContain('/processes/alpha-claude/stream');

        act(() => {
            es._push({ stream: 'stdout', ts: '2026-01-01T00:00:00Z', line: 'hello world', seq: 1 });
        });

        await waitFor(() => {
            expect(findByText(container, 'hello world')).not.toBeNull();
        });

        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });

    test('0263 R4: header surfaces composed agentId; empty output is context-aware (R3)', async () => {
        installMockEventSource();
        resetMockSources();
        setFetchForTesting(mockFetch(async () => new Response(JSON.stringify({ processes: [] }), { status: 200 })));

        const { container } = render(React.createElement(MemberTerminal, { agentId: 'alpha-claude' }));

        // Header shows the composed agent id next to Terminal label.
        await waitFor(() => {
            const root = container.querySelector('[data-member-terminal="alpha-claude"]');
            expect(root).not.toBeNull();
            expect(root?.textContent).toContain('alpha-claude');
        });
        // Status + connected indicators remain present.
        expect(container.querySelector('[data-terminal-status]')).not.toBeNull();
        expect(container.querySelector('[data-terminal-connected]')).not.toBeNull();
        // Empty buffer copy is agent-specific (not the old generic "No output yet.").
        const out = container.querySelector('[data-terminal-output]');
        expect(out?.textContent).toContain('Waiting for output from alpha-claude');
        expect(out?.textContent).not.toContain('No output yet.');

        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });

    test('renders session badge in header when sessionId is provided', async () => {
        installMockEventSource();
        resetMockSources();
        setFetchForTesting(mockFetch(async () => new Response(JSON.stringify({ processes: [] }), { status: 200 })));

        const { container } = render(
            React.createElement(MemberTerminal, { agentId: 'alpha-claude', sessionId: 'sess-abc12345-xyz' }),
        );

        await waitFor(() => {
            const sessionBadge = container.querySelector('[data-terminal-session]');
            expect(sessionBadge).not.toBeNull();
            expect(sessionBadge?.textContent).toContain('sess:sess-abc');
            expect(sessionBadge?.getAttribute('title')).toBe('Session ID: sess-abc12345-xyz');
        });

        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });

    test('AC6: stderr frames are styled distinctly from stdout', async () => {
        installMockEventSource();
        resetMockSources();
        setFetchForTesting(mockFetch(async () => new Response(JSON.stringify({ processes: [] }), { status: 200 })));

        const { container } = render(React.createElement(MemberTerminal, { agentId: 'test-agent' }));

        await waitFor(() => expect(mockSources.length).toBe(1));
        const es = mockSources[0] as MockEventSource;

        act(() => {
            es._push({ stream: 'stdout', ts: 'x', line: 'normal output', seq: 1 });
            es._push({ stream: 'stderr', ts: 'x', line: 'error output', seq: 2 });
        });

        await waitFor(() => {
            const stdoutEl = findByText(container, 'normal output');
            const stderrEl = findByText(container, 'error output');
            expect(stdoutEl).not.toBeNull();
            expect(stderrEl).not.toBeNull();
            expect(stdoutEl?.getAttribute('data-stream')).toBe('stdout');
            expect(stderrEl?.getAttribute('data-stream')).toBe('stderr');
            expect(stderrEl?.className).toContain('text-error');
            expect(stdoutEl?.className).not.toContain('text-error');
        });

        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });

    test('AC3: when status is not running, input is disabled and a status banner shows', async () => {
        installMockEventSource();
        resetMockSources();
        setFetchForTesting(
            mockFetch(
                async () =>
                    new Response(
                        JSON.stringify({
                            processes: [
                                {
                                    agentId: 'stopped-agent',
                                    pid: 99,
                                    status: 'stopped',
                                    startedAt: 'x',
                                    exitCode: null,
                                },
                            ],
                        }),
                        { status: 200 },
                    ),
            ),
        );

        const { container } = render(React.createElement(MemberTerminal, { agentId: 'stopped-agent' }));

        await waitFor(() => {
            const input = container.querySelector('[data-terminal-input]') as HTMLInputElement;
            expect(input).not.toBeNull();
            expect(input.disabled).toBe(true);
        });

        const banner = container.querySelector('[data-status-banner]');
        expect(banner).not.toBeNull();
        expect(banner?.textContent).toContain('stopped');

        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });

    test('AC2: input is enabled when member is running (POST target ready)', async () => {
        installMockEventSource();
        resetMockSources();
        setFetchForTesting(
            mockFetch(
                async () =>
                    new Response(
                        JSON.stringify({
                            processes: [
                                { agentId: 'run-agent', pid: 1, status: 'running', startedAt: 'x', exitCode: null },
                            ],
                        }),
                        { status: 200 },
                    ),
            ),
        );

        const { container } = render(React.createElement(MemberTerminal, { agentId: 'run-agent' }));

        await waitFor(() => {
            const el = container.querySelector('[data-terminal-input]') as HTMLInputElement;
            expect(el).not.toBeNull();
            expect(el.disabled).toBe(false);
            expect(el.placeholder).toContain('Type a line');
        });

        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });

    test('AC5: unmount calls EventSource.close() — no leaked connections', async () => {
        installMockEventSource();
        resetMockSources();
        setFetchForTesting(mockFetch(async () => new Response(JSON.stringify({ processes: [] }), { status: 200 })));

        const { unmount } = render(React.createElement(MemberTerminal, { agentId: 'leak-test' }));

        await waitFor(() => expect(mockSources.length).toBe(1));
        const es = mockSources[0] as MockEventSource;

        let closed = false;
        const origClose = es.close.bind(es);
        es.close = () => {
            closed = true;
            origClose();
        };

        unmount();

        expect(closed).toBe(true);
        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });

    test('AC4: on EventSource error, retries with backoff (reconnect)', async () => {
        installMockEventSource();
        resetMockSources();
        setFetchForTesting(mockFetch(async () => new Response(JSON.stringify({ processes: [] }), { status: 200 })));

        render(React.createElement(MemberTerminal, { agentId: 'reconnect-test' }));

        await waitFor(() => expect(mockSources.length).toBe(1));
        const firstEs = mockSources[0] as MockEventSource;

        act(() => {
            firstEs._error();
        });

        await waitFor(
            () => {
                expect(mockSources.length).toBe(2);
            },
            { timeout: 3000 },
        );

        const secondEs = mockSources[1] as MockEventSource;
        expect(secondEs.url).toContain('/processes/reconnect-test/stream');

        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });

    test('AC2: typing a line + Enter POSTs {line} to stdin and clears input on 200', async () => {
        installMockEventSource();
        resetMockSources();
        const posted: { url: string; method: string; body: string }[] = [];
        setFetchForTesting(
            mockFetch(async (req: Request) => {
                if (req.method === 'POST') {
                    posted.push({ url: req.url, method: req.method, body: await req.text() });
                    return new Response(JSON.stringify({ ok: true }), { status: 200 });
                }
                return new Response(
                    JSON.stringify({
                        processes: [
                            { agentId: 'send-agent', pid: 1, status: 'running', startedAt: 'x', exitCode: null },
                        ],
                    }),
                    { status: 200 },
                );
            }),
        );

        const { container } = render(React.createElement(MemberTerminal, { agentId: 'send-agent' }));

        // Wait for the status poll to enable the input (member is running).
        let input!: HTMLInputElement;
        await waitFor(() => {
            input = container.querySelector('[data-terminal-input]') as HTMLInputElement;
            expect(input).not.toBeNull();
            expect(input.disabled).toBe(false);
        });

        act(() => {
            (reactProps(input)?.onChange as (e: { target: { value: string } }) => void)?.({
                target: { value: 'ls -la' },
            });
        });
        await act(async () => {
            const fresh = container.querySelector('[data-terminal-input]') as HTMLInputElement;
            (reactProps(fresh)?.onKeyDown as (e: { key: string; preventDefault: () => void }) => void)?.({
                key: 'Enter',
                preventDefault() {},
            });
        });

        // Two POSTs fire: stdin + messages (0261 R2).
        await waitFor(() => expect(posted.length).toBeGreaterThanOrEqual(1));
        await waitFor(() => expect(posted.length).toBe(2));

        // Stdin POST.
        const stdinPost = posted.find((p) => p.url.includes('/stdin'));
        expect(stdinPost?.method).toBe('POST');
        expect(stdinPost?.url).toContain('/processes/send-agent/stdin');
        expect(JSON.parse(stdinPost?.body ?? '{}')).toEqual({ line: 'ls -la' });

        // Message POST (0261 R2).
        const msgPost = posted.find((p) => p.url.includes('/messages'));
        expect(msgPost?.method).toBe('POST');
        expect(JSON.parse(msgPost?.body ?? '{}')).toEqual({
            from: 'terminal',
            to: 'send-agent',
            body: 'ls -la',
        });

        // Input clears on a 200 (R2 clear-on-success).
        await waitFor(() => {
            const el = container.querySelector('[data-terminal-input]') as HTMLInputElement;
            expect(el.value).toBe('');
        });

        // R1/R3: local echo meta frame appears immediately.
        const echoEl = container.querySelector('[data-stream="meta"]');
        expect(echoEl).not.toBeNull();
        expect(echoEl?.textContent).toBe('> ls -la');

        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });

    test('AC2: on a failed stdin POST, the typed text is retained and an error is shown', async () => {
        installMockEventSource();
        resetMockSources();
        setFetchForTesting(
            mockFetch(async (req: Request) => {
                if (req.method === 'POST') {
                    return new Response(JSON.stringify({ error: 'process not writable' }), { status: 500 });
                }
                return new Response(
                    JSON.stringify({
                        processes: [
                            { agentId: 'fail-agent', pid: 1, status: 'running', startedAt: 'x', exitCode: null },
                        ],
                    }),
                    { status: 200 },
                );
            }),
        );

        const { container } = render(React.createElement(MemberTerminal, { agentId: 'fail-agent' }));

        let input!: HTMLInputElement;
        await waitFor(() => {
            input = container.querySelector('[data-terminal-input]') as HTMLInputElement;
            expect(input).not.toBeNull();
            expect(input.disabled).toBe(false);
        });

        act(() => {
            (reactProps(input)?.onChange as (e: { target: { value: string } }) => void)?.({
                target: { value: 'broken cmd' },
            });
        });
        await act(async () => {
            const fresh = container.querySelector('[data-terminal-input]') as HTMLInputElement;
            (reactProps(fresh)?.onKeyDown as (e: { key: string; preventDefault: () => void }) => void)?.({
                key: 'Enter',
                preventDefault() {},
            });
        });

        // The server error surfaces to the operator (R2 error shown).
        await waitFor(() => {
            const err = container.querySelector('[data-input-error]');
            expect(err).not.toBeNull();
            expect(err?.textContent).toContain('process not writable');
        });

        // The typed text is NOT lost on failure (R2 retain-on-failure).
        const el = container.querySelector('[data-terminal-input]') as HTMLInputElement;
        expect(el.value).toBe('broken cmd');

        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });

    test('AC1: frames render newest at the bottom (DOM order)', async () => {
        installMockEventSource();
        resetMockSources();
        setFetchForTesting(mockFetch(async () => new Response(JSON.stringify({ processes: [] }), { status: 200 })));

        const { container } = render(React.createElement(MemberTerminal, { agentId: 'order-test' }));

        await waitFor(() => expect(mockSources.length).toBe(1));
        const es = mockSources[0] as MockEventSource;

        act(() => {
            es._push({ stream: 'stdout', ts: 'x', line: 'first', seq: 1 });
            es._push({ stream: 'stdout', ts: 'x', line: 'second', seq: 2 });
            es._push({ stream: 'stdout', ts: 'x', line: 'third', seq: 3 });
        });

        await waitFor(() => {
            expect(findByText(container, 'first')).not.toBeNull();
            expect(findByText(container, 'third')).not.toBeNull();
        });

        const output = container.querySelector('[data-terminal-output]');
        const lines = output?.querySelectorAll('[data-stream]') ?? [];
        expect(lines.length).toBe(3);
        expect(lines[0]?.textContent).toBe('first');
        expect(lines[1]?.textContent).toBe('second');
        expect(lines[2]?.textContent).toBe('third');

        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });
    test('1163 R2: same-agent reconnect resumes sinceSeq=100 and dedup survives it', async () => {
        installMockEventSource();
        resetMockSources();
        setFetchForTesting(mockFetch(async () => new Response(JSON.stringify({ processes: [] }), { status: 200 })));

        const { container } = render(React.createElement(MemberTerminal, { agentId: 'resume-agent' }));

        await waitFor(() => expect(mockSources.length).toBe(1));
        const first = mockSources[0] as MockEventSource;
        act(() => {
            first._push({ stream: 'stdout', ts: 'x', line: 'before', seq: 100 });
        });
        await waitFor(() => expect(findByText(container, 'before')).not.toBeNull());

        const timers = scopedFakeTimeouts();
        try {
            act(() => {
                first._error();
            });
            expect(timers.delays).toEqual([1000]); // nextBackoff(0) — advanced, not slept
            act(() => {
                timers.advanceByDelay(1000);
            });
        } finally {
            timers.restore();
        }

        await waitFor(() => expect(mockSources.length).toBe(2));
        const second = mockSources[1] as MockEventSource;
        // Same agent: the cursor is resumed, not restarted.
        expect(second.url).toContain('/processes/resume-agent/stream?sinceSeq=100');

        act(() => {
            second._push({ stream: 'stdout', ts: 'x', line: 'duplicate', seq: 100 });
            second._push({ stream: 'stdout', ts: 'x', line: 'after', seq: 101 });
        });
        await waitFor(() => expect(findByText(container, 'after')).not.toBeNull());
        expect(findByText(container, 'duplicate')).toBeNull();

        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });

    test('1163 R2: the keyed caller keeps the stream and cursor when only sessionId changes', async () => {
        installMockEventSource();
        resetMockSources();
        setFetchForTesting(mockFetch(async () => new Response(JSON.stringify({ processes: [] }), { status: 200 })));

        const view = render(React.createElement(KeyedTerminal, { agentId: 'stable-agent', sessionId: 'sess-one-1' }));

        await waitFor(() => expect(mockSources.length).toBe(1));
        const es = mockSources[0] as MockEventSource;
        act(() => {
            es._push({ stream: 'stdout', ts: 'x', line: 'kept', seq: 100 });
        });
        await waitFor(() => expect(findByText(view.container, 'kept')).not.toBeNull());

        // Display metadata only — same agentId, so the same key: no remount, no reset.
        view.rerender(React.createElement(KeyedTerminal, { agentId: 'stable-agent', sessionId: 'sess-two-2' }));

        await waitFor(() =>
            expect(view.container.querySelector('[data-terminal-session]')?.textContent).toContain('sess:sess-two'),
        );
        expect(mockSources.length).toBe(1);
        expect(es._closed).toBe(false);
        expect(findByText(view.container, 'kept')).not.toBeNull();

        // The cursor still dedups — a replayed 100 does not reappear.
        act(() => {
            es._push({ stream: 'stdout', ts: 'x', line: 'kept', seq: 100 });
        });
        const lines = view.container.querySelectorAll('[data-terminal-output] [data-stream]');
        expect(lines.length).toBe(1);

        view.unmount();
        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });

    test('1163 R2: a pending reconnect is cancelled when the keyed caller switches agent', async () => {
        installMockEventSource();
        resetMockSources();
        setFetchForTesting(mockFetch(async () => new Response(JSON.stringify({ processes: [] }), { status: 200 })));

        const view = render(React.createElement(KeyedTerminal, { agentId: 'alpha-key', sessionId: 's1' }));

        await waitFor(() => expect(mockSources.length).toBe(1));
        const alphaEs = mockSources[0] as MockEventSource;

        const timers = scopedFakeTimeouts();
        try {
            act(() => {
                alphaEs._error();
            });
            expect(timers.delays).toEqual([1000]);

            act(() => {
                view.rerender(React.createElement(KeyedTerminal, { agentId: 'beta-key', sessionId: 's1' }));
            });
            // The keyed remount cleared alpha's pending reconnect timer.
            const alphaTimer = timers.handles[0];
            expect(alphaTimer).toBeDefined();
            expect(alphaTimer !== undefined && timers.cleared.includes(alphaTimer)).toBe(true);
            expect(alphaEs._closed).toBe(true);

            const streamsAfterSwitch = mockSources.length;
            act(() => {
                timers.advanceByDelay(1000);
            });
            expect(mockSources.length).toBe(streamsAfterSwitch); // no new alpha stream
            expect(mockSources.some((s) => s.url.includes('alpha-key') && !s._closed)).toBe(false);
        } finally {
            timers.restore();
        }

        view.unmount();
        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });

    test('1163 R2: unmount clears the status interval and aborts the in-flight poll', async () => {
        installMockEventSource();
        resetMockSources();
        let pendingPoll: Request | undefined;
        let polls = 0;
        setFetchForTesting(
            mockFetch(async (req: Request) => {
                if (req.method === 'GET' && polls++ === 0) {
                    pendingPoll = req;
                    return new Promise<Response>(() => {});
                }
                return new Response(JSON.stringify({ processes: [] }), { status: 200 });
            }),
        );

        const { unmount } = render(React.createElement(MemberTerminal, { agentId: 'unmount-agent' }));
        await waitFor(() => expect(mockSources.length).toBe(1));
        expect(pendingPoll?.signal.aborted).toBe(false);

        const cleared: unknown[] = [];
        const realClearInterval = globalThis.clearInterval;
        Object.defineProperty(globalThis, 'clearInterval', {
            value: (handle: unknown) => {
                cleared.push(handle);
                (realClearInterval as (h: unknown) => void)(handle);
            },
            writable: true,
            configurable: true,
        });
        try {
            unmount();
        } finally {
            Object.defineProperty(globalThis, 'clearInterval', {
                value: realClearInterval,
                writable: true,
                configurable: true,
            });
        }

        expect(cleared.length).toBe(1); // STATUS_POLL_MS interval
        expect(pendingPoll?.signal.aborted).toBe(true);
        expect((mockSources[0] as MockEventSource)._closed).toBe(true);

        resetFetchForTesting();
        restoreEventSource();
        resetMockSources();
    });
});
