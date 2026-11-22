/**
 * Stateless MCP 2.0+ (`2026-07-28`+) Streamable HTTP protocol adapter (feature B9, task 1371).
 *
 * MCP 2.0+ removes the legacy `initialize` handshake, sticky `Mcp-Session-Id` sessions, and the
 * dual-endpoint `GET /sse` + `POST /messages` transport: every request is a self-contained
 * `POST /mcp` carrying its protocol version (`Mcp-Protocol-Version`), its method (the
 * `Mcp-Method` header, or a JSON-RPC 2.0 body `method`), and its target name (the `Mcp-Name`
 * header, or the body's `params.name` / `params.uri`). It is answered with `application/json`
 * or — when the request's `Accept` asks for it — a request-scoped `text/event-stream` frame.
 * Nothing survives the request: no session store, no persistent stream (R3).
 *
 * This module is transport-only: it parses and serializes, then dispatches over an injected
 * {@link McpHandlerRegistry} (task 1372's `McpDispatcher` implements that seam; `mcpModule`
 * mounts the handler on `POST /mcp` with bearer auth). Legacy pre-2.0 protocol versions
 * (`2024-11-05`, `2025-03-26`, `2025-06-18`, `2025-11-25` — the same list the `spur mcp` bridge
 * translates) and stateful transport attempts are rejected explicitly, never negotiated
 * (R3 / AC1; policy in ADR-152 as amended by B93 1431).
 */

/** Oldest protocol version this adapter accepts; `YYYY-MM-DD` versions compare lexicographically. */
export const MIN_MCP_PROTOCOL_VERSION = '2026-07-28';

/** Marks invalid tool arguments for the protocol's invalid-params response. */
export class InvalidArgumentsError extends Error {
    override name = 'InvalidArgumentsError';
}

/** One tool advertised by the embedded server (task 1372 wires the real harness tools). */
export interface McpToolDescriptor {
    /** Tool name a client passes to `tools/call` (e.g. `sp_task_show`). */
    name: string;
    /** Human-readable summary shown by clients. */
    description?: string;
    /** Input schema, passed through opaquely. */
    inputSchema?: unknown;
    /**
     * MCP behaviour hints (1421 R2): a client must be able to tell a read from a write without
     * knowing Spur's tool names. Frozen per tool — the Board renders its badge from these.
     */
    annotations?: McpToolAnnotations;
}

/** MCP tool annotations as the specification defines them (`tools/list` descriptors). */
export interface McpToolAnnotations {
    /** The tool does not modify state. */
    readOnlyHint: boolean;
    /** The tool may perform destructive updates (no Spur tool does; kept explicit, never defaulted). */
    destructiveHint: boolean;
    /** Calling twice with the same arguments has the same effect as calling once. */
    idempotentHint: boolean;
}

/** One readable resource advertised by the embedded server (e.g. `spur://tasks/{wbs}`). */
export interface McpResourceDescriptor {
    /** Resource URI a client passes to `resources/read`. */
    uri: string;
    /** Human-readable name shown by clients. */
    name?: string;
    /** Human-readable summary shown by clients. */
    description?: string;
    /** Media type of the resource body. */
    mimeType?: string;
}

/**
 * The tool/resource seam `handleMcpHttpRequest` dispatches over. The adapter never imports
 * `@gobing-ai/spur-app` directly, so tests and the task-1372 dispatcher each inject their own
 * implementation; a registry rejection becomes an INTERNAL_ERROR response, not a crash.
 */
export interface McpHandlerRegistry {
    /** Tools advertised by `server/discover` and listed by `tools/list`. */
    listTools(): Promise<McpToolDescriptor[]>;
    /** Execute one named tool; the value is serialized as the call result verbatim. */
    callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
    /** Resources advertised by `server/discover` and listed by `resources/list`. */
    listResources(): Promise<McpResourceDescriptor[]>;
    /** Read one resource body by URI; the value is serialized as the read result verbatim. */
    readResource(uri: string): Promise<unknown>;
    /** Resolved project namespace for tools exposed by this server, or `null` when none applies. */
    namespace(): string | null;
    /**
     * Extra `server/discover` facts (task 1382): the gateway advertises the routing table it
     * proxies and why any entry is excluded. Omitted means the discover payload is unchanged.
     */
    discoverExtras?(): Promise<{ projects: unknown[]; diagnostics: unknown[] }>;
}

/** A protocol-level failure: the HTTP status for the response plus the JSON-RPC error code peers expect. */
class McpProtocolError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        readonly rpcCode: number,
        message: string,
        readonly errorCode?: 'invalid_arguments',
    ) {
        super(message);
        this.name = 'McpProtocolError';
    }
}

function fail(status: number, code: string, rpcCode: number, message: string): McpProtocolError {
    return new McpProtocolError(status, code, rpcCode, message);
}

