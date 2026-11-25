import { describe, expect, test } from 'bun:test';
import {
    buildConfigFromEnv,
    configSchema,
    ExecutorDisabledError,
    parseAllowedHosts,
    parseEnvBoolean,
    resolveBuilderBumpVerConfig,
    spurConfigSchema,
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

    test('reads the switch, token variable name, and namespace from the environment', () => {
        const config = buildConfigFromEnv({
            SPUR_MCP_ENABLED: 'true',
            SPUR_MCP_AUTH_ENV: 'SPUR_MCP_TOKEN',
            SPUR_MCP_NAMESPACE: 'cc',
        });
        expect(config.server.mcp).toEqual({ enabled: true, authEnv: 'SPUR_MCP_TOKEN', namespace: 'cc' });
    });

    test('an invalid SPUR_MCP_NAMESPACE fails config load naming the variable and grammar', () => {
        expect(() => buildConfigFromEnv({ SPUR_MCP_NAMESPACE: 'Bad-Name' })).toThrow(
            /SPUR_MCP_NAMESPACE.*\[a-z\]\[a-z0-9\]\{1,15\}/,
        );
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

describe('server.gateway.allowedHosts (tunnel hostnames)', () => {
    test('is empty by default — loopback and the bind host only', () => {
        expect(buildConfigFromEnv({}).server.gateway.allowedHosts).toEqual([]);
    });

    test('maps the comma-separated SPUR_GATEWAY_ALLOWED_HOSTS list', () => {
        const cfg = buildConfigFromEnv({ SPUR_GATEWAY_ALLOWED_HOSTS: 'spur.example.net, gw.example.net ' });
        expect(cfg.server.gateway.allowedHosts).toEqual(['spur.example.net', 'gw.example.net']);
    });

    test('drops blank entries instead of failing the schema on them', () => {
        // `spur self install --daemon` bakes whatever env it sees into the plist; a stray comma must
        // degrade to the loopback-only default, not crash the gateway at boot.
        expect(parseAllowedHosts(' , ')).toEqual([]);
        expect(parseAllowedHosts(undefined)).toEqual([]);
    });
});

// ─── K44 1450: one server.mcp drives both MCP endpoints ───
// The failure modes: a legacy `server.gateway.mcp` block or `SPUR_GATEWAY_MCP_*` variable still
// switching the gateway root `/mcp` on or off independently, or naming a second token variable.
describe('1450 — server.gateway.mcp is gone; server.mcp is the only MCP config', () => {
    const fileConfig = (server: Record<string, unknown>) => spurConfigSchema.parse({ server });

    test('the resolved gateway config carries no mcp entry', () => {
        const cfg = buildConfigFromEnv({}, fileConfig({ mcp: { enabled: true, allowUnauthenticated: true } }));
        expect(cfg.server.gateway).toEqual({ port: 3000, allowedHosts: [] });
        expect(cfg.server.mcp).toMatchObject({ enabled: true, allowUnauthenticated: true });
    });

    test('a legacy server.gateway.mcp block has no effect', () => {
        const cfg = buildConfigFromEnv(
            {},
            fileConfig({
                mcp: { enabled: false },
                gateway: { mcp: { enabled: true, authEnv: 'SPUR_GATEWAY_MCP_TOKEN' } },
            }),
        );
        expect(cfg.server.mcp.enabled).toBe(false);
        expect(cfg.server.gateway).not.toHaveProperty('mcp');
        expect(JSON.stringify(cfg)).not.toContain('SPUR_GATEWAY_MCP_TOKEN');
    });

    test('SPUR_GATEWAY_MCP_* variables have no effect', () => {
        const cfg = buildConfigFromEnv({
            SPUR_GATEWAY_MCP_ENABLED: 'true',
            SPUR_GATEWAY_MCP_AUTH_ENV: 'GATEWAY_TOKEN',
        });
        expect(cfg.server.mcp.enabled).toBe(false);
        expect(JSON.stringify(cfg)).not.toContain('GATEWAY_TOKEN');
    });
});
