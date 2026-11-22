/**
 * B9 task 1371 — the stateless MCP 2.0+ Streamable HTTP protocol adapter.
 *
 * The failure modes come first: a missing or legacy `Mcp-Protocol-Version`, the stateful
 * GET/session transport sneaking back in, a body that is not JSON, an unknown method, a
 * `tools/call` without a target, a registry that throws — then the JSON / request-scoped SSE
 * split and the JSON-RPC envelope mirroring.
 */
import { describe, expect, test } from 'bun:test';
import {
    handleMcpHttpRequest,
    type McpHandlerRegistry,
    type McpResourceDescriptor,
    type McpToolDescriptor,
    MIN_MCP_PROTOCOL_VERSION,
} from '../../../src/modules/mcp/protocol';

const VERSION = MIN_MCP_PROTOCOL_VERSION;

/** Deterministic registry fixture; per-test overrides keep each failure mode isolated. */
function registry(overrides: Partial<McpHandlerRegistry> = {}): McpHandlerRegistry {
    return {
        listTools: async (): Promise<McpToolDescriptor[]> => [
            { name: 'sp_task_show', description: 'Show one task', inputSchema: { type: 'object' } },
        ],
        callTool: async (name: string, args: Record<string, unknown>) => ({ tool: name, args }),
        listResources: async (): Promise<McpResourceDescriptor[]> => [{ uri: 'spur://tasks/1371', name: 'task 1371' }],
        readResource: async (uri: string) => ({ uri, text: `contents of ${uri}` }),
        namespace: () => null,
        ...overrides,
    };
}

async function post(
    reg: McpHandlerRegistry,
    init: { headers?: Record<string, string>; body?: unknown; raw?: string; method?: string } = {},
): Promise<Response> {
    return handleMcpHttpRequest(
        new Request('http://localhost/mcp', {
            method: init.method ?? 'POST',
            headers: { 'Mcp-Protocol-Version': VERSION, ...(init.headers ?? {}) },
            body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
        }),
        reg,
    );
}

function errorOf(body: unknown): { code: string; message: string } {
    return (body as { error: { code: string; message: string } }).error;
}

async function jsonOf(res: Response): Promise<unknown> {
    expect(res.headers.get('Content-Type')).toContain('application/json');
    return (await res.json()) as unknown;
}

describe('protocol version gate (R3 / AC1)', () => {
    test('a request without Mcp-Protocol-Version is refused, naming the header', async () => {
        const res = await post(registry(), { headers: { 'Mcp-Protocol-Version': '' } });
        expect(res.status).toBe(400);
        const error = errorOf(await jsonOf(res));
        expect(error.code).toBe('PROTOCOL_VERSION_UNSUPPORTED');
        expect(error.message).toContain('Mcp-Protocol-Version');
    });

    for (const legacy of ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']) {
        test(`rejects legacy ${legacy} instead of negotiating`, async () => {
            const res = await post(registry(), { headers: { 'Mcp-Protocol-Version': legacy } });
            expect(res.status).toBe(400);
            const error = errorOf(await jsonOf(res));
            expect(error.code).toBe('PROTOCOL_VERSION_UNSUPPORTED');
            expect(error.message).toContain(VERSION);
        });
    }

    test('every rejection names the accepted floor AND the stdio bridge fallback (B93 1431 R2)', async () => {
        for (const headers of [
            { 'Mcp-Protocol-Version': '' },
            { 'Mcp-Protocol-Version': 'not-a-date' },
            { 'Mcp-Protocol-Version': '2024-11-05' },
        ]) {
            const error = errorOf(await jsonOf(await post(registry(), { headers })));
            expect(error.code).toBe('PROTOCOL_VERSION_UNSUPPORTED');
            expect(error.message).toContain('2026-07-28');
            expect(error.message).toContain('spur mcp');
        }
    });

    test('a header-less legacy initialize body gets the same actionable message (B93 1431 R2)', async () => {
        const res = await post(registry(), {
            headers: { 'Mcp-Protocol-Version': '' },
            body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
        });
        expect(res.status).toBe(400);
        const error = errorOf(await jsonOf(res));
        expect(error.code).toBe('PROTOCOL_VERSION_UNSUPPORTED');
        expect(error.message).toContain('initialize');
        expect(error.message).toContain('2026-07-28');
        expect(error.message).toContain('spur mcp');
    });

    test('rejects a malformed version string', async () => {
        const res = await post(registry(), { headers: { 'Mcp-Protocol-Version': 'not-a-date' } });
        expect(res.status).toBe(400);
        expect(errorOf(await jsonOf(res)).code).toBe('PROTOCOL_VERSION_UNSUPPORTED');
    });

    test('accepts a newer future version, not just the minimum', async () => {
        const res = await post(registry(), {
            headers: { 'Mcp-Protocol-Version': '2027-01-01', 'Mcp-Method': 'server/discover' },
        });
        expect(res.status).toBe(200);
    });
});

