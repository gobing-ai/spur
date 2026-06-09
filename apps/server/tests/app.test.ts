import { describe, expect, test } from 'bun:test';
import type { HealthResponse } from '@gobing-ai/spur-contracts';
import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';
import { createApp, generateOpenApiSpec } from '../src';
import worker from '../src/worker';

describe('server app', () => {
    test('serves the oRPC health procedure through the Hono adapter', async () => {
        const response = await createApp().request('/api/health');
        const body = (await response.json()) as HealthResponse;

        expect(response.status).toBe(200);
        expect(body).toMatchObject({
            status: 'ok',
            service: 'spur',
            version: '0.0.0',
        });
        expect(typeof body.timestamp).toBe('string');
    });

    test('derives OpenAPI from the oRPC contract', async () => {
        const spec = await generateOpenApiSpec();

        expect(spec.openapi).toBe('3.1.1');
        expect(spec.paths?.['/health']?.get?.summary).toBe('Read application health');
    });

    test('serves OpenAPI JSON, redirects root, and emits not-found responses', async () => {
        const app = createApp();
        const rootResponse = await app.request('/');
        const specResponse = await app.request('/openapi.json');
        const apiMissingResponse = await app.request('/api/missing');
        const missingResponse = await app.request('/missing');

        expect(rootResponse.status).toBe(302);
        expect(specResponse.status).toBe(200);
        expect((await specResponse.json()) as Record<string, unknown>).toMatchObject({
            openapi: '3.1.1',
        });
        expect(apiMissingResponse.status).toBe(404);
        expect(missingResponse.status).toBe(404);
        expect(await missingResponse.json()).toEqual({ error: 'Not Found' });
    });

    test('serves the same app through the Worker entrypoint', async () => {
        const response = await worker.fetch(new Request('https://spur.test/api/health'), {});

        expect(response.status).toBe(200);
    });

    test('threads ApplicationRuntime logger into Hono context when provided', async () => {
        // Minimal ApplicationRuntime shape — only the fields createApp reads.
        const mockRt = {
            config: {} as unknown,
            appConfig: undefined,
            logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
            events: { emit: () => {}, on: () => {}, off: () => {} },
            db: undefined,
            pluginHost: {} as unknown,
            stop: async () => {},
        } as unknown as ApplicationRuntime;

        const app = createApp(mockRt);
        const response = await app.request('/api/health');

        expect(response.status).toBe(200);
    });
});
