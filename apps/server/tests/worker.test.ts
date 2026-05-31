import { describe, expect, test } from 'bun:test';

describe('worker entrypoint', () => {
    test('creates fetch handler', async () => {
        const mod = await import('../src/worker');
        expect(mod.default).toBeDefined();
        expect(typeof mod.default.fetch).toBe('function');
    });
});
