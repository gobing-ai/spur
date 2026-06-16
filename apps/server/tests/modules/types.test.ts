import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { ServerModule } from '../../src/modules/types';

describe('ServerModule contract', () => {
    test('a custom module mounting raw routes is reachable', async () => {
        const customModule: ServerModule = {
            name: 'custom',
            mount(app: Hono) {
                app.get('/custom', (c) => c.json({ hello: 'world' }));
            },
        };

        const app = new Hono();
        customModule.mount(app, undefined);
        const res = await app.request('/custom');
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.hello).toBe('world');
    });

    test('module scoped middleware shape is correct', () => {
        const calls: string[] = [];
        const customModule: ServerModule = {
            name: 'scoped',
            mount(app: Hono) {
                app.get('/scoped', (c) => {
                    calls.push('handler');
                    return c.text('ok');
                });
            },
            middleware: [
                (async (_c: unknown, next: () => Promise<void>) => {
                    calls.push('middleware');
                    await next();
                }) as never,
            ],
        };

        expect(customModule.middleware).toBeDefined();
        expect(customModule.middleware?.length).toBe(1);
    });
});
