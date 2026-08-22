import { describe, expect, test } from 'bun:test';
import { createRouter, stubCtx } from '../src/router';

type HealthHandler = (opts: Record<string, unknown>) => Promise<{ status: string; service: string; timestamp: string }>;

describe('router', () => {
    test('health endpoint handler returns expected shape', async () => {
        const router = createRouter();
        const handler = router.health['~orpc'].handler as unknown as HealthHandler;
        const result = await handler({});
        expect(result.status).toBe('ok');
        expect(result.service).toBe('spur');
        expect(typeof result.timestamp).toBe('string');
    });

    test('has task, feature, and history route keys when created without context', () => {
        const router = createRouter();
        expect(router.task).toBeDefined();
        expect(router.feature).toBeDefined();
        expect(router.history).toBeDefined();
        expect(router.stream).toBeDefined();
    });

    test('stubCtx throws on any property access', () => {
        expect(() => (stubCtx as unknown as Record<string, unknown>).taskService).toThrow(
            'ServerContext not configured',
        );
    });

    test('stubCtx error message includes property name', () => {
        expect(() => (stubCtx as unknown as Record<string, unknown>).featureService).toThrow('featureService');
    });

    test('createRouter with context creates task, feature, and history handlers', () => {
        const ctx = stubCtx;
        const router = createRouter(ctx);
        expect(router.task).toBeDefined();
        expect(router.feature).toBeDefined();
        expect(router.history).toBeDefined();
    });

    test('stream handler rejects with events module placeholder', async () => {
        const router = createRouter();
        const handler = router.stream['~orpc'].handler as unknown as () => Promise<unknown>;
        await expect(handler()).rejects.toThrow('SSE stream served by raw Hono route (modules/events)');
    });
});
