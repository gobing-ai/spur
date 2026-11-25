import { describe, expect, test } from 'bun:test';
import { spurConfigSchema } from '@gobing-ai/spur-config';
import { serverBootstrapConfig } from '../src/server-config';

describe('serverBootstrapConfig', () => {
    test('disables runtime facilities in test mode', () => {
        const config = serverBootstrapConfig({ NODE_ENV: 'test' });

        expect(config.logging.enabled).toBe(false);
        expect(config.telemetry.enabled).toBe(false);
        expect(config.events.enabled).toBe(true);
        expect(config.jobqueue.enabled).toBe(false);
        expect(config.scheduler.enabled).toBe(false);
    });

    test('resolves the logging settings', () => {
        const config = serverBootstrapConfig({ SPUR_LOG_LEVEL: 'debug' });

        expect(config.logging).toEqual({ enabled: true, level: 'debug', console: false });
    });

    test('uses production defaults when optional settings are absent', () => {
        const config = serverBootstrapConfig({});

        expect(config.logging).toEqual({ enabled: true, level: 'info', console: false });
        expect(config.jobqueue.enabled).toBe(true);
        expect(config.scheduler.enabled).toBe(true);
    });

    test('reads server.mcp and server.a2a from spurConfig (.spur/config.yaml) and lets env vars override', () => {
        const spurConfig = spurConfigSchema.parse({
            server: {
                mcp: { enabled: true, authEnv: 'SPUR_MCP_TOKEN', allowUnauthenticated: true, namespace: 'sp' },
                a2a: { enabled: true, authEnv: 'SPUR_A2A_TOKEN', allowUnauthenticated: true },
                gateway: { port: 3070 },
            },
        });
        const fromYaml = serverBootstrapConfig({ NODE_ENV: 'test' }, spurConfig);
        expect(fromYaml.mcp).toEqual({
            enabled: true,
            authEnv: 'SPUR_MCP_TOKEN',
            allowUnauthenticated: true,
            namespace: 'sp',
        });
        expect(fromYaml.a2a).toEqual({
            enabled: true,
            authEnv: 'SPUR_A2A_TOKEN',
            allowUnauthenticated: true,
        });
        // K44 1450: the gateway carries no MCP config of its own; server.mcp drives its root /mcp.
        expect(fromYaml.gateway).toEqual({ port: 3070, explicit: true });

        const overridden = serverBootstrapConfig(
            {
                NODE_ENV: 'test',
                SPUR_MCP_ENABLED: 'false',
                SPUR_A2A_AUTH_ENV: 'OVERRIDE_A2A_TOKEN',
                SPUR_GATEWAY_PORT: '4123',
            },
            spurConfig,
        );
        expect(overridden.mcp?.enabled).toBe(false);
        expect(overridden.a2a?.authEnv).toBe('OVERRIDE_A2A_TOKEN');
        expect(overridden.gateway).toEqual({ port: 4123, explicit: true });
    });

    test('spurConfigSchema refuses server.mcp.enabled or server.a2a.enabled without authEnv unless allowUnauthenticated is true', () => {
        expect(spurConfigSchema.safeParse({ server: { mcp: { enabled: true } } }).success).toBe(false);
        expect(spurConfigSchema.safeParse({ server: { a2a: { enabled: true } } }).success).toBe(false);
        expect(
            spurConfigSchema.safeParse({ server: { mcp: { enabled: true, allowUnauthenticated: true } } }).success,
        ).toBe(true);
        expect(
            spurConfigSchema.safeParse({ server: { a2a: { enabled: true, allowUnauthenticated: true } } }).success,
        ).toBe(true);
    });
});