describe('stateless transport gate (R3)', () => {
    test('GET /mcp — the legacy SSE stream endpoint — is a 405 with Allow: POST', async () => {
        const res = await post(registry(), { method: 'GET' });
        expect(res.status).toBe(405);
        expect(res.headers.get('Allow')).toBe('POST');
        expect(errorOf(await jsonOf(res)).code).toBe('STATEFUL_TRANSPORT_UNSUPPORTED');
    });

    test('a sticky Mcp-Session-Id is refused: MCP 2.0+ is stateless', async () => {
        const res = await post(registry(), { headers: { 'Mcp-Session-Id': 's-123' } });
        expect(res.status).toBe(400);
        expect(errorOf(await jsonOf(res)).code).toBe('SESSIONS_UNSUPPORTED');
    });
});

describe('stateless dispatch on valid 2026-07-28+ calls', () => {
    test('server/discover reports the negotiated version and both capabilities', async () => {
        const res = await post(registry(), { headers: { 'Mcp-Method': 'server/discover' }, body: {} });
        expect(res.status).toBe(200);
        const body = (await jsonOf(res)) as {
            protocolVersion: string;
            capabilities: { tools: McpToolDescriptor[]; resources: McpResourceDescriptor[] };
        };
        expect(body.protocolVersion).toBe(VERSION);
        expect(body.capabilities.tools[0]?.name).toBe('sp_task_show');
        expect(body.capabilities.resources[0]?.uri).toBe('spur://tasks/1371');
    });

    test('server/discover with an empty body needs no params', async () => {
        const res = await post(registry(), { headers: { 'Mcp-Method': 'server/discover' } });
        expect(res.status).toBe(200);
    });

    test('server/discover omits namespace when null and includes it when set', async () => {
        const omittedRes = await post(registry({ namespace: () => null }), {
            headers: { 'Mcp-Method': 'server/discover' },
        });
        const omittedBody = (await jsonOf(omittedRes)) as Record<string, unknown>;
        expect('namespace' in omittedBody).toBe(false);

        const setRes = await post(registry({ namespace: () => 'sp' }), {
            headers: { 'Mcp-Method': 'server/discover' },
        });
        const setBody = (await jsonOf(setRes)) as Record<string, unknown>;
        expect(setBody.namespace).toBe('sp');
    });

    test('tools/list returns the registry tools', async () => {
        const res = await post(registry(), { headers: { 'Mcp-Method': 'tools/list' } });
        expect(res.status).toBe(200);
        const body = (await jsonOf(res)) as { tools: McpToolDescriptor[] };
        expect(body.tools[0]?.name).toBe('sp_task_show');
    });

    test('tools/call resolves the tool from the Mcp-Name header and passes arguments', async () => {
        const calls: { name: string; args: Record<string, unknown> }[] = [];
        const reg = registry({
            callTool: async (name, args) => {
                calls.push({ name, args });
                return { ok: true };
            },
        });
        const res = await post(reg, {
            headers: { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'sp_task_show' },
            body: { arguments: { wbs: '1371' } },
        });
        expect(res.status).toBe(200);
        expect(calls).toEqual([{ name: 'sp_task_show', args: { wbs: '1371' } }]);
    });

    test('tools/call via a JSON-RPC envelope mirrors the envelope and echoes the id', async () => {
        const res = await post(registry(), {
            body: {
                jsonrpc: '2.0',
                id: 7,
                method: 'tools/call',
                params: { name: 'sp_task_show', arguments: { wbs: '1371' } },
            },
        });
        expect(res.status).toBe(200);
        const body = (await jsonOf(res)) as { jsonrpc: string; id: unknown; result: { tool: string; args: unknown } };
        expect(body.jsonrpc).toBe('2.0');
        expect(body.id).toBe(7);
        expect(body.result.tool).toBe('sp_task_show');
    });

    test('tools/call without arguments still calls the tool with an empty object', async () => {
        const calls: { name: string; args: Record<string, unknown> }[] = [];
        const reg = registry({
            callTool: async (name, args) => {
                calls.push({ name, args });
                return 'ok';
            },
        });
        const res = await post(reg, { headers: { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'sp_task_show' } });
        expect(res.status).toBe(200);
        expect(calls).toEqual([{ name: 'sp_task_show', args: {} }]);
    });

    test('resources/list returns the registry resources', async () => {
        const res = await post(registry(), { headers: { 'Mcp-Method': 'resources/list' } });
        expect(res.status).toBe(200);
        const body = (await jsonOf(res)) as { resources: McpResourceDescriptor[] };
        expect(body.resources[0]?.uri).toBe('spur://tasks/1371');
    });

    test('resources/read resolves the URI from the Mcp-Name header', async () => {
        const reads: string[] = [];
        const reg = registry({
            readResource: async (uri) => {
                reads.push(uri);
                return { uri };
            },
        });
        const res = await post(reg, { headers: { 'Mcp-Method': 'resources/read', 'Mcp-Name': 'spur://tasks/1371' } });
        expect(res.status).toBe(200);
        expect(reads).toEqual(['spur://tasks/1371']);
    });

    test('an unknown method is METHOD_NOT_FOUND with the supported set named', async () => {
        const res = await post(registry(), { headers: { 'Mcp-Method': 'sampling/create' } });
        expect(res.status).toBe(404);
        const error = errorOf(await jsonOf(res));
        expect(error.code).toBe('METHOD_NOT_FOUND');
        expect(error.message).toContain('server/discover');
    });

    test('an unknown JSON-RPC method gets the -32601 rpc code', async () => {
        const res = await post(registry(), { body: { jsonrpc: '2.0', id: 1, method: 'initialize' } });
        expect(res.status).toBe(404);
        const body = (await jsonOf(res)) as { error: { code: number; message: string } };
        expect(body.error.code).toBe(-32601);
        expect(body.error.message).toContain('initialize');
    });
});

