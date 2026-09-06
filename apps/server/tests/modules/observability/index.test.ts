import { afterEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { ServerContext } from '../../../src/context';
import {
    getLedgerWatcher,
    observabilityModule,
    resetLedgerWatcherForTests,
    resetRoleTokenSummaryForTesting,
    setRoleTokenSummaryForTesting,
    toolUseSsePayload,
} from '../../../src/modules/observability';

function mountWithInventory(
    snapshot: unknown,
    snapshotImpl?: () => Promise<unknown>,
    tokenLedger?: {
        snapshot: (opts?: unknown) => unknown;
        path?: string;
    },
): Hono {
    const app = new Hono();
    const defaultPath = '/tmp/token-ledger.jsonl';
    const ctx = {
        processInventory: () => ({
            snapshot: snapshotImpl ?? (async () => snapshot),
        }),
        tokenLedger: () =>
            tokenLedger ?? {
                path: defaultPath,
                snapshot: () => ({
                    events: [],
                    count: 0,
                    limit: 200,
                    truncated: false,
                    path: defaultPath,
                    capturedAt: '2026-07-12T00:00:00.000Z',
                    sparseToolActivity: true,
                    nextBefore: null,
                }),
            },
    } as unknown as ServerContext;
    observabilityModule.mount(app, ctx);
    return app;
}

describe('observability module', () => {
    test('toolUseSsePayload wraps ledger event for SSE', () => {
        const frame = toolUseSsePayload({
            ts: '2026-07-12T12:00:00.000Z',
            session: 's',
            type: 'bash',
            summary: 'ls',
        });
        expect(frame).toEqual({
            type: 'tool-use',
            occurredAt: '2026-07-12T12:00:00.000Z',
            event: { ts: '2026-07-12T12:00:00.000Z', session: 's', type: 'bash', summary: 'ls' },
        });
    });

    test('GET /api/observability/processes returns inventory snapshot', async () => {
        const snap = {
            processes: [
                {
                    pid: 1,
                    ppid: 0,
                    depth: 0,
                    source: 'serve',
                    label: 'spur serve',
                    command: 'serve',
                    status: 'running',
                    rssBytes: 1000,
                    elapsedSeconds: 1,
                    startedAt: null,
                },
            ],
            rootPid: 1,
            capturedAt: '2026-07-12T00:00:00.000Z',
        };
        const app = mountWithInventory(snap);
        const res = await app.request('/api/observability/processes');
        expect(res.status).toBe(200);
        const body = (await res.json()) as typeof snap;
        expect(body.rootPid).toBe(1);
        expect(body.processes).toHaveLength(1);
        expect(body.processes[0]?.source).toBe('serve');
    });

    test('GET /api/observability/processes returns 501 for unsupported platform', async () => {
        const { UnsupportedProcessPlatformError } = await import('@gobing-ai/spur-app');
        const app = mountWithInventory(null, async () => {
            throw new UnsupportedProcessPlatformError('win32');
        });
        const res = await app.request('/api/observability/processes');
        expect(res.status).toBe(501);
        const body = (await res.json()) as { code?: string; error?: string };
        expect(body.code).toBe('UNSUPPORTED_PLATFORM');
        expect(body.error).toContain('win32');
    });

    test('GET /api/observability/processes returns 500 on unexpected errors', async () => {
        const app = mountWithInventory(null, async () => {
            throw new Error('ps exploded');
        });
        const res = await app.request('/api/observability/processes');
        expect(res.status).toBe(500);
        const body = (await res.json()) as { error?: string };
        expect(body.error).toContain('ps exploded');
    });

    test('mount is a no-op without context', () => {
        const app = new Hono();
        expect(() => observabilityModule.mount(app, undefined)).not.toThrow();
    });

    test('GET /api/observability/tool-use returns ledger snapshot', async () => {
        const snap = {
            events: [
                {
                    seq: 0,
                    ts: '2026-07-12T12:00:00.000Z',
                    session: 'session-1',
                    type: 'read',
                    file: '/a.ts',
                    tokens: 10,
                },
            ],
            count: 1,
            limit: 200,
            truncated: false,
            path: '/proj/.spur/context/token-ledger.jsonl',
            capturedAt: '2026-07-12T12:01:00.000Z',
            sparseToolActivity: false,
            nextBefore: null as string | null,
        };
        let lastOpts: unknown;
        const app = mountWithInventory(null, undefined, {
            path: snap.path,
            snapshot: (opts?: unknown) => {
                lastOpts = opts;
                const o = opts as { limit?: number; before?: string };
                return { ...snap, limit: o?.limit ?? 200, nextBefore: o?.before ? '2026-07-12T11:00:00.000Z' : null };
            },
        });
        const res = await app.request('/api/observability/tool-use?limit=50&before=2026-07-12T12:00:00.000Z');
        expect(res.status).toBe(200);
        const body = (await res.json()) as typeof snap;
        expect(body.count).toBe(1);
        expect(body.events[0]?.type).toBe('read');
        expect(body.limit).toBe(50);
        expect(lastOpts).toMatchObject({ limit: 50, before: '2026-07-12T12:00:00.000Z' });
    });

    test('GET /api/observability/tool-use/stream returns SSE content-type', async () => {
        const { appendFileSync, mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
        const { join } = await import('node:path');
        const { tmpdir } = await import('node:os');
        const dir = mkdtempSync(join(tmpdir(), 'spur-sse-'));
        const path = join(dir, 'token-ledger.jsonl');
        writeFileSync(path, '');
        resetLedgerWatcherForTests();
        try {
            const app = mountWithInventory(null, undefined, {
                path,
                snapshot: () => ({
                    events: [],
                    count: 0,
                    limit: 200,
                    truncated: false,
                    path,
                    capturedAt: new Date().toISOString(),
                    sparseToolActivity: true,
                    nextBefore: null,
                }),
            });
            const ac = new AbortController();
            const res = await app.request('/api/observability/tool-use/stream', { signal: ac.signal });
            expect(res.status).toBe(200);
            expect(res.headers.get('Content-Type')).toContain('text/event-stream');
            // Drain connected frame so start() path fully runs.
            const reader = res.body?.getReader();
            expect(reader).toBeDefined();
            const first = await reader?.read();
            const text = new TextDecoder().decode(first?.value ?? new Uint8Array());
            expect(text).toContain('connected');
            // Append + drive the shared watcher so the subscribe fan-out path runs.
            appendFileSync(
                path,
                `${JSON.stringify({ ts: '2026-07-12T12:00:00.000Z', session: 's', type: 'bash', summary: 'ls' })}\n`,
            );
            (await getLedgerWatcher(path)).pollNewBytes();
            const second = await reader?.read();
            const text2 = new TextDecoder().decode(second?.value ?? new Uint8Array());
            expect(text2.includes('tool-use') || text2.includes('bash')).toBe(true);
            // Re-bind watcher on a different path (covers getLedgerWatcher path switch).
            const path2 = join(dir, 'other.jsonl');
            writeFileSync(path2, '');
            await getLedgerWatcher(path2);
            ac.abort();
            await reader?.cancel();
        } finally {
            resetLedgerWatcherForTests();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('GET /api/observability/tool-use/stream tears down when already aborted', async () => {
        const app = mountWithInventory(null, undefined, {
            path: '/tmp/does-not-matter.jsonl',
            snapshot: () => ({
                events: [],
                count: 0,
                limit: 200,
                truncated: false,
                path: '/tmp/does-not-matter.jsonl',
                capturedAt: new Date().toISOString(),
                sparseToolActivity: true,
                nextBefore: null,
            }),
        });
        const ac = new AbortController();
        ac.abort();
        const res = await app.request('/api/observability/tool-use/stream', { signal: ac.signal });
        expect(res.status).toBe(200);
        // Body may be empty/closed quickly when signal already aborted.
        const reader = res.body?.getReader();
        const chunk = await reader?.read();
        expect(chunk?.done === true || chunk?.value !== undefined).toBe(true);
    });

    test('GET /api/observability/tool-use/stream cancel() path without abort', async () => {
        const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
        const { join } = await import('node:path');
        const { tmpdir } = await import('node:os');
        const dir = mkdtempSync(join(tmpdir(), 'spur-sse-cancel-'));
        const path = join(dir, 'token-ledger.jsonl');
        writeFileSync(path, '');
        resetLedgerWatcherForTests();
        try {
            const app = mountWithInventory(null, undefined, {
                path,
                snapshot: () => ({
                    events: [],
                    count: 0,
                    limit: 200,
                    truncated: false,
                    path,
                    capturedAt: new Date().toISOString(),
                    sparseToolActivity: true,
                    nextBefore: null,
                }),
            });
            const res = await app.request('/api/observability/tool-use/stream');
            expect(res.status).toBe(200);
            const reader = res.body?.getReader();
            await reader?.read(); // connected
            // Invoke ReadableStream cancel without abort signal.
            await reader?.cancel();
        } finally {
            resetLedgerWatcherForTests();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('GET /api/observability/tool-use/stream emits error frame when ledger path throws', async () => {
        const app = new Hono();
        const ctx = {
            processInventory: () => ({
                snapshot: async () => ({ processes: [], rootPid: 0, capturedAt: '' }),
            }),
            tokenLedger: () => ({
                get path(): string {
                    throw new Error('path unavailable');
                },
                snapshot: () => ({
                    events: [],
                    count: 0,
                    limit: 200,
                    truncated: false,
                    path: '',
                    capturedAt: new Date().toISOString(),
                    sparseToolActivity: true,
                    nextBefore: null,
                }),
            }),
        } as unknown as ServerContext;
        observabilityModule.mount(app, ctx);
        const ac = new AbortController();
        const res = await app.request('/api/observability/tool-use/stream', { signal: ac.signal });
        expect(res.status).toBe(200);
        const reader = res.body?.getReader();
        // Read until we see error frame or stream ends (connected may come first).
        let sawError = false;
        for (let i = 0; i < 5; i++) {
            const chunk = await reader?.read();
            if (chunk?.done) break;
            const text = new TextDecoder().decode(chunk?.value ?? new Uint8Array());
            if (text.includes('ledger watch unavailable') || text.includes('error')) {
                sawError = true;
                break;
            }
        }
        expect(sawError).toBe(true);
        ac.abort();
        await reader?.cancel();
    });

    test('GET /api/observability/tool-use returns empty success', async () => {
        const app = mountWithInventory(null, undefined, {
            snapshot: () => ({
                events: [],
                count: 0,
                limit: 200,
                truncated: false,
                path: '/proj/.spur/context/token-ledger.jsonl',
                capturedAt: '2026-07-12T00:00:00.000Z',
            }),
        });
        const res = await app.request('/api/observability/tool-use');
        expect(res.status).toBe(200);
        const body = (await res.json()) as { events: unknown[]; count: number };
        expect(body.events).toEqual([]);
        expect(body.count).toBe(0);
    });

    test('GET /api/observability/tool-use returns 500 on I/O error', async () => {
        const app = mountWithInventory(null, undefined, {
            snapshot: () => {
                throw new Error('EACCES ledger');
            },
        });
        const res = await app.request('/api/observability/tool-use');
        expect(res.status).toBe(500);
        const body = (await res.json()) as { error?: string };
        expect(body.error).toContain('EACCES');
    });
});

describe('observability routing-summary (task 0552)', () => {
    const routingResult = {
        window: { since: '2026-08-08T00:00:00.000Z', until: '2026-08-15T00:00:00.000Z' },
        pairs: [
            { role: 'scribe', executor: 'cheap-exec', source: 'role', runs: 4, escalations: 1 },
            { role: 'scribe', executor: 'cheap-exec', source: 'explicit', runs: 2, escalations: 0 },
        ],
    };
    const tokensResult = {
        window: { since: '2026-08-08T00:00:00.000Z', until: '2026-08-15T00:00:00.000Z' },
        roles: [
            {
                role: 'scribe',
                totalRuns: 6,
                matchedRuns: 4,
                exact: {
                    inputTokens: 1250,
                    outputTokens: 300,
                    cacheReadTokens: 200,
                    cacheCreationTokens: 50,
                    records: 4,
                    recordsWithUsage: 4,
                },
                estimated: null,
                unmeasured: false,
            },
        ],
    };

    function mountWithRoutingStubs(opts?: {
        routing?: unknown;
        tokens?: unknown;
        onRoutingSpec?: (spec: unknown) => void;
    }): Hono {
        const app = new Hono();
        const ctx = {
            systemEventDao: async () => ({
                routingSummary: async (spec: unknown) => {
                    opts?.onRoutingSpec?.(spec);
                    return opts?.routing ?? routingResult;
                },
            }),
            getDb: async () => ({}),
        } as unknown as ServerContext;
        observabilityModule.mount(app, ctx);
        return app;
    }

    afterEach(() => {
        resetRoleTokenSummaryForTesting();
    });

    test('returns both aggregates in one envelope with no query of its own', async () => {
        setRoleTokenSummaryForTesting(async () => tokensResult);
        const app = mountWithRoutingStubs();
        const res = await app.request('/api/observability/routing-summary');
        expect(res.status).toBe(200);
        const body = (await res.json()) as { routing: typeof routingResult; tokens: typeof tokensResult };
        expect(body.routing).toEqual(routingResult);
        expect(body.tokens).toEqual(tokensResult);
        // No currency field rides the envelope (0547 R2).
        expect(JSON.stringify(body)).not.toMatch(/costUsd|cost_usd|price|\$|usd/i);
    });

    test('forwards since/until to both domain surfaces and defaults otherwise', async () => {
        const routingSpecs: unknown[] = [];
        const tokenSpecs: unknown[] = [];
        setRoleTokenSummaryForTesting(async (_db, spec) => {
            tokenSpecs.push(spec);
            return tokensResult;
        });
        const app = mountWithRoutingStubs({
            onRoutingSpec: (spec) => routingSpecs.push(spec),
        });

        const withBounds = await app.request(
            '/api/observability/routing-summary?since=2026-08-01T00:00:00.000Z&until=2026-08-02T00:00:00.000Z',
        );
        expect(withBounds.status).toBe(200);
        expect(routingSpecs[0]).toEqual({ since: '2026-08-01T00:00:00.000Z', until: '2026-08-02T00:00:00.000Z' });
        expect(tokenSpecs[0]).toEqual({ since: '2026-08-01T00:00:00.000Z', until: '2026-08-02T00:00:00.000Z' });

        // No params → undefined forwarded; the domain surfaces apply their bounded defaults.
        await app.request('/api/observability/routing-summary');
        expect(routingSpecs[1]).toEqual({ since: undefined, until: undefined });
        expect(tokenSpecs[1]).toEqual({ since: undefined, until: undefined });
    });

    test('surfaces an empty dataset as empty, never as zeros', async () => {
        const empty = {
            window: { since: '2026-08-08T00:00:00.000Z', until: '2026-08-15T00:00:00.000Z' },
            pairs: [],
        };
        const emptyTokens = {
            window: { since: '2026-08-08T00:00:00.000Z', until: '2026-08-15T00:00:00.000Z' },
            roles: [],
        };
        setRoleTokenSummaryForTesting(async () => emptyTokens);
        const app = mountWithRoutingStubs({ routing: empty, tokens: emptyTokens });
        const res = await app.request('/api/observability/routing-summary');
        expect(res.status).toBe(200);
        const body = (await res.json()) as { routing: { pairs: unknown[] }; tokens: { roles: unknown[] } };
        expect(body.routing.pairs).toEqual([]);
        expect(body.tokens.roles).toEqual([]);
    });

    test('a failing domain surface returns a 500 with the cause surfaced', async () => {
        setRoleTokenSummaryForTesting(async () => {
            throw new Error('ledger unavailable');
        });
        const app = mountWithRoutingStubs();
        const res = await app.request('/api/observability/routing-summary');
        expect(res.status).toBe(500);
        const body = (await res.json()) as { error?: string };
        expect(body.error).toContain('ledger unavailable');
    });

    describe('GET /api/observability/summary (task 0789)', () => {
        test('returns 200 with complete summary payload and validates schema', async () => {
            const app = new Hono();
            const ctx = {
                systemEventDao: async () => ({
                    eventSummary: async (spec: { since: string; until: string }) => ({
                        window: { since: spec.since, until: spec.until },
                        totalEvents: 10,
                        errorEventCount: 2,
                        warningEventCount: 1,
                        eventVolumeBuckets: [
                            {
                                timestamp: spec.since,
                                total: 5,
                                byPrefix: { task: 5 },
                                bySeverity: { info: 3, warning: 1, error: 1, unknown: 0 },
                            },
                        ],
                        topEventTypes: [{ name: 'task.updated', prefix: 'task', count: 5, latestAt: spec.since }],
                        recentErrors: [
                            { id: 'err-1', name: 'task.failed', occurredAt: spec.since, message: 'Gate red' },
                        ],
                    }),
                }),
                getDb: async () => ({
                    queryAll: async () => [],
                }),
            } as unknown as ServerContext;
            observabilityModule.mount(app, ctx);

            const res = await app.request(
                '/api/observability/summary?since=2026-09-06T12:00:00.000Z&until=2026-09-06T16:00:00.000Z',
            );
            expect(res.status).toBe(200);
            const body = (await res.json()) as {
                kpis: { totalEvents: number; errorEventCount: number };
                recentErrors: unknown[];
            };
            expect(body.kpis.totalEvents).toBe(10);
            expect(body.kpis.errorEventCount).toBe(2);
            expect(body.recentErrors).toHaveLength(1);
        });

        test('rejects malformed since or until with 400', async () => {
            const app = new Hono();
            const ctx = {
                systemEventDao: async () => ({}),
                getDb: async () => ({}),
            } as unknown as ServerContext;
            observabilityModule.mount(app, ctx);

            const resSince = await app.request('/api/observability/summary?since=not-a-date');
            expect(resSince.status).toBe(400);
            const errSince = (await resSince.json()) as { error: string; code: string };
            expect(errSince.code).toBe('MALFORMED_TIMESTAMP');

            const resUntil = await app.request(
                '/api/observability/summary?since=2026-09-06T12:00:00.000Z&until=invalid',
            );
            expect(resUntil.status).toBe(400);
            const errUntil = (await resUntil.json()) as { error: string; code: string };
            expect(errUntil.code).toBe('MALFORMED_TIMESTAMP');

            const resRange = await app.request(
                '/api/observability/summary?since=2026-09-06T16:00:00.000Z&until=2026-09-06T12:00:00.000Z',
            );
            expect(resRange.status).toBe(400);
            const errRange = (await resRange.json()) as { error: string; code: string };
            expect(errRange.code).toBe('MALFORMED_RANGE');
        });

        test('window with no data returns zeroed payload, not 500', async () => {
            const app = new Hono();
            const ctx = {
                systemEventDao: async () => ({
                    eventSummary: async (spec: { since: string; until: string }) => ({
                        window: { since: spec.since, until: spec.until },
                        totalEvents: 0,
                        errorEventCount: 0,
                        warningEventCount: 0,
                        eventVolumeBuckets: [],
                        topEventTypes: [],
                        recentErrors: [],
                    }),
                }),
                getDb: async () => ({
                    queryAll: async () => [],
                }),
            } as unknown as ServerContext;
            observabilityModule.mount(app, ctx);

            const res = await app.request(
                '/api/observability/summary?since=2026-09-06T12:00:00.000Z&until=2026-09-06T16:00:00.000Z',
            );
            expect(res.status).toBe(200);
            const body = (await res.json()) as {
                kpis: { totalEvents: number; activeJobs: number; successRatePct: number };
            };
            expect(body.kpis.totalEvents).toBe(0);
            expect(body.kpis.activeJobs).toBe(0);
            expect(body.kpis.successRatePct).toBe(0);
        });
    });
});
