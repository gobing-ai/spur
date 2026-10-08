import { afterEach, describe, expect, test } from 'bun:test';
import { InvalidWorkflowRunIdError } from '@gobing-ai/spur-app';
import { applyCliMigrations, DecisionLogDao } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
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
                        topEventTypes: [
                            {
                                name: 'task.updated',
                                prefix: 'task',
                                count: 5,
                                latestAt: spec.since,
                                avgDurationMs: 800,
                                failureCount: 1,
                            },
                        ],
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

    describe('GET /api/observability/run-record/:runId (task 0929 R1/R2)', () => {
        function mountWithWorkflowService(service: Record<string, unknown>): Hono {
            const app = new Hono();
            app.onError(() => new Response(JSON.stringify({ error: 'internal' }), { status: 500 }));
            const ctx = {
                workflowService: () => service,
            } as unknown as ServerContext;
            observabilityModule.mount(app, ctx);
            return app;
        }

        test('serves the application inspection outcome as JSON', async () => {
            const outcome = { status: 'record', markdown: '# record', state: { runId: 'r1' } };
            const app = mountWithWorkflowService({
                inspectRunRecord: (runId: string) => {
                    expect(runId).toBe('r1');
                    return outcome;
                },
            });

            const res = await app.request('/api/observability/run-record/r1');
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual(outcome);
        });

        test('a typed invalid run id is a 400 without matching the seam message text', async () => {
            const app = mountWithWorkflowService({
                inspectRunRecord: () => {
                    throw new InvalidWorkflowRunIdError('../escape');
                },
            });

            const res = await app.request('/api/observability/run-record/%2e%2e%2fescape');
            expect(res.status).toBe(400);
            const body = (await res.json()) as { code: string; error: string };
            expect(body.code).toBe('invalid-run-id');
            expect(body.error).toContain('../escape');
        });

        test('a plain Error whose message merely contains the old seam text is not a 400', async () => {
            const app = mountWithWorkflowService({
                inspectRunRecord: () => {
                    throw new Error('Invalid workflow run id: wording drift');
                },
            });

            const res = await app.request('/api/observability/run-record/r1');
            expect(res.status).toBe(500);
        });

        // 0948 R5 / AC5: the mapping is on the typed `code`, never on message text. A plain
        // Error carrying the OLD message must NOT be reclassified — otherwise a future wording
        // change silently flips a correct 400 into a 500, which is the defect this pins.
        test('a message-only lookalike error is not reclassified as a 400', async () => {
            const app = mountWithWorkflowService({
                inspectRunRecord: () => {
                    throw new Error('Invalid workflow run id: "../escape"');
                },
            });

            const res = await app.request('/api/observability/run-record/%2e%2e%2fescape');
            expect(res.status).toBe(500);
        });

        test('the typed error carries the stable invalid-run-id code', () => {
            const err = new InvalidWorkflowRunIdError('../escape');
            expect((err as { code?: unknown }).code).toBe('invalid-run-id');
            expect(err.message).toContain('Invalid workflow run id');
        });

        test('unavailable outcomes stay 200 with an explicit status', async () => {
            for (const outcome of [
                { status: 'missing' },
                { status: 'oversized', sizeBytes: 42 },
                { status: 'legacy', content: 'legacy' },
                { status: 'incomplete', markdown: '# partial', reason: 'state-missing' },
            ]) {
                const app = mountWithWorkflowService({ inspectRunRecord: () => outcome });
                const res = await app.request('/api/observability/run-record/r2');
                expect(res.status).toBe(200);
                expect(await res.json()).toEqual(outcome);
            }
        });
    });
});

