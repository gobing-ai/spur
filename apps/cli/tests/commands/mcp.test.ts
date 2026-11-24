import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { setGatewayProbeForTests } from '@gobing-ai/spur-app';
import { buildConfigFromEnv, removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { MCP_PROTOCOL_VERSION, registerMcpCommand, resolveMcpUrl, runMcpStdioBridge } from '../../src/commands/mcp';
import type { CliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';

/** Feature B9, task 1373: `spur mcp` — thin stdio-to-HTTP bridge to the embedded `/mcp` endpoint. */

interface CapturedRequest {
    headers: Headers;
    body: string;
}

/** Mock `/mcp` upstream recording every request and answering with one canned body. */
function mockMcpUpstream(respond: () => { status: number; body: string }): {
    url: string;
    requests: CapturedRequest[];
    stop: () => void;
} {
    const requests: CapturedRequest[] = [];
    const server = Bun.serve({
        port: 0,
        fetch: async (req) => {
            requests.push({ headers: req.headers, body: await req.text() });
            const wanted = respond();
            return new Response(wanted.body, {
                status: wanted.status,
                headers: { 'Content-Type': 'application/json' },
            });
        },
    });
    return { url: `http://127.0.0.1:${server.port}/mcp`, requests, stop: () => server.stop(true) };
}

function captureOutput(): { output: CommandOutput; stdout: string[]; stderr: string[] } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return { output: { write: (m) => stdout.push(m), error: (m) => stderr.push(m) }, stdout, stderr };
}

describe('runMcpStdioBridge (task 1373 R1/R2)', () => {
    test('forwards NDJSON stdin lines to POST /mcp with protocol and bearer headers', async () => {
        const upstream = mockMcpUpstream(() => ({
            status: 200,
            body: '{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}',
        }));
        const { output, stdout } = captureOutput();
        const line1 = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}';
        const line2 = '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sp_task_show"}}';

        const exit = await runMcpStdioBridge({
            url: upstream.url,
            token: 'tok-123',
            input: Readable.from([`${line1}\n`, `\n${line2}\n`]),
            output,
        });

        expect(exit).toBe(0);
        expect(upstream.requests.length).toBe(2); // blank line skipped
        expect(upstream.requests[0]?.body).toBe(line1);
        expect(upstream.requests[1]?.body).toBe(line2);
        for (const req of upstream.requests) {
            expect(req.headers.get('Mcp-Protocol-Version')).toBe(MCP_PROTOCOL_VERSION);
            expect(req.headers.get('Content-Type')).toBe('application/json');
            expect(req.headers.get('Authorization')).toBe('Bearer tok-123');
        }
        expect(stdout).toEqual([
            '{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}',
            '{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}',
        ]);
        upstream.stop();
    });

    test('sends no Authorization header when no token is configured', async () => {
        const upstream = mockMcpUpstream(() => ({ status: 200, body: '{"ok":true}' }));
        const exit = await runMcpStdioBridge({
            url: upstream.url,
            token: null,
            input: Readable.from(['{"jsonrpc":"2.0","id":1}\n']),
            output: captureOutput().output,
        });

        expect(exit).toBe(0);
        expect(upstream.requests[0]?.headers.get('Authorization')).toBeNull();
        upstream.stop();
    });

    test('forwards non-2xx bodies verbatim without failing', async () => {
        const body = '{"error":{"code":"UNAUTHENTICATED","message":"a bearer token is required"}}';
        const upstream = mockMcpUpstream(() => ({ status: 401, body }));
        const { output, stdout } = captureOutput();

        const exit = await runMcpStdioBridge({
            url: upstream.url,
            token: 'wrong',
            input: Readable.from(['{}\n']),
            output,
        });

        expect(exit).toBe(0);
        expect(stdout).toEqual([body]);
        upstream.stop();
    });

    test('reports an unreachable upstream on stderr and exits 1', async () => {
        const dead = mockMcpUpstream(() => ({ status: 200, body: '{}' }));
        dead.stop(); // port is now closed — connection refused
        const { output, stdout, stderr } = captureOutput();

        const exit = await runMcpStdioBridge({
            url: dead.url,
            token: null,
            input: Readable.from(['{}\n']),
            output,
        });

        expect(exit).toBe(1);
        expect(stdout).toEqual([]);
        expect(stderr[0]).toContain('cannot reach');
    });
});