/** One parsed call: the adapter's view of the incoming request after version/transport gates passed. */
interface McpCall {
    /** Method being invoked: the `Mcp-Method` header, else the JSON-RPC 2.0 body's `method`. */
    method: string;
    /** Params object: the JSON-RPC `params`, else the bare JSON body itself; `{}` when absent. */
    params: Record<string, unknown>;
    /** JSON-RPC request id (null when the envelope omitted it); undefined for bare requests. */
    id: unknown;
    /** True when the body was a JSON-RPC 2.0 envelope — responses mirror the envelope shape. */
    envelope: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
    const value = params[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

const VERSION_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The one refusal message for an unusable protocol revision (B93 1431 R2): it always names the
 * accepted floor and the working fallback, because a client that sees "missing header" alone has no
 * next step. Policy: ADR-152, as amended — pre-2.0 clients connect through the `spur mcp` bridge.
 */
function versionError(detail: string): McpProtocolError {
    return fail(
        400,
        'PROTOCOL_VERSION_UNSUPPORTED',
        -32000,
        `${detail}; this server accepts ${MIN_MCP_PROTOCOL_VERSION} or newer — pre-2.0 clients connect through the stdio bridge (spur mcp)`,
    );
}

/**
 * What to say about a request with no `Mcp-Protocol-Version` (B93 1431 R2): a legacy `initialize`
 * body is NAMED as one, because "missing header" alone leaves that client with no next step. The
 * body is read from a clone, so the dispatcher still gets the original stream.
 */
async function missingVersionDetail(req: Request): Promise<string> {
    const fallback = 'missing the Mcp-Protocol-Version header';
    try {
        const text = await req.clone().text();
        if (text.trim() === '') return fallback;
        const body: unknown = JSON.parse(text);
        if (!isRecord(body) || body.method !== 'initialize') return fallback;
        const params = isRecord(body.params) ? body.params : {};
        const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : 'unstated revision';
        return `legacy initialize handshake (protocolVersion ${requested}, no Mcp-Protocol-Version header)`;
    } catch {
        // An unparseable body is parseCall's finding, not the version gate's.
        return fallback;
    }
}

/**
 * R3/AC1: a call is accepted only on `2026-07-28` or newer — legacy versions are never negotiated,
 * and every refusal is actionable (floor + bridge). `method` lets a header-less legacy `initialize`
 * be named as such instead of reading as a bare missing header.
 */
async function validateVersion(req: Request): Promise<string> {
    const version = req.headers.get('Mcp-Protocol-Version')?.trim() ?? '';
    if (version === '') {
        throw versionError(await missingVersionDetail(req));
    }
    if (!VERSION_SHAPE.test(version)) {
        throw versionError(`"${version}" is not a YYYY-MM-DD protocol version`);
    }
    if (version < MIN_MCP_PROTOCOL_VERSION) {
        throw versionError(`protocol version ${version} is below the supported minimum`);
    }
    return version;
}

/** Read the body and resolve method/params. The header form and the JSON-RPC form share one shape. */
async function parseCall(req: Request): Promise<McpCall> {
    const text = await req.text();
    let record: Record<string, unknown> | undefined;
    if (text.trim() !== '') {
        let body: unknown;
        try {
            body = JSON.parse(text);
        } catch {
            throw fail(400, 'INVALID_REQUEST', -32700, 'the request body is not valid JSON');
        }
        record = isRecord(body) ? body : undefined;
    }
    const headerMethod = req.headers.get('Mcp-Method')?.trim() ?? '';
    const envelope = record !== undefined && record.jsonrpc === '2.0' && typeof record.method === 'string';
    const method = headerMethod !== '' ? headerMethod : envelope ? (record?.method as string) : '';
    if (method === '') {
        throw fail(
            400,
            'INVALID_REQUEST',
            -32600,
            'no method on the request: send the Mcp-Method header or a JSON-RPC 2.0 body with a method',
        );
    }
    const rawParams = envelope ? record?.params : record;
    return {
        method,
        params: isRecord(rawParams) ? rawParams : {},
        id: envelope ? (record?.id ?? null) : undefined,
        envelope,
    };
}

/** Route one parsed call to the registry. Unknown methods are METHOD_NOT_FOUND, never guessed. */
async function dispatch(registry: McpHandlerRegistry, call: McpCall, req: Request, version: string): Promise<unknown> {
    switch (call.method) {
        case 'server/discover': {
            const tools = await registry.listTools();
            const resources = await registry.listResources();
            const ns = registry.namespace();
            const extras = await registry.discoverExtras?.();
            return {
                protocolVersion: version,
                ...(ns !== null ? { namespace: ns } : {}),
                capabilities: {
                    tools,
                    resources,
                },
                // Additive: only a registry that advertises routing (the gateway) supplies these.
                ...(extras !== undefined ? { projects: extras.projects, diagnostics: extras.diagnostics } : {}),
            };
        }
        case 'tools/list':
            return { tools: await registry.listTools() };
        case 'tools/call': {
            const name = req.headers.get('Mcp-Name')?.trim() || stringParam(call.params, 'name');
            if (name === undefined) {
                throw fail(
                    400,
                    'INVALID_PARAMS',
                    -32602,
                    'tools/call needs a tool name: the Mcp-Name header or params.name',
                );
            }
            return registry.callTool(name, isRecord(call.params.arguments) ? call.params.arguments : {});
        }
        case 'resources/list':
            return { resources: await registry.listResources() };
        case 'resources/read': {
            const uri = req.headers.get('Mcp-Name')?.trim() || stringParam(call.params, 'uri');
            if (uri === undefined) {
                throw fail(
                    400,
                    'INVALID_PARAMS',
                    -32602,
                    'resources/read needs a resource URI: the Mcp-Name header or params.uri',
                );
            }
            return registry.readResource(uri);
        }
        default:
            throw fail(
                404,
                'METHOD_NOT_FOUND',
                -32601,
                `method "${call.method}" is not supported; supported stateless methods: server/discover, tools/list, tools/call, resources/list, resources/read`,
            );
    }
}

function jsonResponse(payload: unknown, status: number, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
    });
}

