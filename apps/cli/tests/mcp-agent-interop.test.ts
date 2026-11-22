import { afterEach, expect, test } from 'bun:test';
import { AGENTS, classify, runCodexClient, startProxy } from '../../../scripts/commands/mcp-agent-interop';

// Failure modes: merged Codex config rejects HTTP; JSON env is invalid TOML; the proxy drops
// routing headers; a JSON-RPC/tool error or the wrong tool is falsely certified as a pass.
const servers: Array<{ stop: (closeActiveConnections?: boolean) => void }> = [];

test('pi trusts only the generated project for this run and OpenClaw runs locally without delivery', () => {
    expect(AGENTS.find((agent) => agent.id === 'pi')?.runArgs('probe', {})).toContain('--approve');
    const args = AGENTS.find((agent) => agent.id === 'openclaw')?.runArgs('probe', {}) ?? [];
    expect(args[0]).toBe('agent');
    expect(args).toContain('--local');
    expect(args).not.toContain('--deliver');
    const config = AGENTS.find((agent) => agent.id === 'openclaw')?.config(
        'stdio',
        { url: 'http://localhost/mcp', stdio: ['bun', 'cli.ts'] },
        '/tmp/probe',
    );
    if (config && !('unavailable' in config)) {
        const file = JSON.parse(config.files?.['/tmp/probe/openclaw-stdio.json'] ?? '{}');
        expect(file.mcp.servers.spur.command).toBe('bun');
        expect(file.mcp.servers.spur.args).toEqual(['cli.ts']);
    }
});

test('Grok uses native project-scoped TOML for both transports', () => {
    const grok = AGENTS.find((agent) => agent.id === 'grok');
    for (const transport of ['http', 'stdio'] as const) {
        const config = grok?.config(
            transport,
            { url: 'http://localhost:1234/mcp', stdio: ['bun', 'cli.ts'] },
            '/tmp/probe',
        );
        expect(config).not.toHaveProperty('unavailable');
        if (!config || 'unavailable' in config) continue;
        const toml = config.files?.['/tmp/probe/.grok/config.toml'] ?? '';
        const entry = (Bun.TOML.parse(toml) as { mcp_servers: { spur: Record<string, unknown> } }).mcp_servers.spur;
        expect(entry[transport === 'http' ? 'url' : 'command']).toBe(
            transport === 'http' ? 'http://localhost:1234/mcp' : 'bun',
        );
    }
});

test('the Codex client driver lists the thread catalog and invokes the read-only tool', async () => {
    const fixture = `const lines = require('node:readline').createInterface({input:process.stdin});
    lines.on('line', line => {const m=JSON.parse(line);if(!m.id)return;
    const result=m.method==='thread/start'?{thread:{id:'fixture'}}:
    m.method==='mcpServerStatus/list'?{data:[{tools:{sp_task_list:{}}}]}:
    m.method==='mcpServer/tool/call'?{content:[{type:'text',text:'[]'}]}:{};
    console.log(JSON.stringify({id:m.id,result}));});`;
    expect(await runCodexClient([process.execPath, '-e', fixture], '/tmp', {})).toContain('sp_task_list');
});

test('the Codex client driver rejects a protocol error rather than calling it a pass', async () => {
    const fixture = `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
    const m=JSON.parse(line);console.log(JSON.stringify({id:m.id,error:{message:'startup refused'}}));});`;
    await expect(runCodexClient([process.execPath, '-e', fixture], '/tmp', {})).rejects.toThrow('startup refused');
});
afterEach(() => {
    for (const server of servers.splice(0)) server.stop(true);
});

test('the proxy does not forward stale compression headers after decoding the upstream body', async () => {
    const upstream = Bun.serve({
        port: 0,
        fetch: () =>
            new Response(Bun.gzipSync(JSON.stringify({ tools: [] })), {
                headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
            }),
    });
    servers.push(upstream);
    const proxy = startProxy(`http://127.0.0.1:${upstream.port}`, []);
    servers.push(proxy);
    const response = await fetch(`http://127.0.0.1:${proxy.port}/mcp`, {
        method: 'POST',
        body: '{"method":"tools/list"}',
    });
    expect(await response.json()).toEqual({ tools: [] });
});

test('the proxy preserves the HTTP method rather than fabricating a POST for legacy GET', async () => {
    const upstream = Bun.serve({ port: 0, fetch: (request) => new Response(request.method, { status: 405 }) });
    servers.push(upstream);
    const proxy = startProxy(`http://127.0.0.1:${upstream.port}`, []);
    servers.push(proxy);
    const response = await fetch(`http://127.0.0.1:${proxy.port}/mcp`);
    expect(await response.text()).toBe('GET');
});

