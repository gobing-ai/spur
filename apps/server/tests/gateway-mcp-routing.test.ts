import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGateway } from '../src/gateway';
import { MIN_MCP_PROTOCOL_VERSION } from '../src/modules/mcp/protocol';

/**
 * Task 1383 — the gateway aggregates each local project's exposed workflow tools and routes a call
 * to the owning project, starting it on demand.
 *
 * The upstream is a real HTTP server that speaks the MCP adapter's contract (it echoes the tool it
 * received), so the assertions cover the wire shape the gateway actually sends rather than a mock.
 */
const TOKEN = 'gateway-project-token-1383';
const TOKEN_VAR = 'SPUR_E2E_PROJECT_MCP_TOKEN';
const GW_TOKEN_VAR = 'SPUR_E2E_GATEWAY_TOKEN';

interface Upstream {
    server: ReturnType<typeof Bun.serve>;
    port: number;
    seen: Array<{ tool: string; args: Record<string, unknown>; auth: string | null }>;
}

function upstream(behavior: 'ok' | 'unauthorized' | 'error' = 'ok'): Upstream {
    const seen: Upstream['seen'] = [];
    const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: async (req) => {
            const body = (await req.json()) as { params?: { name?: string; arguments?: Record<string, unknown> } };
            seen.push({
                tool: body.params?.name ?? '',
                args: body.params?.arguments ?? {},
                auth: req.headers.get('authorization'),
            });
            if (behavior === 'unauthorized') return Response.json({ error: 'unauthorized' }, { status: 401 });
            if (behavior === 'error') return Response.json({ error: 'boom' }, { status: 502 });
            return Response.json({
                jsonrpc: '2.0',
                id: 1,
                result: { content: [{ type: 'text', text: `ran ${body.params?.name ?? ''}` }] },
            });
        },
    });
    return { server, port: server.port ?? 0, seen };
}

/** A fixture project: a manifest namespace and one exposed workflow. */
function project(name: string, options: { namespace?: string; workflow?: string } = {}): string {
    const path = mkdtempSync(join(tmpdir(), `gw-route-${name}-`));
    mkdirSync(join(path, 'docs', 'tasks'), { recursive: true });
    if (options.namespace !== undefined) {
        mkdirSync(join(path, 'plugins', 'fixture'), { recursive: true });
        writeFileSync(join(path, 'plugins', 'fixture', 'plugin.json'), JSON.stringify({ name: options.namespace }));
    }
    if (options.workflow !== undefined) {
        mkdirSync(join(path, 'config', 'workflows'), { recursive: true });
        writeFileSync(
            join(path, 'config', 'workflows', `${options.workflow}.yaml`),
            [
                `name: ${options.workflow}`,
                'kind: state-machine',
                'initialState: start',
                'terminalStates: [done]',
                'metadata:',
                '  mcp:',
                '    expose: true',
                'states:',
                '  - id: start',
                '    onEnter: []',
                '  - id: done',
                '    onEnter: []',
                'transitions:',
                '  - from: start',
                '    to: done',
                '    guard: { kind: always }',
                '',
            ].join('\n'),
        );
    }
    return path;
}