/**
 * Protocol errors always serialize as JSON (even when the request asked for SSE) — an error is
 * never streamed. A JSON-RPC request gets the JSON-RPC error envelope; a header-form request
 * gets `{ error: { code, message } }`.
 */
function errorResponse(
    error: McpProtocolError,
    call: McpCall | undefined,
    headers: Record<string, string> = {},
): Response {
    const classification = error.errorCode === undefined ? {} : { errorCode: error.errorCode };
    const payload =
        call?.envelope === true
            ? {
                  jsonrpc: '2.0',
                  id: call.id ?? null,
                  error: { code: error.rpcCode, message: error.message, ...classification },
              }
            : { error: { code: error.code, message: error.message, ...classification } };
    return jsonResponse(payload, error.status, headers);
}

/** The client asked for the request-scoped SSE encoding. */
function wantsSse(req: Request): boolean {
    return req.headers.get('Accept')?.includes('text/event-stream') === true;
}

/** Request-scoped SSE: exactly one `message` frame with the payload, then the stream ends — no session. */
function sseResponse(payload: unknown): Response {
    const frame = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(frame));
            controller.close();
        },
    });
    return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
}

/**
 * Handle one stateless MCP 2.0+ Streamable HTTP request (`POST /mcp`).
 *
 * Gates in order — transport (POST only; the legacy GET SSE stream endpoint never existed here),
 * statelessness (a `Mcp-Session-Id` is refused), protocol version (missing/malformed/below
 * {@link MIN_MCP_PROTOCOL_VERSION} is refused, R3/AC1) — then parses the call, dispatches to
 * `registry`, and serializes the answer as JSON, or as one request-scoped SSE frame when the
 * request's `Accept` includes `text/event-stream`.
 */
export async function handleMcpHttpRequest(req: Request, registry: McpHandlerRegistry): Promise<Response> {
    if (req.method !== 'POST') {
        return errorResponse(
            fail(
                405,
                'STATEFUL_TRANSPORT_UNSUPPORTED',
                -32000,
                'only POST /mcp exists; the legacy GET SSE stream and session endpoints are not supported',
            ),
            undefined,
            { Allow: 'POST' },
        );
    }
    if (req.headers.get('Mcp-Session-Id') !== null) {
        return errorResponse(
            fail(
                400,
                'SESSIONS_UNSUPPORTED',
                -32000,
                'Mcp-Session-Id is not supported: MCP 2.0+ is stateless, send every request without a session ID',
            ),
            undefined,
        );
    }
    let call: McpCall | undefined;
    try {
        const version = await validateVersion(req);
        call = await parseCall(req);
        const payload = await dispatch(registry, call, req, version);
        // A JSON-RPC request gets the JSON-RPC result envelope; a header-form request gets the bare value.
        const body = call.envelope ? { jsonrpc: '2.0', id: call.id ?? null, result: payload } : payload;
        return wantsSse(req) ? sseResponse(body) : jsonResponse(body, 200);
    } catch (error) {
        if (error instanceof InvalidArgumentsError) {
            return errorResponse(
                new McpProtocolError(
                    500,
                    'INTERNAL_ERROR',
                    -32603,
                    `the handler failed: ${error.message}`,
                    'invalid_arguments',
                ),
                call,
            );
        }
        const protocolError =
            error instanceof McpProtocolError
                ? error
                : fail(
                      500,
                      'INTERNAL_ERROR',
                      -32603,
                      `the handler failed: ${error instanceof Error ? error.message : String(error)}`,
                  );
        return errorResponse(protocolError, call);
    }
}
