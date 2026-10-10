/**
 * Isolated-process terminal-identity regressions for 1163 (AC1/AC2) — driven by
 * `member-terminal-identity.test.ts`.
 *
 * Why a second file: every sibling project suite installs a process-global fake
 * `EventSource` (MemberDetail/AgentsView/a11y/responsive), and Bun's "last
 * registration wins" for the whole run means a stream we push frames into here
 * would be someone else's stub. The real `MemberDetail` + real `MemberTerminal`
 * alpha→beta regression needs its own controllable stream, so this file runs in a
 * fresh Bun process (`bun test --isolate ./<this file>`). Its name deliberately
 * omits `.test`/`.spec` so the aggregate runner never collects it.
 */
registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import MemberDetail from '../../../src/modules/projects/MemberDetail';
import ProcessesView from '../../../src/modules/projects/ProcessesView';
import type { RosterEntry } from '../../../src/modules/projects/roster';
import { ProjectContext, type ProjectFleetSnapshot } from '../../../src/modules/projects/useProjectContext';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

afterAll(async () => {
    await teardownHappyDom();
    restoreEventSource();
});

// ── Controllable EventSource (own process: no sibling stub can steal it) ─────

interface ControlledStream {
    url: string;
    onmessage: ((event: { data: string }) => void) | null;
    onerror: (() => void) | null;
    closed: boolean;
    close: () => void;
}

const streams: ControlledStream[] = [];
let OriginalEventSource: unknown;

function installControlledEventSource(): void {
    OriginalEventSource = (globalThis as Record<string, unknown>).EventSource;
    const factory = function ControlledEventSourceImpl(url: string): ControlledStream {
        const inst: ControlledStream = {
            url,
            onmessage: null,
            onerror: null,
            closed: false,
            close() {
                inst.closed = true;
            },
        };
        streams.push(inst);
        return inst;
    };
    Object.defineProperty(globalThis, 'EventSource', { value: factory, writable: true, configurable: true });
}

function restoreEventSource(): void {
    Object.defineProperty(globalThis, 'EventSource', {
        value: OriginalEventSource,
        writable: true,
        configurable: true,
    });
}
installControlledEventSource();

const frames = (line: string, seq: number) => ({ stream: 'stdout', ts: '2026-10-10T00:00:00Z', line, seq });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** Yield the microtask/macrotask queue so a status poll or render settles. */
async function flush(): Promise<void> {
    await act(async () => {});
    await act(async () => {});
}

/** Read a node's React fiber props (same convention as MemberTerminal.test.tsx). */
function reactProps(el: Element): Record<string, unknown> | undefined {
    const holder = el as unknown as Record<string, Record<string, unknown> | undefined>;
    const key = Object.keys(holder).find((k) => k.startsWith('__reactProps$'));
    return key ? holder[key] : undefined;
}

