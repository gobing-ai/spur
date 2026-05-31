import { describe, expect, test } from 'bun:test';
import { router } from '../src/router';

type HealthHandler = (opts: Record<string, unknown>) => Promise<{ status: string; service: string; timestamp: string }>;

describe('router', () => {
    test('health endpoint handler returns expected shape', async () => {
        const handler = router.health['~orpc'].handler as unknown as HealthHandler;
        const result = await handler({});
        expect(result.status).toBe('ok');
        expect(result.service).toBe('spur');
        expect(typeof result.timestamp).toBe('string');
    });
});
