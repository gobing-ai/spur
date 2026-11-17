import { describe, expect, test } from 'bun:test';
import { startGateway } from '../src/gateway';

/** Empty routing table: the gateway answers its own root paths, which is all this test needs. */
const deps = {
    listProjects: async () => [],
    ensureUpstream: async () => 0,
    port: 0,
};

describe('startGateway', () => {
    test('serves the gateway handler and refuses a port another process owns', async () => {
        const handle = startGateway({ port: 0, host: '127.0.0.1', deps: { ...deps, port: 0 } });
        try {
            const health = await fetch(`${handle.url}/api/health`);
            expect(health.status).toBe(200);
            const body = (await health.json()) as { gateway: boolean };
            expect(body.gateway).toBe(true);

            expect(() => startGateway({ port: handle.port, host: '127.0.0.1', deps })).toThrow(
                `Gateway port ${handle.port} is already in use by another process`,
            );
        } finally {
            handle.stop();
        }
    });
});