afterEach(() => {
    cleanup();
    resetFetchForTesting();
    streams.length = 0;
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

function detailEntry(instanceId: string, sessionId?: string): RosterEntry {
    return {
        instanceId,
        declared: {
            instanceId,
            role: 'builder',
            executor: 'claude',
            enabled: true,
            writeCapable: true,
            capabilityState: 'active',
        },
        observed: {
            status: 'running',
            pid: 11,
            startedAt: '2026-10-10T00:00:00.000Z',
            exitCode: null,
            session: sessionId === undefined ? null : { mode: 'persistent', id: sessionId },
        },
        isOrchestrator: false,
        issues: [],
    };
}

const detail = (entry: RosterEntry): ReactElement => <MemberDetail entry={entry} onClose={() => {}} />;

/** Status poll: `running` for the listed agents, everything else idles. */
function statusFetch(running: readonly string[], stdinStatus = 500) {
    return (async (input: RequestInfo | URL) => {
        const req = input as Request;
        const url = new URL(req.url);
        if (url.pathname.endsWith('/processes')) {
            return json({
                processes: running.map((agentId) => ({
                    agentId,
                    pid: 11,
                    status: 'running',
                    startedAt: 'x',
                    exitCode: null,
                })),
            });
        }
        if (url.pathname.endsWith('/stdin')) {
            return stdinStatus === 200
                ? json({ ok: true })
                : new Response(JSON.stringify({ error: 'process not writable' }), { status: stdinStatus });
        }
        return json({ ok: true });
    }) as unknown as typeof fetch;
}

const typeAndEnter = async (container: HTMLElement, text: string): Promise<void> => {
    const input = container.querySelector('[data-terminal-input]') as HTMLInputElement;
    expect(input.disabled).toBe(false);
    act(() => {
        (reactProps(input)?.onChange as (e: { target: { value: string } }) => void)?.({ target: { value: text } });
    });
    await act(async () => {
        const fresh = container.querySelector('[data-terminal-input]') as HTMLInputElement;
        (reactProps(fresh)?.onKeyDown as (e: { key: string; preventDefault: () => void }) => void)?.({
            key: 'Enter',
            preventDefault() {},
        });
    });
};

const outputLines = (container: HTMLElement): string[] =>
    [...container.querySelectorAll('[data-stream]')].map((el) => el.textContent ?? '');

// ── AC1 — switching agent identity remounts the terminal ─────────────────────

describe('MemberDetail: agent-identity selection (1163 R1)', () => {
    test('real MemberDetail: alpha@seq100 → beta@seq20 drops alpha state and replays beta', async () => {
        setFetchForTesting(statusFetch(['alpha']));
        const view = render(detail(detailEntry('alpha')));

        // alpha: running status arrives, output at seq 100, typed input that fails
        // its stdin POST (so a non-default status AND an input error are on screen).
        await flush();
        act(() => streams[0]?.onmessage?.({ data: JSON.stringify(frames('alpha-line', 100)) }));
        await flush();
        await typeAndEnter(view.container, 'alpha-typed');

        expect(outputLines(view.container)).toContain('alpha-line');
        expect(view.container.querySelector('[data-terminal-status]')?.textContent).toBe('running');
        expect((view.container.querySelector('[data-terminal-input]') as HTMLInputElement).value).toBe('alpha-typed');
        expect(view.container.querySelector('[data-input-error]')?.textContent).toContain('process not writable');
        const alphaStream = streams[0] as ControlledStream;

        // switch identity — same caller, different agentId (MemberDetail's key).
        view.rerender(detail(detailEntry('beta')));
        await flush();

        expect(streams.length).toBe(2);
        const betaStream = streams[1] as ControlledStream;
        expect(alphaStream.closed).toBe(true); // old stream closed by the remount cleanup
        expect(betaStream.url).toContain('/processes/beta/stream');
        expect(betaStream.url).not.toContain('sinceSeq'); // fresh cursor, not alpha's 100
        expect(view.container.querySelector('[data-member-terminal="beta"]')).not.toBeNull();
        expect(view.container.querySelector('[data-member-terminal="alpha"]')).toBeNull();

        // alpha's output, input, error and status are gone.
        expect(outputLines(view.container)).not.toContain('alpha-line');
        expect((view.container.querySelector('[data-terminal-input]') as HTMLInputElement).value).toBe('');
        expect(view.container.querySelector('[data-input-error]')).toBeNull();
        expect(view.container.querySelector('[data-terminal-status]')?.textContent).toBe('unknown');

        // beta's own replay from 20 renders (would have been dropped at cursor 100).
        act(() => betaStream.onmessage?.({ data: JSON.stringify(frames('beta-line', 20)) }));
        await flush();
        expect(outputLines(view.container)).toEqual(['beta-line']);
    });

    test('real MemberDetail: stale alpha callbacks cannot touch beta DOM', async () => {
        // alpha's status poll never resolves until we say so — a completion that
        // lands after the switch must not reach beta's terminal.
        let resolveAlphaStatus: ((res: Response) => void) | undefined;
        let alphaStatusRequest: Request | undefined;
        let polls = 0;
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const req = input as Request;
            const url = new URL(req.url);
            if (url.pathname.endsWith('/processes')) {
                // The first poll belongs to alpha's terminal — hold it open.
                if (polls++ === 0) {
                    alphaStatusRequest = req;
                    return new Promise<Response>((res) => {
                        resolveAlphaStatus = res;
                    });
                }
                return json({ processes: [] });
            }
            return json({ ok: true });
        }) as unknown as typeof fetch);

        const view = render(detail(detailEntry('alpha')));
        await flush();
        expect(alphaStatusRequest).toBeDefined();

        view.rerender(detail(detailEntry('beta')));
        await flush();

        // The unmount cleanup aborted alpha's in-flight status request.
        expect(alphaStatusRequest?.signal.aborted).toBe(true);

        // A late alpha status response must not set beta's status.
        await act(async () => {
            resolveAlphaStatus?.(
                json({ processes: [{ agentId: 'alpha', pid: 11, status: 'exited', startedAt: 'x', exitCode: 0 }] }),
            );
        });
        await flush();
        expect(view.container.querySelector('[data-terminal-status]')?.textContent).toBe('unknown');

        // A late frame on the closed alpha stream must not render into beta.
        act(() => streams[0]?.onmessage?.({ data: JSON.stringify(frames('alpha-late', 101)) }));
        await flush();
        expect(outputLines(view.container)).not.toContain('alpha-late');

        // And a late error must not schedule a reconnect from the dead instance.
        const scheduled: number[] = [];
        const realSetTimeout = globalThis.setTimeout;
        Object.defineProperty(globalThis, 'setTimeout', {
            value: (...args: unknown[]) => {
                scheduled.push(1);
                return (realSetTimeout as (...a: unknown[]) => unknown)(...args);
            },
            writable: true,
            configurable: true,
        });
        try {
            act(() => streams[0]?.onerror?.());
        } finally {
            Object.defineProperty(globalThis, 'setTimeout', {
                value: realSetTimeout,
                writable: true,
                configurable: true,
            });
        }
        expect(scheduled.length).toBe(0);
        expect(streams.length).toBe(2); // no third stream for the dead agent
    });

    test('real MemberDetail: session metadata changes keep the same stream and cursor', async () => {
        setFetchForTesting(statusFetch(['beta']));
        const view = render(detail(detailEntry('beta', 'sess-alpha-1234')));
        await flush();
        act(() => streams[0]?.onmessage?.({ data: JSON.stringify(frames('beta-line', 20)) }));
        await flush();
        expect(view.container.querySelector('[data-terminal-session]')?.textContent).toContain('sess:sess-alp');

        // Same agentId, only the display session changes — same key, no remount.
        view.rerender(detail(detailEntry('beta', 'sess-beta-5678')));
        await flush();

        expect(streams.length).toBe(1);
        expect(streams[0]?.closed).toBe(false);
        expect(view.container.querySelector('[data-terminal-session]')?.textContent).toContain('sess:sess-bet');
        expect(outputLines(view.container)).toEqual(['beta-line']);

        // The cursor survives: seq 20 is deduped, seq 21 appends.
        act(() => streams[0]?.onmessage?.({ data: JSON.stringify(frames('beta-line', 20)) }));
        await flush();
        expect(outputLines(view.container)).toEqual(['beta-line']);
        act(() => streams[0]?.onmessage?.({ data: JSON.stringify(frames('beta-next', 21)) }));
        await flush();
        expect(outputLines(view.container)).toEqual(['beta-line', 'beta-next']);
    });

    test('real MemberDetail: unmount aborts the status request and clears the poll interval', async () => {
        let statusRequest: Request | undefined;
        let polls = 0;
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const req = input as Request;
            const url = new URL(req.url);
            if (url.pathname.endsWith('/processes')) {
                // Hold the first poll open: an in-flight request is what unmount must abort.
                if (polls++ === 0) {
                    statusRequest = req;
                    return new Promise<Response>(() => {});
                }
                return json({ processes: [] });
            }
            return json({ ok: true });
        }) as unknown as typeof fetch);

        const view = render(detail(detailEntry('alpha')));
        await flush();
        expect(statusRequest?.signal.aborted).toBe(false);

        const cleared: unknown[] = [];
        const realClearInterval = globalThis.clearInterval;
        Object.defineProperty(globalThis, 'clearInterval', {
            value: (handle: unknown) => {
                cleared.push(handle);
                return (realClearInterval as (h: unknown) => void)(handle);
            },
            writable: true,
            configurable: true,
        });
        try {
            view.unmount();
        } finally {
            Object.defineProperty(globalThis, 'clearInterval', {
                value: realClearInterval,
                writable: true,
                configurable: true,
            });
        }
        expect(cleared.length).toBe(1); // the terminal's STATUS_POLL_MS interval
        expect(statusRequest?.signal.aborted).toBe(true);
        expect(streams[0]?.closed).toBe(true);
    });
});

