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
                gateway: { port: 3000, allowedHosts: [], mcp: { enabled: false } },
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
                gateway: { port: 3000, allowedHosts: [], mcp: { enabled: false } },
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

describe('server.gateway.mcp (task 1382 R1)', () => {
    test('is off by default and mapped from its own env variables', () => {
        const off = configSchema.parse({});
        expect(off.server.gateway.mcp).toEqual({ enabled: false });

        const on = buildConfigFromEnv({
            SPUR_GATEWAY_MCP_ENABLED: 'true',
            SPUR_GATEWAY_MCP_AUTH_ENV: 'GW_MCP_TOKEN',
        });
        expect(on.server.gateway.mcp).toEqual({ enabled: true, authEnv: 'GW_MCP_TOKEN' });
    });

    test('enabled without a token variable fails the load, like server.mcp', () => {
        const result = configSchema.safeParse({ server: { gateway: { mcp: { enabled: true } } } });
        expect(result.success).toBe(false);
        const issue = result.success
            ? undefined
            : result.error.issues.find((i) => i.path.join('.') === 'server.gateway.mcp.authEnv');
        expect(issue?.message).toContain('server.gateway.mcp.enabled is true');
    });

    test('the gateway token variable is distinct from the project one', () => {
        // A gateway credential must never imply a project credential (task 1382 anti-pattern).
        const cfg = buildConfigFromEnv({
            SPUR_MCP_ENABLED: 'true',
            SPUR_MCP_AUTH_ENV: 'PROJECT_TOKEN',
            SPUR_GATEWAY_MCP_ENABLED: 'true',
            SPUR_GATEWAY_MCP_AUTH_ENV: 'GATEWAY_TOKEN',
        });
        expect(cfg.server.mcp.authEnv).toBe('PROJECT_TOKEN');
        expect(cfg.server.gateway.mcp.authEnv).toBe('GATEWAY_TOKEN');
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

// ─── 1449 R2: server.gateway.mcp inherits from server.mcp, but never its credential ───
// The failure modes: a gateway entry enabled with no usable credential (fails the load), a
// project token silently copied into the gateway's credential slot (ADR-151 K41), and an
// explicit `false` overridden by an inherited `true`.
describe('1449 — server.gateway.mcp conditional inheritance', () => {
    const fileConfig = (server: Record<string, unknown>) => spurConfigSchema.parse({ server });

    test('inherits allowUnauthenticated and an auth-satisfied enabled when gateway.mcp is omitted', () => {
        const cfg = buildConfigFromEnv({}, fileConfig({ mcp: { enabled: true, allowUnauthenticated: true } }));
        expect(cfg.server.gateway.mcp.enabled).toBe(true);
        expect(cfg.server.gateway.mcp.allowUnauthenticated).toBe(true);
    });

    test('an explicit false wins over the inherited enabled', () => {
        const cfg = buildConfigFromEnv(
            {},
            fileConfig({
                mcp: { enabled: true, allowUnauthenticated: true },
                gateway: { mcp: { enabled: false } },
            }),
        );
        expect(cfg.server.gateway.mcp.enabled).toBe(false);
        // The policy still inherits: only `enabled` is an explicit opt-out.
        expect(cfg.server.gateway.mcp.allowUnauthenticated).toBe(true);
    });

    test('a project token alone leaves the gateway entry off instead of failing the load', () => {
        const cfg = buildConfigFromEnv({}, fileConfig({ mcp: { enabled: true, authEnv: 'SPUR_MCP_TOKEN' } }));
        expect(cfg.server.mcp.enabled).toBe(true);
        expect(cfg.server.gateway.mcp.enabled).toBe(false);
        expect(cfg.server.gateway.mcp.authEnv).toBeUndefined();
    });

    test('the gateway credential is never copied from the project one', () => {
        const cfg = buildConfigFromEnv(
            {},
            fileConfig({
                mcp: { enabled: true, authEnv: 'SPUR_MCP_TOKEN' },
                gateway: { mcp: { enabled: true, authEnv: 'SPUR_GATEWAY_MCP_TOKEN' } },
            }),
        );
        expect(cfg.server.gateway.mcp.authEnv).toBe('SPUR_GATEWAY_MCP_TOKEN');
        expect(cfg.server.mcp.authEnv).toBe('SPUR_MCP_TOKEN');
    });

    test('SPUR_GATEWAY_MCP_ENABLED=false beats the file and the inheritance', () => {
        const cfg = buildConfigFromEnv(
            { SPUR_GATEWAY_MCP_ENABLED: 'false' },
            fileConfig({ mcp: { enabled: true, allowUnauthenticated: true } }),
        );
        expect(cfg.server.gateway.mcp.enabled).toBe(false);
    });
});