describe('observability decision-log routes (task 1100)', () => {
    function decisionRow(
        overrides: Partial<Parameters<DecisionLogDao['insert']>[0]>,
    ): Parameters<DecisionLogDao['insert']>[0] {
        return {
            id: 'd0',
            decision_id: 'publish.pr',
            decision_type: 'choice',
            caller: 'workflow',
            run_id: null,
            workflow_name: null,
            node_id: null,
            wbs: null,
            maker_name: null,
            maker_source: null,
            catalog_layer: null,
            catalog_source: null,
            min_confidence: null,
            question: null,
            input_json: null,
            input_keys_json: '[]',
            evidence_digest: null,
            outcome: 'accepted',
            value: null,
            fallback_value: null,
            source: null,
            reason: null,
            confidence: null,
            error: null,
            started_at: '2026-09-06T00:00:00.000Z',
            ended_at: '2026-09-06T00:00:01.000Z',
            duration_ms: 1000,
            phases_json: '[]',
            schema_version: 1,
            ...overrides,
        } as Parameters<DecisionLogDao['insert']>[0];
    }

    /** Seed (newest first): d1 accepted/workflow, d2 rejected/cli (no maker), d3 fallback/workflow. */
    async function setupDecisionDb() {
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(db);
        const dao = new DecisionLogDao(db);
        await dao.insert(
            decisionRow({
                id: 'd1',
                decision_id: 'publish.pr',
                caller: 'workflow',
                run_id: 'run1',
                workflow_name: 'task-pipeline',
                node_id: 'decide',
                wbs: '0042',
                maker_name: 'planner',
                maker_source: 'catalog',
                catalog_layer: 'role',
                catalog_source: 'builtin',
                min_confidence: 0.6,
                question: 'Ship it?',
                input_json: '{"x":1}',
                input_keys_json: '["x"]',
                evidence_digest: 'sha256:abc',
                outcome: 'accepted',
                value: 'ship',
                source: 'model',
                reason: 'high confidence',
                confidence: 0.9,
                started_at: '2026-09-06T12:00:00.000Z',
                ended_at: '2026-09-06T12:00:01.000Z',
                duration_ms: 1000,
                phases_json: '[{"phase":"maker","startedAt":12,"durationMs":900}]',
            }),
        );
        await dao.insert(
            decisionRow({
                id: 'd2',
                caller: 'cli',
                outcome: 'rejected',
                error: 'user rejected',
                started_at: '2026-09-06T11:00:00.000Z',
                ended_at: '2026-09-06T11:00:04.000Z',
                duration_ms: 4000,
            }),
        );
        await dao.insert(
            decisionRow({
                id: 'd3',
                decision_id: 'triage.mode',
                caller: 'workflow',
                run_id: 'run1',
                maker_name: 'router',
                maker_source: 'default',
                outcome: 'fallback',
                fallback_value: 'cheap-exec',
                source: 'default',
                started_at: '2026-09-06T10:00:00.000Z',
                ended_at: '2026-09-06T10:00:02.000Z',
                duration_ms: 2000,
            }),
        );
        return db;
    }

    function mountWithDb(db: Awaited<ReturnType<typeof createDbAdapter>>): Hono {
        const app = new Hono();
        observabilityModule.mount(app, { getDb: async () => db } as unknown as ServerContext);
        return app;
    }

    test('list returns rows, KPI strip, facets, and no cursor on a short page', async () => {
        const db = await setupDecisionDb();
        const res = await mountWithDb(db).request('/api/observability/decisions');
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            rows: Array<Record<string, unknown>>;
            summary: { count: number; acceptedRate: number; fallbackRate: number; p95DurationMs: number | null };
            facets: { decisionIds: string[]; makers: string[] };
            nextCursor: string | null;
        };
        // Newest first; list rows map to camelCase and omit the mode-gated payload (§3.6).
        expect(body.rows.map((r) => r.id)).toEqual(['d1', 'd2', 'd3']);
        expect(body.rows[0]).toMatchObject({ decisionId: 'publish.pr', caller: 'workflow', outcome: 'accepted' });
        expect(body.rows[0]?.inputKeys).toEqual(['x']);
        expect(body.rows[0]).not.toHaveProperty('inputJson');
        expect(body.rows[0]).not.toHaveProperty('question');
        expect(body.rows[0]).not.toHaveProperty('phases');
        // Summary is over the unfiltered set: 1 accepted + 1 fallback + 1 rejected.
        expect(body.summary.count).toBe(3);
        expect(body.summary.acceptedRate).toBeCloseTo(1 / 3);
        expect(body.summary.fallbackRate).toBeCloseTo(1 / 3);
        // Nearest-rank p95 of [1000, 4000, 2000].
        expect(body.summary.p95DurationMs).toBe(4000);
        expect(body.facets.decisionIds).toEqual(['publish.pr', 'triage.mode']);
        expect(body.facets.makers).toEqual(['planner', 'router']);
        expect(body.nextCursor).toBeNull();
        db.close();
    });

    test('filters narrow rows and a short page yields a keyset cursor the next page honors', async () => {
        const db = await setupDecisionDb();
        const app = mountWithDb(db);
        const filtered = await app.request(
            '/api/observability/decisions?since=2026-09-06T00:00:00.000Z&decision=publish.pr&maker=planner&run=run1&outcome=accepted&caller=workflow&limit=10',
        );
        expect(filtered.status).toBe(200);
        const filteredBody = (await filtered.json()) as {
            rows: Array<{ id: string }>;
            summary: { count: number; acceptedRate: number };
        };
        expect(filteredBody.rows.map((r) => r.id)).toEqual(['d1']);
        expect(filteredBody.summary).toMatchObject({ count: 1, acceptedRate: 1 });

        const page1 = await app.request('/api/observability/decisions?limit=1');
        expect(page1.status).toBe(200);
        const page1Body = (await page1.json()) as { rows: Array<{ id: string }>; nextCursor: string | null };
        expect(page1Body.rows.map((r) => r.id)).toEqual(['d1']);
        expect(page1Body.nextCursor).toBe('2026-09-06T12:00:00.000Z|d1');

        const page2 = await app.request(
            `/api/observability/decisions?limit=10&before=${encodeURIComponent(page1Body.nextCursor ?? '')}`,
        );
        expect(page2.status).toBe(200);
        const page2Body = (await page2.json()) as { rows: Array<{ id: string }>; nextCursor: string | null };
        expect(page2Body.rows.map((r) => r.id)).toEqual(['d2', 'd3']);
        expect(page2Body.nextCursor).toBeNull();
        db.close();
    });

    test('invalid outcome, caller, or limit respond 400 with the invalid-param wording', async () => {
        const db = await setupDecisionDb();
        const app = mountWithDb(db);
        for (const query of ['outcome=bogus', 'caller=bogus', 'limit=0', 'limit=201', 'limit=1.5', 'limit=abc']) {
            const res = await app.request(`/api/observability/decisions?${query}`);
            expect(res.status).toBe(400);
            const body = (await res.json()) as { error: string };
            expect(body.error.startsWith('invalid ')).toBe(true);
        }
        db.close();
    });

    test('a DB failure maps to 500 on list and detail while invalid params stay 400', async () => {
        const app = new Hono();
        observabilityModule.mount(app, {
            getDb: async () => {
                throw new Error('db unavailable');
            },
        } as unknown as ServerContext);
        const list = await app.request('/api/observability/decisions');
        expect(list.status).toBe(500);
        expect(((await list.json()) as { error: string }).error).toContain('db unavailable');

        const detail = await app.request('/api/observability/decisions/d1');
        expect(detail.status).toBe(500);
        expect(((await detail.json()) as { error: string }).error).toContain('db unavailable');
    });

    test('detail returns the mode-gated payload and 404 for unknown ids', async () => {
        const db = await setupDecisionDb();
        const app = mountWithDb(db);
        const res = await app.request('/api/observability/decisions/d1');
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            id: string;
            question: string | null;
            inputJson: string | null;
            phases: Array<{ phase: string; startedAt: number; durationMs: number }>;
        };
        expect(body.id).toBe('d1');
        expect(body.question).toBe('Ship it?');
        expect(body.inputJson).toBe('{"x":1}');
        expect(body.phases).toEqual([{ phase: 'maker', startedAt: 12, durationMs: 900 }]);

        const missing = await app.request('/api/observability/decisions/nope');
        expect(missing.status).toBe(404);
        expect(((await missing.json()) as { error: string }).error).toContain('nope');
        db.close();
    });
});