// ── R1/R3 — the ProcessesView selection path reaches the same keyed seam ─────

describe('ProcessesView: selection reaches the shared keyed terminal (1163 R1)', () => {
    const snapshot: ProjectFleetSnapshot = {
        path: '/work/project',
        enabled: true,
        strategy: null,
        orchestrator: { state: 'missing' },
        members: [],
        capacity: { total: 0, enabled: 0, writeCapable: 0, missing: [] },
    };

    test('selecting a different watch row remounts the shared detail terminal', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const req = input as Request;
            const url = new URL(req.url);
            if (url.pathname.endsWith('/processes')) {
                return json({
                    processes: [
                        { agentId: 'alpha', pid: 11, status: 'running', startedAt: 'x', exitCode: null },
                        { agentId: 'beta', pid: 12, status: 'running', startedAt: 'x', exitCode: null },
                    ],
                    executions: [],
                });
            }
            return json({ ok: true });
        }) as unknown as typeof fetch);

        const view = render(
            <ProjectContext.Provider
                value={{ path: '/work/project', name: 'project', fleet: snapshot, state: 'ready' }}
            >
                <ProcessesView />
            </ProjectContext.Provider>,
        );
        await flush();

        const alphaRow = view.container.querySelector('[data-processes-row="sup:alpha"]') as HTMLElement;
        expect(alphaRow).not.toBeNull();
        act(() => fireEvent.click(alphaRow));
        await flush();
        expect(view.container.querySelector('[data-member-terminal="alpha"]')).not.toBeNull();
        const alphaStream = streams[0] as ControlledStream;
        expect(alphaStream.url).toContain('/processes/alpha/stream');
        act(() => alphaStream.onmessage?.({ data: JSON.stringify(frames('alpha-line', 100)) }));
        await flush();
        expect(outputLines(view.container)).toContain('alpha-line');

        const betaRow = view.container.querySelector('[data-processes-row="sup:beta"]') as HTMLElement;
        act(() => fireEvent.click(betaRow));
        await flush();

        expect(view.container.querySelector('[data-member-terminal="beta"]')).not.toBeNull();
        expect(view.container.querySelector('[data-member-terminal="alpha"]')).toBeNull();
        expect(alphaStream.closed).toBe(true);
        const betaStream = streams[1] as ControlledStream;
        expect(betaStream.url).toContain('/processes/beta/stream');
        expect(betaStream.url).not.toContain('sinceSeq'); // a shared cursor would resume at 100
        expect(outputLines(view.container)).not.toContain('alpha-line');
        act(() => betaStream.onmessage?.({ data: JSON.stringify(frames('beta-line', 20)) }));
        await flush();
        expect(outputLines(view.container)).toEqual(['beta-line']);
    });
});
