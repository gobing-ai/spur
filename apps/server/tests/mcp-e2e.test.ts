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
import { registerSystemEventTap } from '@gobing-ai/spur-app';
import { getEnvVars, type ProjectEntry, setEnvVar } from '@gobing-ai/spur-config';
import { SystemEventDao } from '@gobing-ai/spur-domain';
import { EventBus } from '@gobing-ai/ts-infra';
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
/** 1376: the catalog-driven tap persists the mcp/auth names the module emits onto `ctx.eventBus()`. */
let eventDao: SystemEventDao;

beforeAll(async () => {
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
    const bus = new EventBus<Record<string, (event: unknown) => void>>();
    const ctx = createServerContext(mockRuntime(), {
        cwd: root,
        fs: createNodeFileSystem(root),
        dbUrl: ':memory:',
        env,
        bootConfig: serverBootstrapConfig(env),
        eventsBus: bus,
    });
    eventDao = new SystemEventDao(await ctx.getDb());
    await registerSystemEventTap(bus, eventDao, { warn: () => {}, debug: () => {} }, { diagnosticEnabled: false });
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
        namespace?: string;
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
        expect('namespace' in body.result).toBe(false);
        const toolNames = body.result.capabilities.tools.map((tool) => tool.name);
        expect(toolNames).toContain('sp_task_show');
        expect(toolNames).toContain('sp_workflow_run');
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

    test('R1: tools/call sp_task_show reads the real corpus task through the gateway', async () => {
        const res = await mcpPost(
            rpc('tools/call', { name: 'sp_task_show', arguments: { wbs: '9001' } }),
            authHeaders(),
        );
        expect(res.status).toBe(200);
        const body = await jsonBody<{ result: { wbs: string; name: string; content: string } }>(res);
        expect(body.result.wbs).toBe('9001');
        expect(body.result.name).toBe('e2e probe');
        expect(body.result.content).toContain('E2E probe task body');
    });

    test('R2: an old unprefixed tool name is refused with its sp_ replacement', async () => {
        const res = await mcpPost(rpc('tools/call', { name: 'task_show', arguments: { wbs: '9001' } }), authHeaders());
        expect(res.status).toBe(500);
        const body = await jsonBody<{ error: { code: number; message: string } }>(res);
        expect(body.error.message).toContain('tool "task_show" was renamed to "sp_task_show"');
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

    test('R4: enabled with an unset token variable answers 500 with the mcp error envelope', async () => {
        // A second real serve app whose token-variable NAME is unset: the guard must refuse
        // loudly (500, no challenge header) instead of serving open or faking a 404.
        const unsetEnv: Record<string, string | undefined> = {
            NODE_ENV: 'test',
            SPUR_MCP_ENABLED: 'true',
            SPUR_MCP_AUTH_ENV: 'SPUR_E2E_MCP_UNSET_TOKEN_VAR',
        };
        const ctx = createServerContext(mockRuntime(), {
            cwd: root,
            fs: createNodeFileSystem(root),
            dbUrl: ':memory:',
            env: unsetEnv,
            bootConfig: serverBootstrapConfig(unsetEnv),
        });
        const app = createApp(mockRuntime(), { ctx });
        const res = await app.request('/mcp', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Mcp-Protocol-Version': MIN_MCP_PROTOCOL_VERSION,
                Authorization: `Bearer ${TOKEN}`,
            },
            body: JSON.stringify(rpc('server/discover')),
        });
        expect(res.status).toBe(500);
        expect(res.headers.get('WWW-Authenticate')).toBeNull();
        const body = await jsonBody<{ error: { code: string; message: string } }>(res);
        expect(body.error.code).toBe('INTERNAL_ERROR');
        expect(body.error.message).toContain('server.mcp.authEnv');
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
        expect(answer.result.capabilities.tools.map((tool) => tool.name)).toContain('sp_task_show');
    }, 60_000);

    test('R3 (1380): server/discover reports namespace from plugin manifest and SPUR_MCP_NAMESPACE override', async () => {
        const nsRoot = mkdtempSync(join(tmpdir(), 'spur-mcp-e2e-ns-'));
        try {
            mkdirSync(join(nsRoot, 'plugins', 'kk'), { recursive: true });
            writeFileSync(join(nsRoot, 'plugins', 'kk', 'plugin.json'), JSON.stringify({ name: 'kk' }));

            const manifestEnv: Record<string, string | undefined> = {
                NODE_ENV: 'test',
                SPUR_MCP_ENABLED: 'true',
                SPUR_MCP_AUTH_ENV: TOKEN_VAR,
            };
            const manifestApp = createApp(mockRuntime(), {
                ctx: createServerContext(mockRuntime(), {
                    cwd: nsRoot,
                    fs: createNodeFileSystem(nsRoot),
                    dbUrl: ':memory:',
                    env: manifestEnv,
                    bootConfig: serverBootstrapConfig(manifestEnv),
                }),
            });
            const manifestRes = await manifestApp.fetch(
                new Request('http://localhost/mcp', {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify(rpc('server/discover')),
                }),
            );
            expect(manifestRes.status).toBe(200);
            expect((await jsonBody<DiscoverBody>(manifestRes)).result.namespace).toBe('kk');

            const overrideEnv: Record<string, string | undefined> = {
                ...manifestEnv,
                SPUR_MCP_NAMESPACE: 'cc',
            };
            const overrideApp = createApp(mockRuntime(), {
                ctx: createServerContext(mockRuntime(), {
                    cwd: nsRoot,
                    fs: createNodeFileSystem(nsRoot),
                    dbUrl: ':memory:',
                    env: overrideEnv,
                    bootConfig: serverBootstrapConfig(overrideEnv),
                }),
            });
            const overrideRes = await overrideApp.fetch(
                new Request('http://localhost/mcp', {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify(rpc('server/discover')),
                }),
            );
            expect(overrideRes.status).toBe(200);
            expect((await jsonBody<DiscoverBody>(overrideRes)).result.namespace).toBe('cc');
        } finally {
            rmSync(nsRoot, { recursive: true, force: true });
        }
    });

    test('R2/R3 (1381): an opted-in workflow is a namespaced tool that runs through the service path', async () => {
        const wfRoot = mkdtempSync(join(tmpdir(), 'spur-mcp-e2e-wf-'));
        try {
            mkdirSync(join(wfRoot, 'plugins', 'kk'), { recursive: true });
            writeFileSync(join(wfRoot, 'plugins', 'kk', 'plugin.json'), JSON.stringify({ name: 'kk' }));
            mkdirSync(join(wfRoot, '.spur', 'workflows'), { recursive: true });
            writeFileSync(
                join(wfRoot, '.spur', 'workflows', 'daily-report.yaml'),
                `name: daily-report
description: build the daily report
kind: state-machine
metadata:
  mcp:
    expose: true
vars:
  target: default-target
initialState: start
states:
  - id: start
  - id: done
transitions:
  - from: start
    to: done
    guard: { kind: always }
terminalStates:
  - done
`,
            );
            writeFileSync(
                join(wfRoot, '.spur', 'workflows', 'hidden.yaml'),
                `name: hidden-flow
kind: state-machine
initialState: start
states:
  - id: start
terminalStates:
  - start
`,
            );

            const env: Record<string, string | undefined> = {
                NODE_ENV: 'test',
                SPUR_MCP_ENABLED: 'true',
                SPUR_MCP_AUTH_ENV: TOKEN_VAR,
            };
            const wfApp = createApp(mockRuntime(), {
                ctx: createServerContext(mockRuntime(), {
                    cwd: wfRoot,
                    fs: createNodeFileSystem(wfRoot),
                    dbUrl: ':memory:',
                    env,
                    bootConfig: serverBootstrapConfig(env),
                }),
            });
            const post = (body: unknown) =>
                wfApp.fetch(
                    new Request('http://localhost/mcp', {
                        method: 'POST',
                        headers: authHeaders(),
                        body: JSON.stringify(body),
                    }),
                );

            // First request is the call, not the list — the ordering a hostile client can pick.
            // (This does not deterministically reproduce the not-yet-resolved namespace: the
            // resolver's fs awaits usually settle first. The `namespaceReady` await in
            // exposedWorkflowTools is the actual guard.)
            const firstCall = await post(
                rpc('tools/call', { name: 'kk_daily_report', arguments: { target: 'first' } }),
            );
            expect(firstCall.status).toBe(200);

            const listed = await post(rpc('tools/list'));
            expect(listed.status).toBe(200);
            const listedBody = await jsonBody<{
                result: { tools: Array<{ name: string; description?: string; inputSchema: unknown }> };
            }>(listed);
            const byName = new Map(listedBody.result.tools.map((tool) => [tool.name, tool]));
            expect([...byName.keys()]).toContain('kk_daily_report');
            expect([...byName.keys()]).not.toContain('kk_hidden_flow');
            expect(byName.get('kk_daily_report')?.description).toBe('build the daily report');
            expect(byName.get('kk_daily_report')?.inputSchema).toEqual({
                type: 'object',
                properties: { target: { type: 'string', default: 'default-target' } },
                additionalProperties: false,
            });

            const refused = await post(rpc('tools/call', { name: 'kk_daily_report', arguments: { bogus: 'x' } }));
            expect(refused.status).toBe(500);
            const refusedBody = await jsonBody<{ error: { message: string } }>(refused);
            expect(refusedBody.error.message).toContain('invalid_arguments');

            const called = await post(rpc('tools/call', { name: 'kk_daily_report', arguments: { target: 'today' } }));
            expect(called.status).toBe(200);
            const calledBody = await jsonBody<{ result: { runId: string; status: string } }>(called);
            expect(typeof calledBody.result.runId).toBe('string');
            expect(calledBody.result.status).toBe('done');
        } finally {
            rmSync(wfRoot, { recursive: true, force: true });
        }
    });
});

