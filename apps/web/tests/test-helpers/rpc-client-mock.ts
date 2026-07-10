/**
 * Shared full-surface rpc-client mock for all web test files.
 *
 * Bun's mock.module is process-global and hoisted — ALL test files' top-level
 * mock.module calls are collected before ANY test runs, and the LAST mock for
 * each path wins globally. With multiple test files mocking rpc-client at
 * different API-surface depths, the "last" mock starves all others, breaking
 * files that import setFetchForTesting/fetchWithTimeout from the real module.
 *
 * This helper ensures EVERY mock.module registration provides the SAME full API
 * surface (resolveApiUrl, fetchWithTimeout with a working test seam,
 * setFetchForTesting, resetFetchForTesting, apiFetchWithTimeout, logTransportError,
 * and a customizable `api` object). Tests customize behavior by calling
 * buildFullRpcMock with their own `api` overrides or by dynamically importing
 * `api` and swapping individual methods in test bodies.
 */
import { mock } from 'bun:test';

// ── Working fetch seam inside the mock ──────────────────────────────────
// Mirrors the real rpc-client's _testFetch closure so that tests using
// setFetchForTesting + fetchWithTimeout work even when the module is mocked.
let _testFetch: typeof fetch | undefined;

function setFetchForTesting(fn: typeof fetch): void {
    _testFetch = fn;
}

function resetFetchForTesting(): void {
    _testFetch = undefined;
}

function fetchWithTimeout(request: Request, ms = 10_000): Promise<Response> {
    const controller = new AbortController();
    const handle = setTimeout(() => controller.abort(), ms);
    const origSignal = request.signal;
    if (origSignal) {
        origSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    const req = new Request(request, { signal: controller.signal });
    const fetcher = _testFetch ?? fetch;
    return fetcher(req).finally(() => clearTimeout(handle));
}

function apiFetchWithTimeout(request: Request): Promise<Response> {
    return fetchWithTimeout(request);
}

function logTransportError(error: unknown): void {
    if (typeof globalThis !== 'undefined' && globalThis.dispatchEvent) {
        globalThis.dispatchEvent(
            new CustomEvent('api-error', {
                detail: { message: error instanceof Error ? error.message : String(error) },
            }),
        );
    }
}

// ── Default api surface ─────────────────────────────────────────────────
const defaultApi = {
    task: {
        list: async () => ({ data: [] }),
        transition: async () => ({ ok: true }),
        create: async () => ({ data: { wbs: '0003', filePath: 'c.md' } }),
        show: async () => ({
            data: {
                wbs: '0001',
                name: 'Test',
                status: 'todo',
                frontmatter: {},
                content: '## Body',
                filePath: 'a.md',
            },
        }),
        body: async () => ({ data: { wbs: '0001', filePath: 'a.md' } }),
        action: async () => ({ data: { runId: 'r1', action: 'run', status: 'queued' } }),
        folders: async () => ({ data: [] }),
    },
};

// ── Builder: produces a full module surface with custom api overrides ──
/** Build a complete rpc-client mock surface. Pass `api` to override the default. */
export function buildFullRpcMock(overrides?: { api?: unknown }): Record<string, unknown> {
    return {
        resolveApiUrl: () => 'http://localhost:3000/api',
        fetchWithTimeout,
        apiFetchWithTimeout,
        setFetchForTesting,
        resetFetchForTesting,
        logTransportError,
        api: overrides?.api ?? defaultApi,
    };
}

// Path from test-helpers/ to src/lib/rpc-client.ts: ../../src/lib/rpc-client
mock.module('../../src/lib/rpc-client', () => buildFullRpcMock());
