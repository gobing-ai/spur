import { describe, expect, test } from 'bun:test';
import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';
import { createApp } from '../src/bootstrap';

describe('createApp', () => {
    test('no-arg form serves health (backwards-compat)', async () => {
        const response = await createApp().request('/api/health');
        expect(response.status).toBe(200);
    });

    test('threads ApplicationRuntime into Hono context when provided', async () => {
        const mockRt = {
            config: {} as unknown as ApplicationRuntime['config'],
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
