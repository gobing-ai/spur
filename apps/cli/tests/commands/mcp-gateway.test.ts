import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { setGatewayProbeForTests } from '@gobing-ai/spur-app';
import { getEnvVars } from '@gobing-ai/spur-config';
import { resolveGatewayMcpUrl, runMcpStdioBridge } from '../../src/commands/mcp';

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

test('the installed stdio entry initializes and calls tools through a CLI-started gateway', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'spur-gateway-stdio-'));
    const entry = join(import.meta.dir, '../../src/index.ts');
    const requests: Array<string | null> = [];
    const upstream = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
            if (new URL(request.url).pathname !== '/mcp') return new Response(null, { status: 404 });
            const authorization = request.headers.get('authorization');
            requests.push(authorization);
            if (authorization !== 'Bearer project-secret') return new Response(null, { status: 401 });
            const { id, params } = (await request.json()) as { id: number; params: { arguments: { status?: string } } };
            const result =
                params.arguments.status === 'todo'
                    ? { content: [{ type: 'text', text: 'already wrapped' }] }
                    : [{ arguments: params.arguments }];
            return Response.json({ jsonrpc: '2.0', id, result });
        },
    });
    const projectsFile = join(cwd, 'projects.json');
    writeFileSync(
        projectsFile,
        JSON.stringify({ schema_version: 1, projects: [{ name: 'fixture', path: cwd, port: upstream.port }] }),
    );
    const gatewayEnv = {
        ...getEnvVars(),
        ...env(),
        HOME: cwd,
        SPUR_PROJECTS_FILE: projectsFile,
        SPUR_MCP_ENABLED: 'true',
        SPUR_MCP_AUTH_ENV: 'PROJECT_TOKEN',
        PROJECT_TOKEN: 'project-secret',
    };
    const gateway = Bun.spawn(['bun', entry, 'self', 'serve', '--gateway', '--port', '0', '--no-open'], {
        cwd,
        env: gatewayEnv,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    try {
        let startup = '';
        for await (const chunk of gateway.stdout.pipeThrough(new TextDecoderStream())) {
            startup += chunk;
            if (/Spur gateway listening on http:\/\/localhost:\d+/.test(startup)) break;
        }
        const port = startup.match(/Spur gateway listening on http:\/\/localhost:(\d+)/)?.[1];
        if (port === undefined)
            throw new Error(`Gateway failed to start: ${await new Response(gateway.stderr).text()}`);
        const url = `http://localhost:${port}/mcp`;
        const params = { name: 'sp_task_list', arguments: { project: 'fixture' } };
        const rpc = (id: number, method: string, requestParams?: object) =>
            JSON.stringify({ jsonrpc: '2.0', id, method, params: requestParams });
        const call = rpc(3, 'tools/call', params);
        const upstreamCall = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Mcp-Protocol-Version': '2026-07-28',
                Authorization: 'Bearer gateway-secret',
            },
            body: call,
        });
        expect(await upstreamCall.json()).toEqual({ jsonrpc: '2.0', id: 3, result: [{ arguments: {} }] });

        const bridge = Bun.spawn(['bun', entry, 'mcp', '--gateway'], {
            cwd,
            env: { ...gatewayEnv, PROJECT_TOKEN: undefined, SPUR_GATEWAY_PORT: port },
            stdin: new Blob([`${rpc(2, 'tools/list')}\n`]),
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const [stdout, stderr, code] = await Promise.all([
            new Response(bridge.stdout).text(),
            new Response(bridge.stderr).text(),
            bridge.exited,
        ]);
        expect(stderr).toBe('');
        expect(code).toBe(0);
        const catalog = JSON.parse(stdout);
        expect(catalog.result.tools.map(({ name }: { name: string }) => name)).toContain('sp_task_list');

        const messages = [
            rpc(1, 'initialize', {
                protocolVersion: '2025-11-25',
                capabilities: {},
                clientInfo: { name: 'fixture', version: '1' },
            }),
            '{"jsonrpc":"2.0","method":"notifications/initialized"}',
            rpc(2, 'tools/list'),
            call,
            rpc(4, 'ping'),
            rpc(5, 'tools/call', { ...params, arguments: { ...params.arguments, status: 'todo' } }),
        ];
        const replies: Array<{ id: number; result: unknown }> = [];
        const errors: string[] = [];
        const exit = await runMcpStdioBridge({
            url,
            token: 'gateway-secret',
            input: Readable.from([`${messages.join('\n')}\n`]),
            output: { write: (line) => replies.push(JSON.parse(line)), error: (message) => errors.push(message) },
        });
        expect(errors).toEqual([]);
        expect(exit).toBe(0);
        expect(replies.map(({ id }) => id)).toEqual([1, 2, 3, 4, 5]);
        expect(replies[0]?.result).toMatchObject({ protocolVersion: '2025-11-25', capabilities: { tools: {} } });
        expect(replies[1]).toEqual(catalog);
        expect(replies[2]?.result).toEqual({ content: [{ type: 'text', text: '[{"arguments":{}}]' }] });
        expect(replies[3]?.result).toEqual({});
        expect(replies[4]?.result).toEqual({ content: [{ type: 'text', text: 'already wrapped' }] });
        expect(requests).toEqual(Array(3).fill('Bearer project-secret'));
    } finally {
        gateway.kill();
        await gateway.exited;
        upstream.stop(true);
        rmSync(cwd, { recursive: true, force: true });
    }
}, 30_000);
