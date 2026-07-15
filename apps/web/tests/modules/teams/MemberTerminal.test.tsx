registerHappyDom();

import { afterAll, describe, expect, test } from 'bun:test';
import { act, render, waitFor } from '@testing-library/react';
import React from 'react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import MemberTerminal, {
    appendFrame,
    type Frame,
    nextBackoff,
    parseFrame,
    parseProcessList,
    stdinUrl,
    streamUrl,
} from '../../../src/modules/teams/MemberTerminal';
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

// ── Pure function tests ────────────────────────────────────────────────

describe('parseFrame', () => {
    test('accepts a well-formed stdout frame with seq', () => {
        const f = parseFrame({ stream: 'stdout', ts: '2026-01-01T00:00:00Z', line: 'hello', seq: 5 });
        expect(f).toEqual({ stream: 'stdout', ts: '2026-01-01T00:00:00Z', line: 'hello', seq: 5 });
    });

    test('accepts a meta frame without seq', () => {
        const f = parseFrame({ stream: 'meta', ts: '2026-01-01T00:00:00Z', line: '--replay-done--' });
        expect(f).toEqual({ stream: 'meta', ts: '2026-01-01T00:00:00Z', line: '--replay-done--' });
    });

    test('rejects null / non-object / missing fields', () => {
        expect(parseFrame(null)).toBeNull();
        expect(parseFrame('string')).toBeNull();
        expect(parseFrame({ stream: 'stdout' })).toBeNull();
        expect(parseFrame({ stream: 'stdout', ts: 'x' })).toBeNull();
        expect(parseFrame({ stream: 'invalid', ts: 'x', line: 'y' })).toBeNull();
    });

    test('rejects non-number seq', () => {
        expect(parseFrame({ stream: 'stdout', ts: 'x', line: 'y', seq: '5' })).toBeNull();
    });
});

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
});

describe('appendFrame', () => {
    test('appends a stdout frame with seq > lastSeq and updates watermark', () => {
        const result = appendFrame([], { stream: 'stdout', ts: 'x', line: 'a', seq: 1 }, -1);
        expect(result.frames).toHaveLength(1);
        expect(result.lastSeq).toBe(1);
    });

    test('drops a frame with seq <= lastSeq (dedup, R6)', () => {
        const result = appendFrame([], { stream: 'stdout', ts: 'x', line: 'dup', seq: 1 }, 1);
        expect(result.frames).toHaveLength(0);
        expect(result.lastSeq).toBe(1);
    });

    test('always appends meta frames (no seq)', () => {
        const result = appendFrame([], { stream: 'meta', ts: 'x', line: '--replay-done--' }, 5);
        expect(result.frames).toHaveLength(1);
        expect(result.lastSeq).toBe(5);
    });

    test('caps the buffer at MAX_FRAMES (1000)', () => {
        let frames: Frame[] = [];
        let lastSeq = -1;
        for (let i = 0; i < 1050; i++) {
            const r = appendFrame(frames, { stream: 'stdout', ts: 'x', line: `l${i}`, seq: i }, lastSeq);
            frames = r.frames;
            lastSeq = r.lastSeq;
        }
        expect(frames.length).toBe(1000);
        expect(lastSeq).toBe(1049);
    });
});

describe('nextBackoff', () => {
    test('returns 1s for attempt 0', () => {
        expect(nextBackoff(0)).toBe(1000);
    });

    test('schedules exponentially: 1s, 2s, 4s, 8s', () => {
        expect(nextBackoff(1)).toBe(2000);
        expect(nextBackoff(2)).toBe(4000);
        expect(nextBackoff(3)).toBe(8000);
    });

    test('caps at 15s', () => {
        expect(nextBackoff(4)).toBe(15_000);
        expect(nextBackoff(10)).toBe(15_000);
    });

    test('returns 1s for negative attempt (safety)', () => {
        expect(nextBackoff(-1)).toBe(1000);
    });
});

describe('stdinUrl / streamUrl', () => {
    test('AC2: stdin endpoint is correctly constructed for POST', () => {
        const url = stdinUrl('alpha-claude');
        expect(url).toContain('/team/processes/alpha-claude/stdin');
    });

    test('AC4: stream endpoint includes sinceSeq for resume on reconnect', () => {
        const url = streamUrl('alpha-claude', 42);
        expect(url).toContain('/team/processes/alpha-claude/stream');
        expect(url).toContain('sinceSeq=42');
    });

    test('AC4: stream endpoint omits sinceSeq for initial attach', () => {
        const url = streamUrl('alpha-claude');
        expect(url).toContain('/team/processes/alpha-claude/stream');
        expect(url).not.toContain('sinceSeq');
    });
});

// ── Component rendering tests ─────────────────────────────────────────

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
        expect(es.url).toContain('/team/processes/alpha-claude/stream');

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
        expect(secondEs.url).toContain('/team/processes/reconnect-test/stream');

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
        expect(stdinPost?.url).toContain('/team/processes/send-agent/stdin');
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
});
