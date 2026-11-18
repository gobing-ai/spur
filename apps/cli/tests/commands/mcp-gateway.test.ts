import { describe, expect, test } from 'bun:test';
import { setGatewayProbeForTests } from '@gobing-ai/spur-app';
import { resolveGatewayMcpUrl } from '../../src/commands/mcp';

/**
 * Task 1401 R1 — `spur mcp --gateway` targets the gateway root `/mcp` with the GATEWAY's own token
 * variable, and every misconfiguration names the fix instead of failing mid-session.
 */
const env = (overrides: Record<string, string | undefined> = {}) => ({
    SPUR_GATEWAY_MCP_ENABLED: 'true',
    SPUR_GATEWAY_MCP_AUTH_ENV: 'GW_TOKEN',
    GW_TOKEN: 'gateway-secret',
    ...overrides,
});

/** Force the gateway probe: `true` answers, `false` is down. */
function probe(answer: boolean): void {
    setGatewayProbeForTests(async () => answer);
}

describe('spur mcp --gateway resolution (task 1401 R1)', () => {
    test('targets the gateway root on the configured port with its own token variable', async () => {
        probe(true);
        const resolved = await resolveGatewayMcpUrl(env());
        expect(resolved.url).toBe('http://localhost:3000/mcp');
        expect(resolved.authEnv).toBe('GW_TOKEN');
    }, 20_000);

    test('refuses when the gateway MCP entry is disabled or has no token variable', async () => {
        probe(true);
        await expect(resolveGatewayMcpUrl(env({ SPUR_GATEWAY_MCP_ENABLED: 'false' }))).rejects.toThrow(/disabled/);
        // The config schema refuses `enabled` without `authEnv` at load time, so the bridge never
        // sees that state; the message still names the variable.
        await expect(resolveGatewayMcpUrl(env({ SPUR_GATEWAY_MCP_AUTH_ENV: undefined }))).rejects.toThrow(/authEnv/);
    });

    test('refuses an unset or empty token variable without echoing a value', async () => {
        probe(true);
        const unset = resolveGatewayMcpUrl(env({ GW_TOKEN: undefined }));
        await expect(unset).rejects.toThrow(/unset or empty/);
        await expect(unset).rejects.not.toThrow(/gateway-secret/);
        await expect(resolveGatewayMcpUrl(env({ GW_TOKEN: '' }))).rejects.toThrow(/unset or empty/);
    });

    test('refuses when no gateway is answering, naming the way to start it', async () => {
        probe(false);
        await expect(resolveGatewayMcpUrl(env())).rejects.toThrow(
            /no gateway is answering[\s\S]*spur self serve --gateway/,
        );
    });
});

describe('spur mcp --gateway through the program (task 1401 R1)', () => {
    test('--gateway with --url is a usage error, and the failure goes to stderr only', async () => {
        const { main } = await import('../../src/index');
        const errors: string[] = [];
        const output = { write: () => {}, error: (message: string) => errors.push(message) };
        const code = await main(['mcp', '--gateway', '--url', 'http://127.0.0.1:1/mcp'], {
            cwd: process.cwd(),
            output,
            env: env(),
        });
        expect(code).toBe(1);
        // stdout is the JSON-RPC channel, so the refusal never lands there.
        expect(errors.join('\n')).toContain('mutually exclusive');
    });

    test('a disabled gateway fails the command instead of starting a bridge', async () => {
        const { main } = await import('../../src/index');
        const errors: string[] = [];
        const code = await main(['mcp', '--gateway'], {
            cwd: process.cwd(),
            output: { write: () => {}, error: (message: string) => errors.push(message) },
            env: env({ SPUR_GATEWAY_MCP_ENABLED: 'false' }),
        });
        expect(code).toBe(1);
        expect(errors.join('\n')).toContain('disabled');
    });
});