describe('resolveMcpUrl (task 1373 R1: gateway or direct port)', () => {
    let tempDir: string;
    let projectRoot: string;
    let projectsFile: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-mcp-url-'));
        projectRoot = join(tempDir, 'b9');
        mkdirSync(projectRoot, { recursive: true });
        projectsFile = join(tempDir, 'projects.json');
        setEnvVar('SPUR_PROJECTS_FILE', projectsFile);
        setGatewayProbeForTests(async () => false);
    });

    afterEach(() => {
        setGatewayProbeForTests(undefined);
        removeEnvVar('SPUR_PROJECTS_FILE');
        rmSync(tempDir, { recursive: true, force: true });
    });

    function seed(projects: Array<Record<string, unknown>>): void {
        writeFileSync(projectsFile, JSON.stringify({ schema_version: 1, projects }, null, 2), 'utf8');
    }

    const config = buildConfigFromEnv({}); // server.port 3000

    test('routes through the gateway prefix when the gateway answers', async () => {
        seed([{ name: 'b9', path: projectRoot, host: 'localhost', port: 3101, prefix: '/b9' }]);
        setGatewayProbeForTests(async () => true);

        const url = await resolveMcpUrl(projectRoot, {});

        expect(url).toBe(`http://localhost:${config.server.gateway.port}/b9/mcp`);
    });

    test('keeps the canonical gateway prefix when no gateway answers', async () => {
        seed([{ name: 'b9', path: projectRoot, host: 'localhost', port: 3101, prefix: '/b9' }]);

        // Availability is separate from URL identity: no direct-port substitution.
        expect(await resolveMcpUrl(projectRoot, {})).toBe(`http://localhost:${config.server.gateway.port}/b9/mcp`);
    });

    test('falls back to server.port for an unregistered project', async () => {
        expect(await resolveMcpUrl(projectRoot, {})).toBe(`http://127.0.0.1:${config.server.port}/mcp`);
    });
});

describe('registerMcpCommand wiring (task 1373 R2)', () => {
    test('fails loud on stderr when the authEnv variable is unset, with no stdout traffic', async () => {
        const tempDir = mkdtempSync(join(tmpdir(), 'spur-mcp-cmd-'));
        const { output, stdout, stderr } = captureOutput();
        const exits: number[] = [];
        // Server settings are env-scoped (like `spur self serve`): authEnv names a variable that is
        // deliberately absent from `env`.
        const context = {
            cwd: tempDir,
            output,
            env: { SPUR_MCP_AUTH_ENV: 'SPUR_TEST_TOKEN' },
            setExitCode: (code: number) => exits.push(code),
            loadAgentConfig: async () => null,
        } as unknown as CliContext;

        let action: ((options: { cwd?: string; url?: string }) => Promise<void>) | undefined;
        const chain = {
            summary: () => chain,
            option: () => chain,
            action: (fn: typeof action) => {
                action = fn;
                return chain;
            },
        };
        registerMcpCommand({ command: () => chain } as never, context);
        if (!action) throw new Error('mcp action not registered');

        await action({ cwd: tempDir });

        expect(exits).toEqual([1]);
        expect(stderr[0]).toContain('SPUR_TEST_TOKEN');
        expect(stdout).toEqual([]);
        rmSync(tempDir, { recursive: true, force: true });
    });
});

describe('probe: spur mcp end-to-end over the real CLI dispatch (task 1373 AC1)', () => {
    test('forwards stdin through the real CLI entry to the mock /mcp endpoint with no banner on stdout', async () => {
        const canned = '{"jsonrpc":"2.0","id":7,"result":{"tools":[]}}';
        const upstream = mockMcpUpstream(() => ({ status: 200, body: canned }));
        const tempDir = mkdtempSync(join(tmpdir(), 'spur-mcp-probe-'));
        const entry = join(import.meta.dir, '..', '..', 'src', 'index.ts');

        const proc = Bun.spawn(['bun', entry, 'mcp', '--url', upstream.url, '--cwd', tempDir], {
            cwd: tempDir,
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
        });
        proc.stdin.write('{"jsonrpc":"2.0","id":7,"method":"tools/list"}\n');
        await proc.stdin.end();
        const [stdout, stderr] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ]);
        const code = await proc.exited;

        expect(code).toBe(0);
        // Every stdout line is JSON — no startup banner, exactly one forwarded response.
        expect(stdout.trim().split('\n')).toEqual([canned]);
        expect(stderr).toBe('');
        // No project config in the temp dir → no authEnv → no Authorization header end-to-end.
        expect(upstream.requests[0]?.headers.get('Authorization')).toBeNull();
        expect(upstream.requests[0]?.headers.get('Mcp-Protocol-Version')).toBe(MCP_PROTOCOL_VERSION);
        // Boot-free dispatch: a full boot would have created the project DB at <cwd>/.spur/spur.db.
        expect(existsSync(join(tempDir, '.spur', 'spur.db'))).toBe(false);
        upstream.stop();
        rmSync(tempDir, { recursive: true, force: true });
    }, 60_000);
});
