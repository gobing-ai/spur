import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGatewayHandler, type McpGatewayRegistry, type McpGatewayTool } from '../../src/services/project-gateway';

/**
 * Task 1383 at the owning layer: the gateway's MCP route table, resolution rules and refusals.
 * Driven through the handler the server actually mounts (`deps.mcp` receives the registry), with a
 * stub upstream — the wire shape is proven in `apps/server/tests/gateway-mcp-routing.test.ts`.
 */
const TOKEN = 'project-token';

function project(name: string, options: { namespace?: string; workflow?: string } = {}): string {
    const path = mkdtempSync(join(tmpdir(), `pg-${name}-`));
    mkdirSync(join(path, 'docs', 'tasks'), { recursive: true });
    if (options.namespace !== undefined) {
        mkdirSync(join(path, 'plugins', 'fixture'), { recursive: true });
        writeFileSync(join(path, 'plugins', 'fixture', 'plugin.json'), JSON.stringify({ name: options.namespace }));
    }
    if (options.workflow !== undefined) {
        mkdirSync(join(path, '.spur', 'workflows'), { recursive: true });
        writeFileSync(
            join(path, '.spur', 'workflows', `${options.workflow}.yaml`),
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

interface Harness {
    handler: (req: Request) => Promise<Response>;
    /** Set the first time the handler reaches `deps.mcp` — that call hands it the registry. */
    holder: { registry?: McpGatewayRegistry };
    calls: Array<{ url: string; body: unknown; headers: Record<string, string> }>;
    dispose(): void;
}

const BUILTINS: McpGatewayTool[] = [
    {
        name: 'sp_task_show',
        description: 'show',
        inputSchema: { type: 'object', properties: { wbs: { type: 'string' } }, required: ['wbs'] },
    },
];

interface BuildOptions {
    token?: string | undefined;
    upstream?: (url: string) => Response;
    fetchThrows?: boolean;
}

/** Build the real handler; `deps.mcp` captures the registry and forwards to `run`. */
function build(paths: string[], options: BuildOptions = {}, run: (registry: McpGatewayRegistry) => Promise<Response>) {
    const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
    const holder: { registry?: McpGatewayRegistry } = {};
    const handler = createGatewayHandler({
        listProjects: async () => paths.map((path) => ({ name: path.split('-').slice(-2).join('-'), path })) as never,
        ensureUpstream: async () => 4000,
        port: 3000,
        builtinTools: () => BUILTINS,
        // `undefined` in the options means "no token configured", not "use the default".
        projectMcpToken: () => ('token' in options ? options.token : TOKEN),
        mcpProtocolVersion: '2026-08-01',
        fetchUpstream: (async (url: string, init: RequestInit) => {
            calls.push({
                url: String(url),
                body: JSON.parse(String(init.body)),
                headers: init.headers as Record<string, string>,
            });
            if (options.fetchThrows === true) throw new Error('connection refused');
            return options.upstream?.(String(url)) ?? Response.json({ jsonrpc: '2.0', result: { ok: true } });
        }) as unknown as typeof fetch,
        mcp: async (_req, registry) => {
            holder.registry = registry;
            return run(registry);
        },
    });
    const dispose = () => {
        for (const path of paths) rmSync(path, { recursive: true, force: true });
    };
    return { handler, holder, calls, dispose };
}

/** Capture the registry once, then drive it directly. */
async function captured(
    paths: string[],
    options: BuildOptions = {},
): Promise<{ registry: McpGatewayRegistry; calls: Harness['calls']; dispose(): void }> {
    const built = build(paths, options, async () => Response.json({ ok: true }));
    await built.handler(new Request('http://localhost/mcp', { method: 'POST', body: '{}' }));
    if (built.holder.registry === undefined) throw new Error('registry not captured');
    return { registry: built.holder.registry, calls: built.calls, dispose: built.dispose };
}

describe('gateway MCP registry (task 1383)', () => {
    it('lists the built-ins once with a required project, plus each project workflow tool', async () => {
        const alpha = project('alpha', { namespace: 'alphaspace', workflow: 'deploy' });
        const h = await captured([alpha]);
        try {
            const tools = await h.registry.listTools();
            const builtin = tools.filter((tool) => tool.name === 'sp_task_show');
            expect(builtin).toHaveLength(1);
            const schema = builtin[0]?.inputSchema as { required: string[]; properties: Record<string, unknown> };
            expect(schema.required).toEqual(['project', 'wbs']);
            expect(schema.properties.project).toBeDefined();
            expect(tools.map((tool) => tool.name)).toContain('alphaspace_deploy');
        } finally {
            h.dispose();
        }
    });

    it('withholds a colliding namespace and reports it as a diagnostic', async () => {
        const one = project('one', { namespace: 'taken', workflow: 'deploy' });
        const two = project('two', { namespace: 'taken', workflow: 'audit' });
        const h = await captured([one, two]);
        try {
            const names = (await h.registry.listTools()).map((tool) => tool.name);
            expect(names).not.toContain('taken_deploy');
            const extras = await h.registry.discoverExtras();
            const diagnostics = extras.diagnostics as Array<{ reason: string; remedy: string }>;
            expect(diagnostics.some((entry) => entry.reason === 'namespace-collision')).toBe(true);
            await expect(h.registry.callTool('taken_deploy', {})).rejects.toThrow(/namespace/);
        } finally {
            h.dispose();
        }
    });

    it('routes a built-in by project, strips the selector, and forwards the token and version', async () => {
        const alpha = project('alpha');
        const name = alpha.split('-').slice(-2).join('-');
        const h = await captured([alpha]);
        try {
            const handler = createGatewayHandler({
                listProjects: async () => [{ name, path: alpha }] as never,
                ensureUpstream: async () => 4000,
                port: 3000,
                builtinTools: () => BUILTINS,
                projectMcpToken: () => TOKEN,
                mcpProtocolVersion: '2026-08-01',
                fetchUpstream: (async (url: string, init: RequestInit) => {
                    h.calls.push({
                        url: String(url),
                        body: JSON.parse(String(init.body)),
                        headers: init.headers as Record<string, string>,
                    });
                    return Response.json({ jsonrpc: '2.0', result: { ok: true } });
                }) as unknown as typeof fetch,
                mcp: async (_req, registry) => {
                    await registry.callTool('sp_task_show', { project: name, wbs: '1383' });
                    return Response.json({ ok: true });
                },
            });
            await handler(new Request('http://localhost/mcp', { method: 'POST', body: '{}' }));
            expect(h.calls[0]?.url).toContain('/mcp');
            const forwarded = h.calls[0]?.body as { params?: { arguments?: unknown } } | undefined;
            expect(forwarded?.params?.arguments).toEqual({ wbs: '1383' });
            expect(h.calls[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
            expect(h.calls[0]?.headers['mcp-protocol-version']).toBe('2026-08-01');
        } finally {
            h.dispose();
        }
    });

    it('refuses unknown and ambiguous projects, a missing token, and upstream failures', async () => {
        const alpha = project('alpha');
        const name = alpha.split('-').slice(-2).join('-');
        const h = await captured([alpha]);
        try {
            await expect(h.registry.callTool('sp_task_show', {})).rejects.toThrow(/needs a "project" argument/);
            await expect(h.registry.callTool('sp_task_show', { project: 'ghost' })).rejects.toThrow(/unknown project/);
            await expect(h.registry.callTool('unknown_tool', {})).rejects.toThrow(/unknown tool/);
            await expect(h.registry.readResource('spur://x')).rejects.toThrow(/no resources/);
            expect(await h.registry.listResources()).toEqual([]);
            expect(h.registry.namespace()).toBeNull();
            void name;
        } finally {
            h.dispose();
        }
    });

    it('names the missing token instead of forwarding an unauthenticated call', async () => {
        const beta = project('beta');
        const name = beta.split('-').slice(-2).join('-');
        const h = await captured([beta], { token: undefined });
        try {
            await expect(h.registry.callTool('sp_task_show', { project: name })).rejects.toThrow(
                /no project MCP token/,
            );
        } finally {
            h.dispose();
        }
    });

    it('maps an upstream 401 and a 5xx to distinct, token-free errors', async () => {
        const gamma = project('gamma');
        const name = gamma.split('-').slice(-2).join('-');
        for (const [status, needle] of [
            [401, '401'],
            [502, '502'],
        ] as const) {
            const calls: unknown[] = [];
            const h = await captured([gamma]);
            try {
                const handler = createGatewayHandler({
                    listProjects: async () => [{ name, path: gamma }] as never,
                    ensureUpstream: async () => 4000,
                    port: 3000,
                    builtinTools: () => BUILTINS,
                    projectMcpToken: () => TOKEN,
                    fetchUpstream: (async () => Response.json({ error: 'x' }, { status })) as unknown as typeof fetch,
                    mcp: async (_req, registry) => {
                        try {
                            await registry.callTool('sp_task_show', { project: name });
                        } catch (err) {
                            calls.push(err instanceof Error ? err.message : String(err));
                        }
                        return Response.json({ ok: true });
                    },
                });
                await handler(new Request('http://localhost/mcp', { method: 'POST', body: '{}' }));
                const message = String(calls[0]);
                expect(message).toContain(needle);
                expect(message).not.toContain(TOKEN);
            } finally {
                h.dispose();
            }
        }
    });

    it('reports remote entries in discover diagnostics and never lists them', async () => {
        const local = project('local');
        const remoteProject = project('remote', { namespace: 'remoteys' });
        const handler = createGatewayHandler({
            listProjects: async () =>
                [
                    { name: local.split('-').slice(-2).join('-'), path: local },
                    { name: 'remote-host', path: remoteProject, host: 'remote.example.test' },
                ] as never,
            ensureUpstream: async () => 4000,
            port: 3000,
            builtinTools: () => BUILTINS,
            mcp: async (_req, registry) => {
                const extras = await registry.discoverExtras();
                return Response.json(extras);
            },
        });
        try {
            const res = await handler(new Request('http://localhost/mcp', { method: 'POST', body: '{}' }));
            const body = (await res.json()) as {
                projects: Array<{ name: string }>;
                diagnostics: Array<{ name: string; reason: string }>;
            };
            expect(body.projects.some((entry) => entry.name === 'remote-host')).toBe(false);
            expect(body.diagnostics.some((entry) => entry.reason.includes('remote-not-proxied'))).toBe(true);
        } finally {
            rmSync(local, { recursive: true, force: true });
            rmSync(remoteProject, { recursive: true, force: true });
        }
    });
});

// ─── 1442 R1/R2: the root page reports the current MCP and routing snapshot ─────────────────
describe('1442 — gateway root page', () => {
    /** Drive the handler and return the root page's HTML plus the recorded request counters. */
    async function rootPage(
        entries: Array<{ name: string; path: string; host?: string }>,
        options: { mcp?: boolean } = {},
    ): Promise<{ html: string; status: number; registryReads: number }> {
        const built = build(
            entries.map((entry) => entry.path),
            {},
            async () => Response.json({ ok: true }),
        );
        let registryReads = 0;
        const handler = createGatewayHandler({
            listProjects: async () => {
                registryReads += 1;
                return entries as never;
            },
            ensureUpstream: async () => 4000,
            port: 3000,
            builtinTools: () => BUILTINS,
            projectMcpToken: () => TOKEN,
            mcpAuth: { envName: 'SPUR_MCP_TOKEN', tokenPresent: true },
            mcpProtocolVersion: '2026-08-01',
            fetchUpstream: (async () => Response.json({ ok: true })) as unknown as typeof fetch,
            ...(options.mcp === false ? {} : { mcp: async () => Response.json({ ok: true }) }),
        });
        // Two recorded failures, so the counters are not all zero in the assertion.
        await handler(new Request('http://localhost/does-not-exist'));
        await handler(new Request('http://localhost/also-missing'));
        registryReads = 0;
        const res = await handler(new Request('http://localhost/'));
        built.dispose();
        return { html: await res.text(), status: res.status, registryReads };
    }

    it('shows the MCP state, credential presence, namespaces, diagnostics and counters', async () => {
        const one = project('one', { namespace: 'taken', workflow: 'deploy' });
        const two = project('two', { namespace: 'taken', workflow: 'audit' });
        try {
            const { html, status, registryReads } = await rootPage([
                { name: 'one', path: one },
                { name: 'two', path: two },
                { name: 'remote-box', path: '/srv/remote', host: '192.168.1.50' },
            ]);
            expect(status).toBe(200);
            expect(registryReads).toBe(1);
            expect(html).toContain('data-gateway-mcp="on"');
            expect(html).toContain('SPUR_MCP_TOKEN');
            expect(html).toContain('set');
            // Both colliding projects are listed, and the collision is explained.
            expect(html).toContain('data-gateway-namespace="one"');
            expect(html).toContain('data-gateway-namespace="two"');
            expect(html).toContain('data-gateway-diagnostic="namespace-collision"');
            expect(html).toContain('data-gateway-diagnostic="remote-not-proxied (ADR-151)"');
            expect(html).toContain('data-gateway-routing="errors">2 / 0<');
            // The credential VALUE never reaches the page.
            expect(html).not.toContain(TOKEN);
            // The page is still the ordinary index: cards and the removal action survive.
            expect(html).toContain('class="project-grid"');
            expect(html).toContain(`data-path="${one}"`);
        } finally {
            rmSync(one, { recursive: true, force: true });
            rmSync(two, { recursive: true, force: true });
        }
    });

    it('keeps an operable index with MCP off, and with discovery unavailable', async () => {
        const alpha = project('alpha', { namespace: 'alphaspace', workflow: 'deploy' });
        try {
            const off = await rootPage([{ name: 'alpha', path: alpha }], { mcp: false });
            expect(off.status).toBe(200);
            expect(off.html).toContain('data-gateway-mcp="off"');
            expect(off.html).not.toContain('data-gateway-namespaces');
            expect(off.html).toContain('class="project-grid"');
            expect(off.html).toContain('data-gateway-routing="requests"');
        } finally {
            rmSync(alpha, { recursive: true, force: true });
        }
    });

    it('renders the unavailable state when the discovery resolver throws', async () => {
        const beta = project('beta', { namespace: 'betaspace', workflow: 'deploy' });
        const handler = createGatewayHandler({
            listProjects: async () => [{ name: 'beta', path: beta }] as never,
            loadProjectConfig: async () => {
                throw new Error('project config unreadable');
            },
            ensureUpstream: async () => 4000,
            port: 3000,
            builtinTools: () => BUILTINS,
            projectMcpToken: () => TOKEN,
            mcpAuth: { envName: 'SPUR_MCP_TOKEN', tokenPresent: true },
            mcpProtocolVersion: '2026-08-01',
            fetchUpstream: (async () => Response.json({ ok: true })) as unknown as typeof fetch,
            mcp: async () => Response.json({ ok: true }),
        });
        const res = await handler(new Request('http://localhost/'));
        const html = await res.text();
        expect(res.status).toBe(200);
        // The failure is reported, never rendered as internal exception text.
        expect(html).toContain('data-gateway-discovery="unavailable"');
        expect(html).not.toContain('project config unreadable');
        // The rest of the page is untouched.
        expect(html).toContain('class="project-grid"');
        expect(html).toContain('data-gateway-routing="requests"');
        expect(html).toContain('data-gateway-mcp="on"');
        rmSync(beta, { recursive: true, force: true });
    });
});