describe('GET /api/observability/summary — bucket, job-error merge, failure (task 1100 coverage)', () => {
    const JOB_ERROR_MS = Date.parse('2026-09-06T15:30:00.000Z');

    function mountWithSummaryStubs(opts: {
        eventSummary: (spec: { since: string; until: string; bucketMs?: number }) => unknown;
        db?: { queryAll: (sql: string) => unknown };
        onEventSpec?: (spec: { since: string; until: string; bucketMs?: number }) => void;
    }): Hono {
        const app = new Hono();
        const ctx = {
            systemEventDao: async () => ({
                eventSummary: async (spec: { since: string; until: string; bucketMs?: number }) => {
                    opts.onEventSpec?.(spec);
                    return opts.eventSummary(spec);
                },
            }),
            getDb: async () => opts.db ?? { queryAll: async () => [] },
        } as unknown as ServerContext;
        observabilityModule.mount(app, ctx);
        return app;
    }

    const eventSummaryBase = (spec: { since: string; until: string; bucketMs?: number }) => ({
        window: { since: spec.since, until: spec.until },
        totalEvents: 10,
        errorEventCount: 1,
        warningEventCount: 0,
        eventVolumeBuckets: [],
        topEventTypes: [],
        recentErrors: [
            { id: 'err-1', name: 'task.failed', occurredAt: '2026-09-06T15:45:00.000Z', message: 'Gate red' },
        ],
    });

    test('bucket param is forwarded as bucketMs and failed job rows merge into recentErrors', async () => {
        const specs: Array<{ since: string; until: string; bucketMs?: number }> = [];
        const jobCounts = [
            { status: 'completed', cnt: 3 },
            { status: 'failed', cnt: 1 },
        ];
        const jobErrors = [{ id: 'job-9', type: 'task.run', updated_at: JOB_ERROR_MS, last_error: 'boom' }];
        const app = mountWithSummaryStubs({
            eventSummary: eventSummaryBase,
            onEventSpec: (spec) => specs.push(spec),
            db: {
                queryAll: (sql: string) => (sql.includes('GROUP BY status') ? jobCounts : jobErrors),
            },
        });

        const res = await app.request(
            '/api/observability/summary?since=2026-09-06T12:00:00.000Z&until=2026-09-06T16:00:00.000Z&bucket=60000',
        );
        expect(res.status).toBe(200);
        expect(specs[0]?.bucketMs).toBe(60000);
        const body = (await res.json()) as {
            kpis: {
                totalEvents: number;
                activeJobs: number;
                completedJobs: number;
                failedJobs: number;
                successRatePct: number;
                errorEventCount: number;
                warningEventCount: number;
            };
            recentErrors: Array<{ id: string; source: string; name: string; occurredAt: string; message: string }>;
        };
        expect(body.kpis).toEqual({
            totalEvents: 10,
            activeJobs: 0,
            completedJobs: 3,
            failedJobs: 1,
            successRatePct: 75,
            errorEventCount: 1,
            warningEventCount: 0,
        });
        // Event + job errors merge into one recency-sorted strip with a source discriminator.
        expect(body.recentErrors).toEqual([
            {
                id: 'err-1',
                source: 'event',
                name: 'task.failed',
                occurredAt: '2026-09-06T15:45:00.000Z',
                message: 'Gate red',
            },
            {
                id: 'job-9',
                source: 'job',
                name: 'task.run',
                occurredAt: new Date(JOB_ERROR_MS).toISOString(),
                message: 'boom',
            },
        ]);

        // A non-positive/non-numeric bucket is ignored, not an error.
        const resInvalidBucket = await app.request(
            '/api/observability/summary?since=2026-09-06T12:00:00.000Z&until=2026-09-06T16:00:00.000Z&bucket=abc',
        );
        expect(resInvalidBucket.status).toBe(200);
        expect(specs[1]?.bucketMs).toBeUndefined();
    });

    test('a failing aggregate surfaces a 500 with the cause', async () => {
        const app = mountWithSummaryStubs({
            eventSummary: () => {
                throw new Error('events exploded');
            },
        });
        const res = await app.request(
            '/api/observability/summary?since=2026-09-06T12:00:00.000Z&until=2026-09-06T16:00:00.000Z',
        );
        expect(res.status).toBe(500);
        expect(((await res.json()) as { error: string }).error).toContain('events exploded');
    });
});

describe('getLedgerWatcher in-flight reuse and stale-path teardown', () => {
    test('a second same-path call adopts the in-flight load; a path switch stops the stale watcher', async () => {
        const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
        const { join } = await import('node:path');
        const { tmpdir } = await import('node:os');
        const dir = mkdtempSync(join(tmpdir(), 'spur-sse-race-'));
        const pathA = join(dir, 'a.jsonl');
        const pathB = join(dir, 'b.jsonl');
        writeFileSync(pathA, '');
        writeFileSync(pathB, '');
        resetLedgerWatcherForTests();
        try {
            // Two synchronous calls race the same path: the second must adopt the in-flight
            // load instead of starting a second watcher.
            const first = getLedgerWatcher(pathA);
            const second = getLedgerWatcher(pathA);
            // A path switch before the first load resolves must stop the stale watcher.
            const third = getLedgerWatcher(pathB);
            const watcherA = await first;
            expect(await second).toBe(watcherA);
            const watcherB = await third;
            expect(watcherB).not.toBe(watcherA);
        } finally {
            resetLedgerWatcherForTests();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