/**
 * 1376 — the embedded MCP surface is observable: every tool call, resource read and auth refusal
 * lands one cataloged row in the `system_events` ledger through the real tap (no mocked bus).
 * Payload assertions double as the R5 leak check: argument values and the token never appear.
 */
describe('1376: mcp events reach the system_events ledger', () => {
    /** One row per emitted name, parsed down to the persisted `data` (the v2 envelope's payload). */
    async function rowsFor(name: string): Promise<Array<{ payload: Record<string, unknown>; raw: string }>> {
        const rows = await eventDao.query({ name, limit: 20 });
        return rows.map((row) => {
            const raw = row.payload_json ?? '';
            const parsed = JSON.parse(raw === '' ? '{}' : raw) as { data?: Record<string, unknown> };
            return { payload: parsed.data ?? {}, raw };
        });
    }

    test('a successful tool call emits mcp.tool.called with metadata only (R2, R5)', async () => {
        // 1379/1380 namespaced the harness tools: `task_show` → `sp_task_show`.
        const res = await mcpPost(
            rpc('tools/call', { name: 'sp_task_show', arguments: { wbs: '9001' } }),
            authHeaders(),
        );
        expect(res.status).toBe(200);
        const [row] = await rowsFor('mcp.tool.called');
        if (row === undefined) throw new Error('expected an mcp.tool.called row');
        expect(row.payload.tool).toBe('sp_task_show');
        expect(row.payload.argKeys).toEqual(['wbs']);
        expect(row.payload.outcome).toBe('ok');
        expect(row.payload.wbs).toBe('9001');
        expect(typeof row.payload.durationMs).toBe('number');
        // R5: key names, never values; no token, no header.
        expect(row.raw).not.toContain(TOKEN);
        expect(row.raw).not.toContain('E2E probe task body');
    });

    test('an unknown tool emits mcp.tool.failed with errorCode unknown_tool (R2)', async () => {
        const res = await mcpPost(rpc('tools/call', { name: 'no_such_tool', arguments: {} }), authHeaders());
        // 1374's adapter maps a non-protocol throw to 500 INTERNAL_ERROR; 1376 adds the event, not a status.
        expect(res.status).toBe(500);
        const [row] = await rowsFor('mcp.tool.failed');
        if (row === undefined) throw new Error('expected an mcp.tool.failed row');
        expect(row.payload.tool).toBe('no_such_tool');
        expect(row.payload.errorCode).toBe('unknown_tool');
        expect(row.payload.outcome).toBe('error');
    });

    test('missing required arguments emit mcp.tool.failed with errorCode invalid_arguments (R2)', async () => {
        await mcpPost(rpc('tools/call', { name: 'sp_task_show', arguments: {} }), authHeaders());
        const rows = await rowsFor('mcp.tool.failed');
        const codes = rows.map((row) => row.payload.errorCode);
        expect(codes).toContain('invalid_arguments');
    });

    test('a resource read emits mcp.resource.read (R3)', async () => {
        const res = await mcpPost(rpc('resources/read', { uri: 'spur://context/learnings.md' }), authHeaders());
        expect(res.status).toBe(200);
        const [row] = await rowsFor('mcp.resource.read');
        if (row === undefined) throw new Error('expected an mcp.resource.read row');
        expect(row.payload.uri).toBe('spur://context/learnings.md');
        expect(row.payload.outcome).toBe('ok');
        expect(typeof row.payload.durationMs).toBe('number');
    });

    test('a refused request emits auth.denied without token material (R4, R5)', async () => {
        const res = await mcpPost(rpc('tools/list'), { 'Content-Type': 'application/json' });
        expect(res.status).toBe(401);
        const rows = await rowsFor('auth.denied');
        const mcpRow = rows.find((row) => row.payload.surface === 'mcp');
        if (mcpRow === undefined) throw new Error('expected an auth.denied row for surface mcp');
        expect(mcpRow.payload.reason).toBe('missing');
        expect(mcpRow.payload.path).toBe('/mcp');
        expect(mcpRow.raw).not.toContain(TOKEN);
    });
});
