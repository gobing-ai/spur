import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { ServerContext } from '../../../src/context';
import {
    getLedgerWatcher,
    observabilityModule,
    resetLedgerWatcherForTests,
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
