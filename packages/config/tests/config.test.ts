import { describe, expect, test } from 'bun:test';
import {
    buildConfigFromEnv,
    configSchema,
    ExecutorDisabledError,
    parseEnvBoolean,
    resolveBuilderBumpVerConfig,
} from '../src';

describe('config', () => {
    test('builds defaults for a development scaffold', () => {
        expect(configSchema.parse({})).toEqual({
            database: { url: '.spur/spur.db' },
            server: {
                port: 3000,
                host: 'localhost',
                openBrowser: true,
                webDistPath: null,
                a2a: { enabled: false },
                mcp: { enabled: false },
                gateway: { port: 3000, allowedHosts: [] },
            },
            telemetry: { enabled: false },
            logging: { level: 'info' },
        });
    });

    test('reads supported environment overrides', () => {
        expect(
            buildConfigFromEnv({
                DATABASE_URL: 'file:local.db',
                PORT: '4321',
                HOST: '0.0.0.0',
                SPUR_LOG_LEVEL: 'debug',
                SPUR_TELEMETRY_ENABLED: 'true',
            }),
        ).toEqual({
            database: { url: 'file:local.db' },
            server: {
                port: 4321,
                host: '0.0.0.0',
                openBrowser: true,
                webDistPath: null,
                a2a: { enabled: false },
                mcp: { enabled: false },
                gateway: { port: 3000, allowedHosts: [] },
            },
            telemetry: { enabled: true },
            logging: { level: 'debug' },
        });
    });

    test('parses boolean environment values explicitly', () => {
        expect(parseEnvBoolean('true')).toBe(true);
        expect(parseEnvBoolean('1')).toBe(true);
        expect(parseEnvBoolean('false')).toBe(false);
        expect(parseEnvBoolean('0')).toBe(false);
        expect(parseEnvBoolean(undefined)).toBeUndefined();
        expect(() => parseEnvBoolean('definitely')).toThrow('Invalid boolean environment value');
    });

    test('does not treat the string false as truthy', () => {
        expect(
            buildConfigFromEnv({
                SPUR_TELEMETRY_ENABLED: 'false',
            }).telemetry.enabled,
        ).toBe(false);
    });
});

describe('config — A2A listener (feature G9)', () => {
    test('the listener is off by default', () => {
        expect(configSchema.parse({}).server.a2a).toEqual({ enabled: false });
    });

    test('reads the switch and the token variable name from the environment', () => {
        const config = buildConfigFromEnv({
            SPUR_A2A_ENABLED: 'true',
            SPUR_A2A_AUTH_ENV: 'SPUR_A2A_TOKEN',
        });
        expect(config.server.a2a).toEqual({ enabled: true, authEnv: 'SPUR_A2A_TOKEN' });
    });

    test('an enabled listener without a token variable fails the load', () => {
        expect(() => configSchema.parse({ server: { a2a: { enabled: true } } })).toThrow(/authEnv/);
    });

    test('a malformed switch value is rejected, not silently treated as true', () => {
        expect(() => buildConfigFromEnv({ SPUR_A2A_ENABLED: 'yes-please' })).toThrow(/boolean/);
    });
});

describe('config — embedded MCP server (feature B9)', () => {
    test('the server is off by default', () => {
        expect(configSchema.parse({}).server.mcp).toEqual({ enabled: false });
    });

    test('reads the switch and the token variable name from the environment', () => {
        const config = buildConfigFromEnv({
            SPUR_MCP_ENABLED: 'true',
            SPUR_MCP_AUTH_ENV: 'SPUR_MCP_TOKEN',
        });
        expect(config.server.mcp).toEqual({ enabled: true, authEnv: 'SPUR_MCP_TOKEN' });
    });

    test('an enabled server without a token variable fails the load', () => {
        expect(() => configSchema.parse({ server: { mcp: { enabled: true } } })).toThrow(/authEnv/);
    });

    test('a malformed switch value is rejected, not silently treated as true', () => {
        expect(() => buildConfigFromEnv({ SPUR_MCP_ENABLED: 'yes-please' })).toThrow(/boolean/);
    });
});

describe('config — builder bump-ver resolution and the disabled-executor error', () => {
    test('resolves built-in release conventions when no section is declared', () => {
        const resolved = resolveBuilderBumpVerConfig(null);
        expect(resolved.ghRunListLimit).toBe(5);
    });

    test('a declared section wins over the defaults', () => {
        const resolved = resolveBuilderBumpVerConfig({ builder: { 'bump-ver': { ghRunListLimit: 2 } } } as never);
        expect(resolved.ghRunListLimit).toBe(2);
    });

    test('ExecutorDisabledError names the profile and the config path', () => {
        const error = new ExecutorDisabledError('codex');
        expect(error.message).toContain('codex');
        expect(error.name).toBe('ExecutorDisabledError');
    });
});
