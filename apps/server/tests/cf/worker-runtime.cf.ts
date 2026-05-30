import { describe, expect, test } from 'vitest';
import worker from '../../src/worker';

describe('cloudflare worker runtime', () => {
    test('serves health from the fetch entrypoint', async () => {
        const response = await worker.fetch(new Request('https://spur.test/api/health'), {});
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body).toMatchObject({
            status: 'ok',
            service: 'spur',
        });
    });
});