describe('request validation', () => {
    test('a body that is not JSON is INVALID_REQUEST', async () => {
        const res = await post(registry(), { raw: '{oops', headers: { 'Mcp-Method': 'server/discover' } });
        expect(res.status).toBe(400);
        expect(errorOf(await jsonOf(res)).code).toBe('INVALID_REQUEST');
    });

    test('a request with no method anywhere is INVALID_REQUEST', async () => {
        const res = await post(registry(), { body: { arguments: {} } });
        expect(res.status).toBe(400);
        expect(errorOf(await jsonOf(res)).code).toBe('INVALID_REQUEST');
    });

    test('tools/call without a tool name is INVALID_PARAMS and never reaches the registry', async () => {
        const calls: unknown[] = [];
        const reg = registry({
            callTool: async () => {
                calls.push('x');
                return null;
            },
        });
        const res = await post(reg, { headers: { 'Mcp-Method': 'tools/call' } });
        expect(res.status).toBe(400);
        expect(errorOf(await jsonOf(res)).code).toBe('INVALID_PARAMS');
        expect(calls).toEqual([]);
    });

    test('resources/read without a URI is INVALID_PARAMS', async () => {
        const res = await post(registry(), { headers: { 'Mcp-Method': 'resources/read' } });
        expect(res.status).toBe(400);
        expect(errorOf(await jsonOf(res)).code).toBe('INVALID_PARAMS');
    });

    test('a registry rejection becomes INTERNAL_ERROR, not a crash', async () => {
        const reg = registry({ callTool: async () => Promise.reject(new Error('boom')) });
        const res = await post(reg, { headers: { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'sp_task_show' } });
        expect(res.status).toBe(500);
        const error = errorOf(await jsonOf(res));
        expect(error.code).toBe('INTERNAL_ERROR');
        expect(error.message).toContain('boom');
    });
});

describe('request-scoped SSE encoding (R1)', () => {
    test('Accept: text/event-stream answers with one message frame and ends the stream', async () => {
        const res = await post(registry(), {
            headers: { 'Mcp-Method': 'tools/list', Accept: 'text/event-stream' },
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('text/event-stream');
        const text = await res.text();
        expect(text).toMatch(/^event: message\ndata: /);
        expect(text.endsWith('\n\n')).toBe(true);
        const frame = JSON.parse(text.slice(text.indexOf('data: ') + 6)) as { tools: McpToolDescriptor[] };
        expect(frame.tools[0]?.name).toBe('sp_task_show');
    });

    test('an SSE request without Accept keeps the JSON encoding', async () => {
        const res = await post(registry(), { headers: { 'Mcp-Method': 'tools/list' } });
        expect(res.headers.get('Content-Type')).toContain('application/json');
    });
});
