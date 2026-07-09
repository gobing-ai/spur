/**
 * Shared full-surface rpc-client mock for all web test files.
 *
 * Bun's mock.module is process-global and hoisted — ALL test files' top-level
 * mock.module calls are collected before ANY test runs, and the LAST mock for
 * each path wins globally. With 6 test files mocking rpc-client at different
 * API-surface depths, the "last" mock starves all others.
 *
 * This shared helper ensures EVERY mock file registers the SAME full API surface.
 * Tests customize behavior by dynamically importing `api` and swapping individual
 * methods in test bodies.
 */
import { mock } from 'bun:test';

// Path from test-helpers/ to src/lib/rpc-client.ts: ../../src/lib/rpc-client
mock.module('../../src/lib/rpc-client', () => ({
    resolveApiUrl: () => 'http://localhost:3000/api',
    fetchWithTimeout: (request: Request) => fetch(request),
    api: {
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
    },
}));