async function withGateway(
    options: {
        projects: string[];
        portFor?: (path: string) => number;
        token?: string | undefined;
        mcpToken?: string;
    },
    run: (call: (method: string, params?: unknown, token?: string) => Promise<Response>) => Promise<void>,
): Promise<void> {
    const handle = startGateway({
        port: 0,
        host: '127.0.0.1',
        mcp: {
            enabled: true,
            authEnv: GW_TOKEN_VAR,
            env: { [GW_TOKEN_VAR]: options.mcpToken ?? 'gateway-token', [TOKEN_VAR]: options.token },
            projectTokenEnv: TOKEN_VAR,
        },
        deps: {
            port: 0,
            listProjects: async () =>
                options.projects.map((path) => ({ name: path.split('-').slice(-2).join('-'), path })) as never,
            ensureUpstream: async (entry) => options.portFor?.(entry.path) ?? 0,
        },
    });
    try {
        await run((method, params, token) =>
            fetch(`${handle.url}/mcp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Mcp-Protocol-Version': MIN_MCP_PROTOCOL_VERSION,
                    Authorization: `Bearer ${token ?? 'gateway-token'}`,
                },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params === undefined ? {} : { params }) }),
            }),
        );
    } finally {
        handle.stop();
        for (const path of options.projects) rmSync(path, { recursive: true, force: true });
    }
}

describe('gateway MCP routing (task 1383)', () => {
    test('tools/list aggregates the built-ins once plus each project workflow tool (R1)', async () => {
        const alpha = project('alpha', { namespace: 'alphaspace', workflow: 'deploy' });
        const beta = project('beta', { namespace: 'betaspace', workflow: 'audit' });
        await withGateway({ projects: [alpha, beta] }, async (call) => {
            const res = await call('tools/list');
            const body = (await res.json()) as { result: { tools: Array<{ name: string; inputSchema: unknown }> } };
            const names = body.result.tools.map((tool) => tool.name);
            // Built-ins exactly once, each demanding a `project` selector.
            for (const builtin of ['sp_task_show', 'sp_task_list']) {
                expect(names.filter((name) => name === builtin)).toHaveLength(1);
                const tool = body.result.tools.find((entry) => entry.name === builtin);
                if (tool === undefined) throw new Error(`built-in ${builtin} missing from tools/list`);
                expect((tool.inputSchema as { required: string[] }).required).toContain('project');
            }
            expect(names).toContain('alphaspace_deploy');
            expect(names).toContain('betaspace_audit');
        });
    });

    test('a built-in call routes by `project` and strips the selector (R3)', async () => {
        const alpha = project('alpha');
        const up = upstream();
        try {
            await withGateway({ projects: [alpha], portFor: () => up.port, token: TOKEN }, async (call) => {
                const res = await call('tools/call', {
                    name: 'sp_task_show',
                    arguments: { project: alpha.split('-').slice(-2).join('-'), wbs: '1383' },
                });
                const body = (await res.json()) as { result: { content: Array<{ text: string }> } };
                expect(body.result.content[0]?.text).toBe('ran sp_task_show');
            });
            expect(up.seen).toHaveLength(1);
            expect(up.seen[0]?.args).toEqual({ wbs: '1383' });
            expect(up.seen[0]?.auth).toBe(`Bearer ${TOKEN}`);
        } finally {
            up.server.stop(true);
        }
    });

    test('a namespaced workflow tool starts the project and forwards the call (R3)', async () => {
        const alpha = project('alpha', { namespace: 'alphaspace', workflow: 'deploy' });
        const up = upstream();
        try {
            await withGateway({ projects: [alpha], portFor: () => up.port, token: TOKEN }, async (call) => {
                const res = await call('tools/call', { name: 'alphaspace_deploy', arguments: { env: 'prod' } });
                expect(res.status).toBe(200);
            });
            expect(up.seen[0]?.tool).toBe('alphaspace_deploy');
            expect(up.seen[0]?.args).toEqual({ env: 'prod' });
        } finally {
            up.server.stop(true);
        }
    });

    test('a namespace claimed twice is withheld, reported, and refused (R2)', async () => {
        const one = project('one', { namespace: 'sharedspace', workflow: 'deploy' });
        const two = project('two', { namespace: 'sharedspace', workflow: 'audit' });
        await withGateway({ projects: [one, two], token: TOKEN }, async (call) => {
            const list = (await (await call('tools/list')).json()) as { result: { tools: Array<{ name: string }> } };
            expect(list.result.tools.map((tool) => tool.name)).not.toContain('sharedspace_deploy');

            const discover = (await (await call('server/discover')).json()) as {
                result: { diagnostics: Array<{ reason: string; remedy: string }> };
            };
            const collision = discover.result.diagnostics.find((entry) => entry.reason === 'namespace-collision');
            expect(collision?.remedy).toContain('sharedspace');

            const refused = await call('tools/call', { name: 'sharedspace_deploy', arguments: {} });
            const body = (await refused.json()) as { error: { message: string } };
            expect(body.error.message).toContain('namespace');
        });
    });

    test('refusals name the cause: unknown project, missing token, upstream 401 and 5xx (R5)', async () => {
        const alpha = project('alpha');
        const name = alpha.split('-').slice(-2).join('-');

        await withGateway({ projects: [alpha], token: TOKEN }, async (call) => {
            const unknown = await call('tools/call', {
                name: 'sp_task_show',
                arguments: { project: 'nope', wbs: '1' },
            });
            expect(((await unknown.json()) as { error: { message: string } }).error.message).toContain(
                'unknown project',
            );
        });

        const up = upstream();
        try {
            await withGateway({ projects: [alpha], portFor: () => up.port, token: undefined }, async (call) => {
                const missing = await call('tools/call', {
                    name: 'sp_task_show',
                    arguments: { project: name, wbs: '1' },
                });
                const message = ((await missing.json()) as { error: { message: string } }).error.message;
                expect(message).toContain('no project MCP token');
            });
        } finally {
            up.server.stop(true);
        }

        for (const [behavior, needle] of [
            ['unauthorized', '401'],
            ['error', '502'],
        ] as const) {
            const failing = upstream(behavior);
            try {
                await withGateway({ projects: [alpha], portFor: () => failing.port, token: TOKEN }, async (call) => {
                    const res = await call('tools/call', {
                        name: 'sp_task_show',
                        arguments: { project: name, wbs: '1' },
                    });
                    const message = ((await res.json()) as { error: { message: string } }).error.message;
                    expect(message).toContain(needle);
                    // The token value never appears in an error message.
                    expect(message).not.toContain(TOKEN);
                });
            } finally {
                failing.server.stop(true);
            }
        }
    });
});
