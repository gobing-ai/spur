import { describe, expect, test } from 'bun:test';
import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';
import { createApp, serverBootstrapConfig } from '../src/bootstrap';

describe('serverBootstrapConfig', () => {
    test('disables logging in test mode (parity with spur-cli)', () => {
        const cfg = serverBootstrapConfig({ NODE_ENV: 'test' });
        expect(cfg.logging.enabled).toBe(false);
        expect(cfg.telemetry.enabled).toBe(false);
        expect(cfg.events.enabled).toBe(true);
    });

    test('enables logging outside test mode', () => {
        const cfg = serverBootstrapConfig({});
        expect(cfg.logging.enabled).toBe(true);
    });

    test('respects SPUR_LOG_LEVEL env var', () => {
        const cfg = serverBootstrapConfig({ SPUR_LOG_LEVEL: 'debug' });
        expect(cfg.logging.level).toBe('debug');
    });

    test('defaults log level to info', () => {
        const cfg = serverBootstrapConfig({});
        expect(cfg.logging.level).toBe('info');
    });
});

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