test('Codex supports isolated HTTP and stdio configurations with valid TOML overrides', () => {
    const codex = AGENTS.find((agent) => agent.id === 'codex');
    expect(codex).toBeDefined();
    for (const transport of ['http', 'stdio'] as const) {
        const config = codex?.config(
            transport,
            { url: 'http://127.0.0.1:1234/mcp', stdio: ['bun', 'cli.ts', 'mcp'] },
            '/tmp',
        );
        expect(config).not.toHaveProperty('unavailable');
        if (!config || 'unavailable' in config) continue;
        const args = codex?.runArgs('list and call sp_task_list', config.runVars ?? {}) ?? [];
        const override = args[args.indexOf('-c') + 1] ?? '';
        const parsed = Bun.TOML.parse(override) as { mcp_servers: { spur_interop: Record<string, unknown> } };
        const entry = parsed.mcp_servers.spur_interop;
        if (transport === 'http') expect(entry.url).toBe('http://127.0.0.1:1234/mcp');
        else expect(entry.env).toHaveProperty('SPUR_MCP_AUTH_ENV', 'SPUR_MCP_TOKEN');
    }
});

test('the recording proxy preserves MCP header routing and protocol error codes', async () => {
    const upstream = Bun.serve({
        port: 0,
        fetch(request) {
            expect(request.headers.get('Mcp-Method')).toBe('tools/call');
            expect(request.headers.get('Mcp-Name')).toBe('sp_task_list');
            return Response.json(
                { error: { code: -32000, errorCode: 'PROTOCOL_VERSION_UNSUPPORTED' } },
                { status: 400 },
            );
        },
    });
    servers.push(upstream);
    const log: Parameters<typeof classify>[0] = [];
    const proxy = startProxy(`http://127.0.0.1:${upstream.port}`, log);
    servers.push(proxy);
    const response = await fetch(`http://127.0.0.1:${proxy.port}/mcp`, {
        method: 'POST',
        headers: { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'sp_task_list' },
        body: JSON.stringify({ params: { protocolVersion: '2025-06-18' } }),
    });
    expect(response.status).toBe(400);
    expect(log[0]?.errorCode).toBe('PROTOCOL_VERSION_UNSUPPORTED');
    expect(log[0]?.requestedRevision).toBe('2025-06-18');
    expect(classify(log, 0, false).classification).toBe('rejected-legacy-revision');
});

test('HTTP 200 with a tool error or a different tool cannot pass interoperability', async () => {
    for (const result of [{ isError: true, content: [] }, { error: { code: -32603, message: 'failure' } }]) {
        const upstream = Bun.serve({ port: 0, fetch: () => Response.json(result) });
        servers.push(upstream);
        const log: Parameters<typeof classify>[0] = [];
        const proxy = startProxy(`http://127.0.0.1:${upstream.port}`, log);
        servers.push(proxy);
        await fetch(`http://127.0.0.1:${proxy.port}/mcp`, {
            method: 'POST',
            body: JSON.stringify({ method: 'tools/call', params: { name: 'sp_task_list' } }),
        });
        expect(classify(log, 0, false).classification).not.toBe('pass');
    }
});

test('a successful list plus sp_task_list call reports the actual tool count', async () => {
    const upstream = Bun.serve({
        port: 0,
        async fetch(request) {
            const body = (await request.json()) as { method: string };
            return Response.json(
                body.method === 'tools/list'
                    ? { tools: [{ name: 'sp_task_list' }, { name: 'sp_task_show' }] }
                    : { content: [{ type: 'text', text: '[]' }] },
            );
        },
    });
    servers.push(upstream);
    const log: Parameters<typeof classify>[0] = [];
    const proxy = startProxy(`http://127.0.0.1:${upstream.port}`, log);
    servers.push(proxy);
    for (const method of ['tools/list', 'tools/call']) {
        await fetch(`http://127.0.0.1:${proxy.port}/mcp`, {
            method: 'POST',
            body: JSON.stringify({ method, params: { name: 'sp_task_list' } }),
        });
    }
    expect(log[0]?.toolCount).toBe(2);
    expect(classify(log, 0, false).classification).toBe('pass');
    expect(
        classify(
            log.map((row) => ({ ...row, toolName: 'sp_other' })),
            0,
            false,
        ).classification,
    ).not.toBe('pass');
});
