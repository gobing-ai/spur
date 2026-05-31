import { describe, expect, test } from 'bun:test';
import { createApiClient, resolveApiUrl } from '../../src/lib/rpc-client';

describe('rpc client', () => {
    test('resolveApiUrl returns default URL', () => {
        const url = resolveApiUrl();
        expect(url).toContain('/api');
    });

    test('resolveApiUrl uses provided URL', () => {
        const url = resolveApiUrl('https://example.com/api');
        expect(url).toBe('https://example.com/api');
    });

    test('createApiClient returns typed client', () => {
        const client = createApiClient('http://localhost:3000/api');
        expect(client).toBeDefined();
        expect(typeof client.health).toBe('function');
    });
});
