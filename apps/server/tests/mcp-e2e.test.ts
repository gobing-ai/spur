/**
 * B9 task 1374 — end-to-end: gateway `/<prefix>/mcp` → `spur serve` `mcpModule` → the 1371
 * protocol adapter → the real `@gobing-ai/spur-app` services.
 *
 * No mocks of `mcpModule` or `gatewayGuard` (task anti-pattern): a real serve app
 * (`createApp` + module registry + middleware pipeline) answers on an ephemeral upstream port
 * behind a real `startGateway` listener routing the `/e2e` prefix, and `spur mcp` runs as a real
 * CLI subprocess for the stdio round-trip. The boot path is the real one too: env →
 * `serverBootstrapConfig` (task 1370) → `bootConfig.mcp` → module mount.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars, type ProjectEntry, setEnvVar } from '@gobing-ai/spur-config';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { createApp } from '../src/bootstrap';
import { createServerContext } from '../src/context';
import { type GatewayHandle, startGateway } from '../src/gateway';
import { MIN_MCP_PROTOCOL_VERSION } from '../src/modules/mcp/protocol';
import { serverBootstrapConfig } from '../src/server-config';
import { mockRuntime } from './middleware/helpers';

const TOKEN = 'e2e-mcp-token-9001';
const TOKEN_VAR = 'SPUR_E2E_MCP_TOKEN';
const PREFIX = '/e2e';
/** Newest legacy pre-2.0 version: `2026-07-28`+ is the only accepted line (AC2). */
const LEGACY_VERSIONS = ['2024-11-05', '2025-03-26', '2025-11-25'];

let root = '';
let upstream: ReturnType<typeof Bun.serve> | undefined;
let gateway: GatewayHandle | undefined;
let baseUrl = '';

beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'spur-mcp-e2e-'));
    mkdirSync(join(root, 'docs', 'tasks'), { recursive: true });
    mkdirSync(join(root, '.spur', 'context'), { recursive: true });
    writeFileSync(
        join(root, 'docs', 'tasks', '9001_e2e-probe.md'),
        '---\nname: e2e probe\nstatus: todo\n---\n\nE2E probe task body.\n',
    );
    writeFileSync(join(root, '.spur', 'context', 'learnings.md'), 'indexed context body\n');

    // The module resolves the token value through the env funnel — the live record
    // `getEnvVars()` returns — exactly as `spur serve` does; a real ServerContext has no
    // top-level env map to inject through.
    setEnvVar(TOKEN_VAR, TOKEN);
    const env: Record<string, string | undefined> = {
        NODE_ENV: 'test',
        SPUR_MCP_ENABLED: 'true',
        SPUR_MCP_AUTH_ENV: TOKEN_VAR,
    };
    const ctx = createServerContext(mockRuntime(), {
        cwd: root,
        fs: createNodeFileSystem(root),
        dbUrl: ':memory:',
        env,
        bootConfig: serverBootstrapConfig(env),
    });
    const app = createApp(mockRuntime(), { ctx });
    const up = Bun.serve({ port: 0, hostname: '127.0.0.1', idleTimeout: 0, fetch: app.fetch });
    upstream = up;
    gateway = startGateway({
        port: 0,
        host: '127.0.0.1',
        deps: {
            port: 0,
            listProjects: async () => [
                { name: 'e2e-mcp', path: root, port: up.port, host: 'localhost', prefix: PREFIX } as ProjectEntry,
            ],
            // Bun types `port` optional; a port-0 bind always reports the bound port.
            ensureUpstream: async () => up.port ?? 0,
            edge: { bindHost: '127.0.0.1', allowedHosts: [] },
        },
    });
    baseUrl = `http://127.0.0.1:${gateway.port}${PREFIX}`;
});

afterAll(() => {
    setEnvVar(TOKEN_VAR, undefined);
    gateway?.stop();
    upstream?.stop(true);
    if (root !== '') rmSync(root, { recursive: true, force: true });
});

/** One JSON-RPC 2.0 request body. */
function rpc(method: string, params?: unknown, id = 1): Record<string, unknown> {
    return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
}

/** Bearer + protocol headers every accepted MCP call carries. */
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        'Mcp-Protocol-Version': MIN_MCP_PROTOCOL_VERSION,
        Authorization: `Bearer ${TOKEN}`,
        ...extra,
    };
}

