import { describe, expect, test } from 'bun:test';

describe('worker entrypoint', () => {
    test('creates fetch handler (async, lazy singleton)', async () => {
        const mod = await import('../src/worker');
        expect(mod.default).toBeDefined();
        expect(typeof mod.default.fetch).toBe('function');
    });

    test('serves health through the fetch handler', async () => {
        const mod = await import('../src/worker');
        const response = await mod.default.fetch(new Request('https://spur.test/api/health'), {});

        expect(response.status).toBe(200);
        const body = (await response.json()) as Record<string, unknown>;
        expect(body).toMatchObject({
            status: 'ok',
        });
    });
});
