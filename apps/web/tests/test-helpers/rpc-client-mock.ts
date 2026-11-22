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

// Import the dependency-free seam directly: rpc-client itself is mocked below.
import {
    apiFetchWithTimeout,
    DEFAULT_FETCH_TIMEOUT_MS,
    fetchWithTimeout,
    resetFetchForTesting,
    setFetchForTesting,
} from '../../src/lib/rpc-fetch';

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
// EVERY registration must expose the same surface: a module that reads a namespace this default
// omits crashes only when another file's registration happens to win ("last registration wins"),
// which is an order-dependent failure. Namespaces are added as modules start mounting in suite
// tests (A83 1426/1427 added history/inbox/search).
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
    history: {
        // `undefined`, not a fabricated payload: the History tabs compute charts from rich shapes,
        // and a late-resolving promise outlives happy-dom teardown (a `window is not defined`
        // setState). Undefined keeps every tab in its not-loaded state and settles immediately.
        getSummary: async () => undefined,
        getSessions: async () => undefined,
        getSources: async () => ({
            ok: true,
            data: { agents: [], unparsedSources: [], overview: { lastImportedAt: null } },
        }),
        getTimeline: async () => undefined,
        getToolSequence: async () => undefined,
        getInsights: async () => undefined,
        triggerImport: async () => ({ ok: true }),
    },
    inbox: {
        list: async () => ({ messages: [], nextCursor: null }),
        members: async () => [],
        requests: async () => [],
        read: async () => ({ readAt: 0, transitioned: false }),
        reply: async () => ({ message: { id: 'm', requestKey: null } }),
        send: async () => ({ message: { id: 'm', requestKey: null }, replayed: false }),
    },
    search: {
        query: async () => ({ ok: true, data: { hits: [], total: 0, tookMs: 0 } }),
        status: async () => ({ rg: { available: false }, zg: { index: 'unknown' } }),
    },
};

// ── Builder: produces a full module surface with custom api overrides ──
/** Build a complete rpc-client mock surface. Pass `api` to override the default. */
export function buildFullRpcMock(overrides?: { api?: unknown }): Record<string, unknown> {
    return {
        resolveApiUrl: () => 'http://localhost:3000/api',
        DEFAULT_FETCH_TIMEOUT_MS,
        fetchWithTimeout,
        apiFetchWithTimeout,
        setFetchForTesting,
        resetFetchForTesting,
        logTransportError,
        // Merge, never replace: a caller overriding one namespace must not shrink the shared
        // surface, because the LAST registration wins process-wide and a missing namespace then
        // fails an unrelated file's shell test only in the aggregate run.
        api:
            overrides?.api === undefined
                ? defaultApi
                : { ...defaultApi, ...(overrides.api as Record<string, unknown>) },
    };
}

// Path from test-helpers/ to src/lib/rpc-client.ts: ../../src/lib/rpc-client
mock.module('../../src/lib/rpc-client', () => buildFullRpcMock());