function mcpPost(body: unknown, headers: Record<string, string>): Promise<Response> {
    return fetch(`${baseUrl}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });
}

/** Parse a response body as one JSON-RPC result/error envelope of the given shape. */
async function jsonBody<T>(res: Response): Promise<T> {
    return (await res.json()) as T;
}

/** The `server/discover` result envelope the stateless adapter answers with. */
interface DiscoverBody {
    result: {
        protocolVersion: string;
        capabilities: {
            tools: Array<{ name: string }>;
            resources: Array<{ uri: string }>;
        };
    };
}

describe('mcp E2E through the project gateway (task 1374)', () => {
    test('AC1: gateway proxies /e2e/mcp server/discover to the embedded mcpModule', async () => {
        const res = await mcpPost(rpc('server/discover'), authHeaders());
        expect(res.status).toBe(200);
        const body = await jsonBody<DiscoverBody>(res);
        expect(body.result.protocolVersion).toBe(MIN_MCP_PROTOCOL_VERSION);
        const toolNames = body.result.capabilities.tools.map((tool) => tool.name);
        expect(toolNames).toContain('task_show');
        expect(toolNames).toContain('workflow_run');
        const uris = body.result.capabilities.resources.map((res) => res.uri);
        expect(uris).toContain('spur://tasks/{wbs}');
    });

    test('AC1: bearer-auth CSRF exemption — a form-typed simple request still reaches /mcp, but not /e2e/<other>', async () => {
        // text/plain + no Origin is the cross-site "simple request" shape csrf()/gatewayGuard
        // reject on ordinary paths; the mcp exemption must let it through on both hops.
        const exempt = await mcpPost(rpc('server/discover'), authHeaders({ 'Content-Type': 'text/plain' }));
        expect(exempt.status).toBe(200);
        const guarded = await fetch(`${baseUrl}/nope`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: 'same shape, ordinary path',
        });
        expect(guarded.status).toBe(403);
    });

    test('R1: tools/call task_show reads the real corpus task through the gateway', async () => {
        const res = await mcpPost(rpc('tools/call', { name: 'task_show', arguments: { wbs: '9001' } }), authHeaders());
        expect(res.status).toBe(200);
        const body = await jsonBody<{ result: { wbs: string; name: string; content: string } }>(res);
        expect(body.result.wbs).toBe('9001');
        expect(body.result.name).toBe('e2e probe');
        expect(body.result.content).toContain('E2E probe task body');
    });

    test('R1: resources/read returns spur://tasks and spur://context bodies through the gateway', async () => {
        const task = await mcpPost(rpc('resources/read', { uri: 'spur://tasks/9001' }), authHeaders());
        expect(task.status).toBe(200);
        const taskBody = await jsonBody<{ result: { content: string } }>(task);
        expect(taskBody.result.content).toContain('E2E probe task body');

        const context = await mcpPost(rpc('resources/read', { uri: 'spur://context/learnings.md' }), authHeaders());
        expect(context.status).toBe(200);
        const contextBody = await jsonBody<{ result: { text: string } }>(context);
        expect(contextBody.result.text).toContain('indexed context body');
    });

    test('R1: missing and wrong bearer tokens are 401 with the challenge header', async () => {
        const missing = await mcpPost(rpc('server/discover'), {
            'Content-Type': 'application/json',
            'Mcp-Protocol-Version': MIN_MCP_PROTOCOL_VERSION,
        });
        expect(missing.status).toBe(401);
        expect(missing.headers.get('WWW-Authenticate')).toBe('Bearer realm="spur-mcp"');
        const wrong = await mcpPost(rpc('server/discover'), authHeaders({ Authorization: 'Bearer not-the-token' }));
        expect(wrong.status).toBe(401);
    });

    test('AC2: legacy pre-2026-07-28 protocol versions are rejected, never negotiated', async () => {
        for (const version of LEGACY_VERSIONS) {
            const res = await mcpPost(rpc('server/discover'), authHeaders({ 'Mcp-Protocol-Version': version }));
            expect(res.status).toBe(400);
            const body = await jsonBody<{ error: { code: string; message: string } }>(res);
            // The version gate runs before body parsing, so even a JSON-RPC request gets the
            // bare { error: { code, message } } shape, not the JSON-RPC error envelope.
            expect(body.error.code).toBe('PROTOCOL_VERSION_UNSUPPORTED');
            expect(body.error.message).toContain(MIN_MCP_PROTOCOL_VERSION);
        }
    });

    test('frozen scenario: spur mcp stdio bridge round-trips through the gateway', async () => {
        const cli = join(import.meta.dir, '../../cli/src/index.ts');
        const proc = Bun.spawn([process.execPath, cli, 'mcp', '--url', `${baseUrl}/mcp`], {
            cwd: root,
            env: { ...getEnvVars(), SPUR_MCP_AUTH_ENV: TOKEN_VAR, [TOKEN_VAR]: TOKEN },
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
        });
        proc.stdin.write(`${JSON.stringify(rpc('server/discover', undefined, 7))}\n`);
        proc.stdin.end();
        const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
        const code = await proc.exited;
        const lines = out
            .trim()
            .split('\n')
            .filter((line) => line !== '');
        const answerLine = lines.length === 1 ? lines[0] : undefined;
        if (answerLine === undefined) throw new Error(`expected one bridged response, got stderr: ${err}`);
        expect(code).toBe(0);
        const answer = JSON.parse(answerLine) as DiscoverBody & { id: number };
        expect(answer.id).toBe(7);
        expect(answer.result.capabilities.tools.map((tool) => tool.name)).toContain('task_show');
    }, 60_000);
});
