import {
    findPrefixCollisions,
    isLocalHost,
    type ProjectEntry,
    resolveProjectPrefix,
    type SpurConfig,
} from '@gobing-ai/spur-config';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { allowedHostnames, isAllowedHost, rejectHost } from './host-guard';
import { resolveMcpNamespace } from './mcp-namespace';
import { resolveProjectWorkflowTools, workflowToolDescriptor } from './mcp-workflow-tools';
import {
    type GatewayIndexDiagnostic,
    type GatewayIndexMcp,
    type GatewayIndexNamespace,
    type GatewayIndexProject,
    type GatewayIndexRouting,
    renderGatewayIndex,
} from './project-gateway-html';

/**
 * The one-port project gateway's request handler (feature K4, ADR-151 §4).
 *
 * Pure: no `Bun.serve`, no registry writes. `apps/server` owns the listener and the CLI composes
 * the deps; every side effect arrives through {@link GatewayDeps}, so the routing contract is
 * testable against real stub upstreams without binding the gateway port.
 */

/** What the gateway needs from the rest of the system. */
export interface GatewayDeps {
    /** Every registry entry — remote entries are filtered out by the handler. */
    listProjects(): Promise<ProjectEntry[]>;
    /** Start or adopt one project's `spur self serve` and resolve its loopback port. */
    ensureUpstream(entry: ProjectEntry): Promise<number>;
    /** Remove a registered project entry from `projects.json`. */
    removeProject?: (path: string, host?: string) => Promise<boolean>;
    /** Test seam; defaults to the global `fetch`. */
    fetchUpstream?: typeof fetch;
    /** The gateway's own fixed port, echoed by `/api/health`. */
    port: number;
    /** Public-origin edge policy (host guard + CSRF). Omitted means loopback-only trust. */
    edge?: GatewayEdgeOptions;
    /** Structured event sink (the CLI composes a JSONL log); omission disables event logging. */
    onEvent?: (event: GatewayEvent) => void;
    /**
     * Gateway-hosted MCP handler for the root `/mcp` route (task 1382). Injected by `apps/server` so
     * this layer stays transport-free; omitted means `/mcp` is a 404, never a proxy attempt. The
     * registry is built here (it needs `ensureUpstream`'s de-duplication) and handed in (task 1383).
     */
    mcp?: (req: Request, registry: McpGatewayRegistry) => Promise<Response>;
    mcpAuth?: { envName: string; tokenPresent: boolean };
    /** The five `sp_*` built-in descriptors, supplied by `apps/server` (task 1383 R1). */
    builtinTools?: () => McpGatewayTool[];
    /** Project bearer token for upstream calls; the gateway env holds one shared value (closed Q&A). */
    projectMcpToken?: () => string | undefined;
    /** MCP namespace inherited by project servers the gateway starts. */
    projectMcpNamespace?: string;
    /** Read workflow layer configuration without starting the project. */
    loadProjectConfig?: (root: string) => Promise<SpurConfig | null>;
    /** The MCP protocol version header the project adapter requires (task 1383 R3). */
    mcpProtocolVersion?: string;
}

/** The subset of an MCP tool descriptor the gateway aggregates (task 1383 R1). */
export interface McpGatewayTool {
    name: string;
    description?: string;
    /** Passed through opaquely, like the server's `McpToolDescriptor.inputSchema`. */
    inputSchema?: unknown;
}

/** One local project's routing facts, recomputed per request — the gateway keeps no cache. */
export interface GatewayMcpRoute {
    entry: ProjectEntry;
    prefix: string;
    namespace: string | null;
    tools: Array<{ name: string; description?: string; inputSchema?: unknown }>;
}

/**
 * The gateway's own MCP registry (task 1383). Structurally the server's `McpHandlerRegistry`, plus
 * the route table `tools/call` needs; declared here so `packages/app` owns no server import.
 */
export interface McpGatewayRegistry {
    listTools(): Promise<McpGatewayTool[]>;
    callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
    listResources(): Promise<unknown[]>;
    readResource(uri: string): Promise<unknown>;
    namespace(): string | null;
    discoverExtras(): Promise<{ projects: unknown[]; diagnostics: unknown[] }>;
}

/** Structured gateway event kinds (feature K42, task 1384 R1). */
export type GatewayEventKind =
    | 'upstream.ensure'
    | 'upstream.restart'
    | 'proxy.unreachable'
    | 'route.collision'
    | 'guard.host'
    | 'guard.csrf';

/**
 * One gateway occurrence handed to `GatewayDeps.onEvent`.
 *
 * Never carries request headers, query strings or bodies (task 1384 R3): request data is limited
 * to the URL pathname. Extra fields beyond the named ones are reserved for future kinds.
 */
export type GatewayEvent = {
    ts: string;
    kind: GatewayEventKind;
    name?: string;
    prefix?: string;
    path?: string;
    reason?: string;
    outcome?: 'ok' | 'failed';
    ms?: number;
    status?: number;
    dialed?: string[];
    names?: string[];
};

/** Public-origin policy the gateway enforces before any upstream contact. */
export interface GatewayEdgeOptions {
    /** The name the gateway binds — accepted besides `localhost` and IP literals. */
    bindHost: string;
    /** Tunnel hostnames the operator configured (`server.gateway.allowedHosts`). */
    allowedHosts: readonly string[];
}

/** Hop-by-hop headers never forwarded in either direction (RFC 7230 §6.1). */
const HOP_BY_HOP = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
]);

/** Response headers the gateway must drop: Bun's fetch already decoded a compressed body. */
const DECODED = ['content-encoding', 'content-length'];

/** Test seam for {@link isGatewayAnswering}: the CLI's gateway URL column must not depend on a live port. */
let gatewayProbeOverride: ((port: number) => Promise<boolean>) | undefined;

/** Replace the gateway probe in tests (pass `undefined` to restore the real HTTP probe). */
export function setGatewayProbeForTests(probe: ((port: number) => Promise<boolean>) | undefined): void {
    gatewayProbeOverride = probe;
}

/**
 * Answer true when a project gateway serves `GET /api/health` on `port`.
 *
 * Probes `localhost`, not `127.0.0.1`: the gateway binds `server.host` (default `localhost`), which
 * Bun resolves to `::1` on macOS — an IPv4-only probe then reports a healthy gateway as down.
 * A 200 ms bounded probe used by `spur projects list` to decide whether to print gateway URLs; it
 * never starts a gateway, and any failure (refused, timeout, non-2xx, not a gateway) reads `false`.
 */
export async function isGatewayAnswering(port: number, fetchImpl: typeof fetch = fetch): Promise<boolean> {
    if (gatewayProbeOverride !== undefined) return gatewayProbeOverride(port);
    try {
        const res = await fetchImpl(`http://localhost:${port}/api/health`, {
            signal: AbortSignal.timeout(200),
        });
        if (!res.ok) return false;
        const body = (await res.json()) as { gateway?: unknown };
        return body.gateway === true;
    } catch {
        return false;
    }
}

/**
 * Classify a gateway port: `gateway` (our own `gateway: true` health answer), `foreign` (something
 * else answers) or `free` (nothing reachable).
 *
 * Probes `localhost` for the same reason {@link isGatewayAnswering} does — the gateway binds
 * `server.host`, not `127.0.0.1`.
 */
export async function probeGatewayPort(
    port: number,
    fetchImpl: typeof fetch = fetch,
): Promise<'gateway' | 'foreign' | 'free'> {
    try {
        const res = await fetchImpl(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(200) });
        const body = res.ok ? ((await res.json()) as { gateway?: unknown }) : null;
        return body?.gateway === true ? 'gateway' : 'foreign';
    } catch {
        return 'free';
    }
}

/** Where a spawned serve writes its own log — named in the 502 so the operator knows where to look. */
export const GATEWAY_START_LOG = '.spur/run/serve-spawn.log';

/** Form/text content types a browser can send cross-site without a CORS preflight. */
const SIMPLE_FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];

/** Origin-bearing methods that reach a mutation; everything else is safe by definition. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Public-origin guard: host allowlist (421), then same-origin CSRF (403) for non-safe methods.
 *
 * The browser talks to the tunnel origin while the upstream only ever sees loopback, so both checks
 * happen here — no project serve is modified and no forwarded header is trusted. Returns `null` when
 * the request may proceed. `/<prefix>/a2a/*` and `/<prefix>/mcp/*` are exempt: those routes are
 * bearer-authenticated, which a cross-site simple request cannot produce.
 */
export function gatewayGuard(req: Request, options: GatewayEdgeOptions): Response | null {
    const allowed = allowedHostnames(
        options.bindHost,
        options.allowedHosts.map((host) => `https://${host}`),
    );
    if (!isAllowedHost(req, allowed)) {
        return rejectHost();
    }

    const method = req.method.toUpperCase();
    if (SAFE_METHODS.has(method)) return null;

    const url = new URL(req.url);
    const segments = url.pathname.split('/').filter((segment) => segment !== '');
    // Root `/mcp` is the gateway-hosted MCP entry (task 1382): bearer-authenticated, so a cross-site
    // simple request cannot reach it — same exemption as the per-project `/<prefix>/mcp`.
    if (segments[0] === 'mcp') return null;
    if (segments[1] === 'a2a' || segments[1] === 'mcp') return null;

    const origin = req.headers.get('origin');
    if (origin !== null) {
        // Compare host only: the tunnel terminates TLS, so the browser's Origin is https:// while the
        // loopback listener's req.url is http://. The Host itself was just allowlisted above.
        let originHost: string;
        try {
            const parsed = new URL(origin);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return forbiddenOrigin();
            originHost = parsed.host;
        } catch {
            return forbiddenOrigin();
        }
        return originHost === url.host ? null : forbiddenOrigin();
    }
    const contentType = (req.headers.get('content-type') ?? '').toLowerCase();
    const plainFormPost = SIMPLE_FORM_TYPES.some((type) => contentType.startsWith(type));
    return plainFormPost ? forbiddenOrigin() : null;
}

/** 403 for a cross-origin mutation — names the fix, never echoes the offending origin. */
function forbiddenOrigin(): Response {
    return new Response(
        'Forbidden: cross-origin request refused. Open the Board on the gateway origin, or configure the host in server.gateway.allowedHosts.',
        { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
}

/**
 * Loopback families the gateway dials for a local upstream, IPv4 first: a registry-spawned serve
 * binds `127.0.0.1` (`project-start.ts:466`), while a hand-started `spur self serve` binds `localhost`,
 * which Bun resolves to `::1` on macOS. Same both-families rule as `isPortLive`.
 */
const LOOPBACK_FAMILIES = ['127.0.0.1', '::1'] as const;

/** `host:port` authority for a loopback family — an IPv6 literal must be bracketed in URL and Host. */
export function loopbackAuthority(family: string, port: number): string {
    return `${family.includes(':') ? `[${family}]` : family}:${port}`;
}

/**
 * Headers for the loopback upstream: `Host`/`Origin` become the upstream's own origin so the serve's
 * host guard and `csrf()` see a plain same-origin request; `Referer` and hop-by-hop headers go.
 * `authority` is the `host:port` the request is actually sent to, never a fixed family.
 */
export function upstreamRequestHeaders(
    req: Request,
    authority: string,
    forwarded?: { prefix?: string; host?: string },
): Headers {
    // Forwarded identity (1395 R3): the upstream binds loopback, so only a local process can set
    // these, and they are used for the ADVERTISED card URL — never for auth.
    const forwardedHost = forwarded?.host ?? req.headers.get('host')?.trim();
    const headers = stripHeaders(req.headers, ['host', 'origin', 'referer', 'x-forwarded-host', 'x-forwarded-prefix']);
    headers.set('host', authority);
    if (forwardedHost !== undefined && forwardedHost !== '') headers.set('x-forwarded-host', forwardedHost);
    if (forwarded?.prefix !== undefined) headers.set('x-forwarded-prefix', forwarded.prefix);
    if (req.headers.get('origin') !== null) {
        headers.set('origin', `http://${authority}`);
    }
    return headers;
}

/** Prefix one root-absolute URL (`/x` → `/<prefix>/x`); `//`, absolute and fragment URLs pass through. */
function rebaseUrl(value: string, prefix: string): string {
    if (!value.startsWith('/') || value.startsWith('//')) return value;
    if (value === prefix || value.startsWith(`${prefix}/`)) return value;
    return `${prefix}${value}`;
}

/** Attributes an HTML document uses to reference something the browser will fetch. */
const URL_ATTRIBUTES = 'href|src|component-url|renderer-url|content|action';

/**
 * Rebase a served HTML document under `/<prefix>/` and declare the base for client code.
 *
 * Deliberately string-level and narrow: root-absolute attribute values plus import-map entries. Inline
 * scripts are never touched — the Board's chunk URLs are already relative (task 1358). Idempotent, so
 * a second pass over an already-rebased document is a no-op.
 */
export function rebaseHtml(html: string, prefix: string): string {
    const attributes = new RegExp(`(\\s(?:${URL_ATTRIBUTES})=["'])([^"']*)`, 'g');
    let out = html.replace(attributes, (_all, open: string, path: string) => `${open}${rebaseUrl(path, prefix)}`);

    out = out.replace(/(<script[^>]+type=["']importmap["'][^>]*>)([\s\S]*?)(<\/script>)/, (_all, open, body, close) => {
        try {
            const parsed = JSON.parse(body) as Record<string, unknown>;
            const rebased = rebaseImportMap(parsed, prefix);
            return `${open}${JSON.stringify(rebased)}${close}`;
        } catch {
            return `${open}${body}${close}`;
        }
    });

    if (out.includes('name="spur-base"')) return out;
    const meta = `<meta name="spur-base" content="${prefix}/">`;
    return /<head[^>]*>/i.test(out) ? out.replace(/<head([^>]*)>/i, `<head$1>${meta}`) : `${meta}${out}`;
}

/** Prefix every root-absolute string in an import map, recursing one level into `imports`/`scopes`. */
function rebaseImportMap(map: Record<string, unknown>, prefix: string): Record<string, unknown> {
    const rebased: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(map)) {
        if (key === 'imports' && value !== null && typeof value === 'object') {
            const entries = Object.fromEntries(
                Object.entries(value as Record<string, unknown>).map(([spec, target]) => [
                    rebaseUrl(spec, prefix),
                    typeof target === 'string' ? rebaseUrl(target, prefix) : target,
                ]),
            );
            rebased[key] = entries;
            continue;
        }
        rebased[key] = typeof value === 'string' ? rebaseUrl(value, prefix) : value;
    }
    return rebased;
}

/** Rebase a `Location` header under the prefix; protocol-relative and absolute URLs pass through. */
export function rebaseLocation(location: string, prefix: string): string {
    return rebaseUrl(location, prefix);
}

/** Rebase a web app manifest's entry points so an installed Board opens under the prefix. */
export function rebaseManifest(manifest: string, prefix: string): string {
    const parsed = JSON.parse(manifest) as Record<string, unknown>;
    for (const key of ['start_url', 'scope', 'id']) {
        const value = parsed[key];
        if (typeof value === 'string') parsed[key] = rebaseUrl(value, prefix);
    }
    if (Array.isArray(parsed.icons)) {
        parsed.icons = parsed.icons.map((icon) => {
            if (icon === null || typeof icon !== 'object') return icon;
            const record = icon as Record<string, unknown>;
            return typeof record.src === 'string' ? { ...record, src: rebaseUrl(record.src, prefix) } : record;
        });
    }
    return JSON.stringify(parsed);
}

function stripHeaders(headers: Headers, extra: readonly string[] = []): Headers {
    const out = new Headers();
    for (const [key, value] of headers) {
        const lower = key.toLowerCase();
        if (HOP_BY_HOP.has(lower) || extra.includes(lower)) continue;
        out.set(key, value);
    }
    return out;
}

/** True when an upstream fetch failed because nothing was listening on the loopback port. */
function isConnectionRefused(err: unknown): boolean {
    const asRecord = err as { code?: unknown; cause?: { code?: unknown } };
    if (asRecord?.code === 'ECONNREFUSED' || asRecord?.cause?.code === 'ECONNREFUSED') return true;
    const message = err instanceof Error ? err.message : String(err);
    return /ECONNREFUSED|Unable to connect|ConnectionRefused/i.test(message);
}

/** A local upstream that answered on no loopback family, carrying every address the gateway dialed. */
class UnreachableUpstream extends Error {
    constructor(
        readonly dialed: string[],
        readonly reason: string,
    ) {
        super(`no loopback family answered (${dialed.join(', ')}): ${reason}`);
        this.name = 'UnreachableUpstream';
    }
}

/**
 * Build the gateway's `fetch` handler.
 *
 * Composition mirrors the design's `guard → route → proxy → adapt` chain: this task ships the
 * routing and proxy thirds; `guard` and `adapt` are identity here and task 1360 replaces them.
 */
/**
 * Adapt one upstream response for the public origin: rebase `Location`, HTML and the web manifest.
 *
 * Only HTML (and the manifest) is buffered — every other body keeps streaming, so SSE latency is
 * unchanged from the proxy itself.
 */
async function adaptResponse(upstreamRes: Response, prefix: string, rest: string, method: string): Promise<Response> {
    const headers = stripHeaders(upstreamRes.headers, DECODED);
    const location = headers.get('location');
    if (location !== null) {
        headers.set('location', rebaseLocation(location, prefix));
    }
    const contentType = (headers.get('content-type') ?? '').toLowerCase();
    const isHtml = contentType.startsWith('text/html');
    const isManifest = rest.endsWith('site.webmanifest');
    const status = upstreamRes.status;
    const statusText = upstreamRes.statusText;
    if (!isHtml && !isManifest) {
        return new Response(method === 'HEAD' ? null : upstreamRes.body, { status, statusText, headers });
    }
    const body = await upstreamRes.text();
    return new Response(isHtml ? rebaseHtml(body, prefix) : rebaseManifest(body, prefix), {
        status,
        statusText,
        headers,
    });
}

/**
 * Build the gateway's `fetch` handler.
 *
 * Composition mirrors the design's `guard → route → proxy → adapt` chain: `gatewayGuard` runs before
 * any routing, `upstreamRequestHeaders` keeps the serve's own host guard and `csrf()` satisfied, and
 * `adaptResponse` rebases what the browser resolves against the public origin.
 */
export function createGatewayHandler(deps: GatewayDeps): (req: Request) => Promise<Response> {
    const fetchUpstream = deps.fetchUpstream ?? fetch;
    /** One event per occurrence (1384 R1): stamp `ts`, then hand to the injected sink. */
    const emit = (event: Omit<GatewayEvent, 'ts'>): void => {
        deps.onEvent?.({ ...event, ts: new Date().toISOString() });
    };
    const inFlight = new Map<string, Promise<number>>();
    /** Answering loopback family per entry, so a later request does not re-probe a known-dead one. */
    const familyByEntry = new Map<string, (typeof LOOPBACK_FAMILIES)[number]>();
    /**
     * Since-creation counters (1385 R1). Closure-local on purpose: the gateway is stateless and the
     * durable history of what broke lives in each project's event log, so a restart resets these.
     */
    const counters = {
        since: new Date().toISOString(),
        requests: 0,
        status4xx: 0,
        status5xx: 0,
        upstreamRestarts: {} as Record<string, number>,
    };
    const mcpTimes = new Map<number, { calls: number; failures: number; authDenials: number; lastCall: number }>();
    const mcpTotal = { calls: 0, failures: 0, authDenials: 0, lastCall: 0 };
    const maxMcpWindowSeconds = 7 * 24 * 60 * 60;

    function mcpActivity(since: string | null) {
        const cutoff = since === null ? NaN : Date.parse(since);
        const result = { calls: 0, failures: 0, authDenials: 0, lastCall: 0 };
        for (const sample of Number.isFinite(cutoff) ? mcpTimes.values() : [mcpTotal]) {
            if (Number.isFinite(cutoff) && sample.lastCall < cutoff) continue;
            result.calls += sample.calls;
            result.failures += sample.failures;
            result.authDenials += sample.authDenials;
            result.lastCall = Math.max(result.lastCall, sample.lastCall);
        }
        return { ...result, lastCall: result.calls === 0 ? null : new Date(result.lastCall).toISOString() };
    }

    function countMcp(status: number): void {
        const now = Date.now();
        const second = Math.floor(now / 1000);
        const bucket = mcpTimes.get(second) ?? { calls: 0, failures: 0, authDenials: 0, lastCall: 0 };
        for (const sample of [bucket, mcpTotal]) {
            sample.calls += 1;
            if (status >= 400) sample.failures += 1;
            if (status === 401) sample.authDenials += 1;
            sample.lastCall = now;
        }
        mcpTimes.set(second, bucket);
        for (const oldest of mcpTimes.keys()) {
            if (oldest >= second - maxMcpWindowSeconds) break;
            mcpTimes.delete(oldest);
        }
    }

    /** Registry identity of an entry: path *and* host, so two hosts never share gateway state. */
    function identityKey(entry: ProjectEntry): string {
        return `${entry.host ?? 'localhost'}|${entry.path}`;
    }

    /** Coalesce concurrent first requests onto one start; drop the entry on settle so a later retry re-probes. */
    function ensureUpstream(entry: ProjectEntry): Promise<number> {
        const key = identityKey(entry);
        const running = inFlight.get(key);
        if (running) return running;
        const started = deps.ensureUpstream(entry).then(
            (port) => {
                inFlight.delete(key);
                return port;
            },
            (err: unknown) => {
                inFlight.delete(key);
                throw err;
            },
        );
        inFlight.set(key, started);
        return started;
    }

    async function localEntries(): Promise<Array<{ entry: ProjectEntry; prefix: string }>> {
        const projects = await deps.listProjects();
        return projects.flatMap((entry) => {
            const prefix = resolveProjectPrefix(entry);
            return prefix === null || !isLocalHost(entry.host) ? [] : [{ entry, prefix }];
        });
    }

    /** The one since-creation snapshot projection: `/api/health` and the root page report the same numbers. */
    function counterSnapshot(): GatewayIndexRouting {
        return { ...counters, upstreamRestarts: { ...counters.upstreamRestarts } };
    }

    /** Keep only the display-safe namespace rows the registry's discovery projection carries. */
    function namespaceRows(projects: unknown[]): GatewayIndexNamespace[] {
        return projects.flatMap((project) => {
            if (typeof project !== 'object' || project === null) return [];
            const value = project as Record<string, unknown>;
            if (typeof value.name !== 'string' || typeof value.prefix !== 'string') return [];
            return [
                {
                    name: value.name,
                    prefix: value.prefix,
                    namespace: typeof value.namespace === 'string' ? value.namespace : null,
                },
            ];
        });
    }

    /** Reason and remedy only: internal exception text never reaches the page (1442 R1). */
    function diagnosticRows(items: unknown[]): GatewayIndexDiagnostic[] {
        return items.flatMap((item) => {
            if (typeof item !== 'object' || item === null) return [];
            const value = item as Record<string, unknown>;
            if (typeof value.name !== 'string' || typeof value.reason !== 'string') return [];
            return [
                {
                    name: value.name,
                    reason: value.reason,
                    remedy: typeof value.remedy === 'string' ? value.remedy : '',
                },
            ];
        });
    }

    /** The root page's gateway-MCP block: state, credential presence, namespaces, diagnostics. */
    async function mcpIndexSnapshot(): Promise<GatewayIndexMcp> {
        const auth = deps.mcpAuth ?? { envName: '', tokenPresent: false };
        if (deps.mcp === undefined) return { enabled: false, auth, namespaces: [], diagnostics: [] };
        try {
            const extras = await mcpRegistry.discoverExtras();
            return {
                enabled: true,
                auth,
                namespaces: namespaceRows(extras.projects),
                diagnostics: diagnosticRows(extras.diagnostics),
            };
        } catch {
            // A discovery failure must never cost the operator the page: cards and counters stay.
            return { enabled: true, auth, namespaces: [], diagnostics: [], unavailable: true };
        }
    }

    function health(known: Array<{ entry: ProjectEntry; prefix: string }>, mcpSince: string | null): Response {
        return Response.json({
            ok: true,
            gateway: true,
            port: deps.port,
            projects: known.map(({ entry, prefix }) => ({
                name: entry.name,
                prefix,
                running: entry.port > 0,
            })),
            // 1385 R2: additive — `isGatewayAnswering`/`probeGatewayPort` read only `gateway`.
            counters: counterSnapshot(),
            ...(deps.mcp === undefined
                ? {}
                : {
                      mcp: { enabled: true, auth: deps.mcpAuth ?? { envName: '', tokenPresent: false } },
                      mcpActivity: mcpActivity(mcpSince),
                  }),
        });
    }

    async function index(): Promise<Response> {
        const entries = await deps.listProjects();
        const projects = entries.flatMap<GatewayIndexProject>((entry) => {
            if (!isLocalHost(entry.host)) return [{ entry, prefix: null }];
            const prefix = resolveProjectPrefix(entry);
            return prefix === null ? [] : [{ entry, prefix }];
        });
        // Sampled at render time from the current process — no polling, no persistence (ADR-151).
        return new Response(
            renderGatewayIndex({
                port: deps.port,
                edge: deps.edge,
                projects,
                mcp: await mcpIndexSnapshot(),
                routing: counterSnapshot(),
            }),
            { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
    }

    /** Dial the project's loopback listener, remembering the family that answers. */
    async function dialUpstream(
        key: string,
        port: number,
        attempt: (authority: string) => Promise<Response>,
    ): Promise<Response> {
        const cached = familyByEntry.get(key);
        const families = cached === '::1' ? ([cached, '127.0.0.1'] as const) : LOOPBACK_FAMILIES;
        const dialed: string[] = [];
        let lastError: unknown = null;
        for (const family of families) {
            const authority = loopbackAuthority(family, port);
            dialed.push(authority);
            try {
                const response = await attempt(authority);
                familyByEntry.set(key, family);
                return response;
            } catch (err) {
                if (!isConnectionRefused(err)) throw err;
                lastError = err;
            }
        }
        const message = lastError instanceof Error ? lastError.message : String(lastError);
        throw new UnreachableUpstream(dialed, message);
    }

    async function proxy(
        req: Request,
        entry: ProjectEntry,
        prefix: string,
        rest: string,
        search: string,
    ): Promise<Response> {
        const key = identityKey(entry);
        // Buffered once so a body survives the family fallback: a streamed body is consumed by the
        // first attempt, and re-sending it empty would be a wrong-but-successful write.
        const body = req.method === 'GET' || req.method === 'HEAD' ? null : new Uint8Array(await req.arrayBuffer());
        /** The authority the client dialed, so a card can advertise the stable gateway URL (1395 R3). */
        const gatewayAuthority = req.headers.get('host')?.trim() ?? `localhost:${deps.port}`;

        const dial = (port: number): Promise<Response> =>
            dialUpstream(key, port, async (authority) => {
                const target = `http://${authority}${rest === '' ? '/' : rest}${search}`;
                const init: RequestInit = {
                    method: req.method,
                    headers: upstreamRequestHeaders(req, authority, { prefix, host: gatewayAuthority }),
                    redirect: 'manual',
                    signal: req.signal,
                };
                if (body !== null) init.body = body;
                const upstreamRes = await fetchUpstream(target, init);
                return adaptResponse(upstreamRes, prefix, rest, req.method);
            });

        const ensureStarted = Date.now();
        let port: number;
        try {
            port = await ensureUpstream(entry);
            emit({ kind: 'upstream.ensure', outcome: 'ok', ms: Date.now() - ensureStarted, name: entry.name, prefix });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            emit({
                kind: 'upstream.ensure',
                outcome: 'failed',
                ms: Date.now() - ensureStarted,
                name: entry.name,
                prefix,
                reason: message,
            });
            return new Response(
                `Gateway could not start project "${entry.name}": ${message}\nLog: ${entry.path}/${GATEWAY_START_LOG}\n`,
                { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } },
            );
        }

        try {
            return await dial(port);
        } catch (err) {
            if (!(err instanceof UnreachableUpstream)) throw err;
            const replayable = req.method === 'GET' || req.method === 'HEAD';
            if (!replayable) {
                return unreachable(
                    entry,
                    prefix,
                    err,
                    'the request body cannot be replayed, so no restart was attempted.',
                );
            }
            // The adopted port went away between adoption and the request: one fresh start, then give up.
            inFlight.delete(key);
            familyByEntry.delete(key);
            // Keyed by prefix: registry names are not unique (the same project may be registered twice).
            counters.upstreamRestarts[prefix] = (counters.upstreamRestarts[prefix] ?? 0) + 1;
            emit({ kind: 'upstream.restart', name: entry.name, prefix });
            let retried: number;
            try {
                retried = await ensureUpstream(entry);
            } catch (retryErr) {
                const message = retryErr instanceof Error ? retryErr.message : String(retryErr);
                return new Response(
                    `Gateway could not restart project "${entry.name}": ${message}\nLog: ${entry.path}/${GATEWAY_START_LOG}\n`,
                    { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } },
                );
            }
            try {
                return await dial(retried);
            } catch (retryErr) {
                if (!(retryErr instanceof UnreachableUpstream)) throw retryErr;
                return unreachable(entry, prefix, retryErr);
            }
        }
    }

    /** 502 naming the entry identity, every dialed loopback address, and the serve spawn log. */
    function unreachable(entry: ProjectEntry, prefix: string, err: UnreachableUpstream, note?: string): Response {
        emit({ kind: 'proxy.unreachable', name: entry.name, prefix, dialed: [...err.dialed], reason: err.reason });
        const host = entry.host ?? 'localhost';
        return new Response(
            `Gateway could not reach project "${entry.name}" (${host}) at ${err.dialed.join(', ')}: ${err.reason}\n` +
                (note === undefined ? '' : `${note}\n`) +
                `Log: ${entry.path}/${GATEWAY_START_LOG}\n`,
            { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } },
        );
    }

    async function removeProject(req: Request): Promise<Response> {
        if (req.method.toUpperCase() !== 'POST') {
            return new Response('Method Not Allowed\n', { status: 405, headers: { allow: 'POST' } });
        }
        if (!deps.removeProject) {
            return Response.json({ ok: false, error: 'Project removal is not configured' }, { status: 501 });
        }
        let body: { path?: unknown; host?: unknown };
        try {
            body = (await req.json()) as { path?: unknown; host?: unknown };
        } catch {
            return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
        }
        if (typeof body.path !== 'string' || body.path.trim() === '') {
            return Response.json({ ok: false, error: 'Project path is required' }, { status: 400 });
        }
        const host = typeof body.host === 'string' && body.host.trim() !== '' ? body.host.trim() : undefined;
        const removed = await deps.removeProject(body.path, host);
        if (!removed) {
            return Response.json({ ok: false, error: 'Project not found' }, { status: 404 });
        }
        return Response.json({ ok: true });
    }

    /**
     * Route table for the gateway's MCP surface (task 1383 R1/R2): every local project's prefix,
     * namespace and exposed workflow tools, recomputed per call so listing never starts a
     * project and no cache can go stale.
     */
    async function mcpRoutes(fs: FileSystem): Promise<GatewayMcpRoute[]> {
        const routes: GatewayMcpRoute[] = [];
        for (const { entry, prefix } of await localEntries()) {
            const { namespace } = await resolveMcpNamespace({
                configured: deps.projectMcpNamespace,
                projectRoot: entry.path,
                fs,
            });
            const { tools } =
                namespace === null
                    ? { tools: [] }
                    : await resolveProjectWorkflowTools({
                          cwd: entry.path,
                          config: (await deps.loadProjectConfig?.(entry.path)) ?? null,
                          namespace,
                          fs,
                      });
            routes.push({
                entry,
                prefix,
                namespace,
                tools: tools.map(workflowToolDescriptor),
            });
        }
        return routes;
    }

    /** Namespaces claimed by 2+ local projects (task 1383 R2): ambiguous, so their tools are withheld. */
    function collidingNamespaces(routes: GatewayMcpRoute[]): Map<string, string[]> {
        const byNamespace = new Map<string, string[]>();
        for (const route of routes) {
            if (route.namespace === null) continue;
            const names = byNamespace.get(route.namespace) ?? [];
            names.push(route.entry.name);
            byNamespace.set(route.namespace, names);
        }
        return new Map([...byNamespace].filter(([, names]) => names.length > 1));
    }

    /** A tool error names the cause and the remedy; it never carries a token value (task 1383 R5). */
    function toolError(message: string): Error {
        return new Error(message);
    }

    const mcpRegistry: McpGatewayRegistry = {
        async listTools(): Promise<McpGatewayTool[]> {
            const routes = await mcpRoutes(createNodeFileSystem());
            const collisions = collidingNamespaces(routes);
            const builtins = deps.builtinTools?.() ?? [];
            return [
                // Built-ins once, each extended with the required `project` selector (R1).
                ...builtins.map((tool) => {
                    const schema = (tool.inputSchema ?? {}) as {
                        properties?: Record<string, unknown>;
                        required?: string[];
                        [key: string]: unknown;
                    };
                    return {
                        ...tool,
                        inputSchema: {
                            ...schema,
                            type: 'object',
                            properties: {
                                project: {
                                    type: 'string',
                                    description:
                                        'Registered project name or gateway prefix that should execute this tool',
                                },
                                ...(schema.properties ?? {}),
                            },
                            required: ['project', ...(schema.required ?? []).filter((name) => name !== 'project')],
                        },
                    };
                }),
                ...routes.flatMap((route) =>
                    route.namespace !== null && !collisions.has(route.namespace) ? route.tools : [],
                ),
            ];
        },

        async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
            const fs = createNodeFileSystem();
            const routes = await mcpRoutes(fs);
            const collisions = collidingNamespaces(routes);

            let target: GatewayMcpRoute | undefined;
            let forwarded = args;
            const isBuiltin = (deps.builtinTools?.() ?? []).some((tool) => tool.name === name);
            if (isBuiltin) {
                const requested = typeof args.project === 'string' ? args.project.trim() : '';
                if (requested === '') {
                    throw toolError(
                        `tool "${name}" needs a "project" argument naming a registered project (spur projects list)`,
                    );
                }
                const matches = routes.filter(
                    (route) => route.entry.name === requested || route.prefix === `/${requested.replace(/^\//, '')}`,
                );
                if (matches.length === 0) {
                    const known = routes.map((route) => route.entry.name).join(', ') || '(none registered)';
                    throw toolError(`unknown project "${requested}" for tool "${name}"; registered projects: ${known}`);
                }
                if (matches.length > 1) {
                    throw toolError(
                        `project "${requested}" is ambiguous for tool "${name}": ${matches
                            .map((route) => route.entry.name)
                            .join(' and ')}; call it by its registered name`,
                    );
                }
                target = matches[0];
                // The upstream expects the tool's own arguments only (R3).
                const { project: _project, ...rest } = args;
                forwarded = rest;
            } else {
                const owners = routes.filter((route) => route.tools.some((tool) => tool.name === name));
                const colliding = owners.filter((route) => route.namespace !== null && collisions.has(route.namespace));
                if (colliding.length > 0) {
                    const names = colliding.map((route) => route.entry.name).join(' and ');
                    throw toolError(
                        `tool "${name}" is not callable: its namespace "${colliding[0]?.namespace ?? ''}" is claimed by ${names}; give one project a distinct plugin manifest name`,
                    );
                }
                if (owners.length === 0) {
                    throw toolError(
                        `unknown tool "${name}"; tools/list lists the built-ins (with a "project" argument) and each local project's namespaced workflow tools`,
                    );
                }
                target = owners[0];
            }
            if (target === undefined) throw toolError(`tool "${name}" is not routable`);
            const route: GatewayMcpRoute = target;

            const token = deps.projectMcpToken?.();
            if (token === undefined || token === '') {
                throw toolError(
                    `cannot call project "${route.entry.name}": the gateway has no project MCP token; set the variable named by server.mcp.authEnv for this project`,
                );
            }

            let port: number;
            try {
                port = await ensureUpstream(route.entry);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                throw toolError(`could not start project "${route.entry.name}" for tool "${name}": ${message}`);
            }

            let response: Response;
            try {
                response = await dialUpstream(identityKey(route.entry), port, (authority) =>
                    fetchUpstream(`http://${authority}/mcp`, {
                        method: 'POST',
                        redirect: 'manual',
                        headers: {
                            'content-type': 'application/json',
                            ...(deps.mcpProtocolVersion !== undefined
                                ? { 'mcp-protocol-version': deps.mcpProtocolVersion }
                                : {}),
                            authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({
                            jsonrpc: '2.0',
                            id: name,
                            method: 'tools/call',
                            params: { name, arguments: forwarded },
                        }),
                    }),
                );
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                throw toolError(`project "${route.entry.name}" is unreachable for tool "${name}": ${message}`);
            }

            if (response.status === 401) {
                throw toolError(
                    `project "${route.entry.name}" refused the gateway's MCP token (401); point the gateway at this project's token variable (server.mcp.authEnv)`,
                );
            }
            const body = (await response.json().catch(() => null)) as {
                jsonrpc?: unknown;
                result?: unknown;
                error?: { message?: string } | null;
            } | null;
            const refusal = body?.jsonrpc === '2.0' ? body.error?.message : undefined;
            if (typeof refusal === 'string') {
                throw toolError(
                    `project "${route.entry.name}" refused tool "${name}": ${refusal.replaceAll(token, '[redacted]')}`,
                );
            }
            if (!response.ok) {
                throw toolError(
                    `project "${route.entry.name}" failed to answer tool "${name}" (${response.status}); check its serve log`,
                );
            }
            if (body === null || !Object.hasOwn(body, 'result')) {
                throw toolError(`project "${route.entry.name}" returned no result for tool "${name}"`);
            }
            // The upstream result travels unchanged (R3): the gateway never reshapes a project's answer.
            return body.result;
        },

        async listResources(): Promise<unknown[]> {
            return [];
        },

        async readResource(uri: string): Promise<unknown> {
            throw toolError(`unknown resource "${uri}": the gateway exposes no resources (resources/list is empty)`);
        },

        namespace(): string | null {
            return null;
        },

        async discoverExtras(): Promise<{ projects: unknown[]; diagnostics: unknown[] }> {
            const routes = await mcpRoutes(createNodeFileSystem());
            const collisions = collidingNamespaces(routes);
            const projects = routes.map((route) => ({
                name: route.entry.name,
                prefix: route.prefix,
                namespace: route.namespace,
            }));
            const diagnostics: Array<{ name: string; reason: string; remedy: string }> = [];
            for (const entry of await deps.listProjects()) {
                if (!isLocalHost(entry.host)) {
                    diagnostics.push({
                        name: entry.name,
                        reason: 'remote-not-proxied (ADR-151)',
                        remedy: `run the project locally and spur projects add ${entry.path}`,
                    });
                }
            }
            for (const [namespace, names] of collisions) {
                diagnostics.push({
                    name: names.join(', '),
                    reason: 'namespace-collision',
                    remedy: `namespace "${namespace}" is claimed by ${names.join(' and ')}; unset a shared SPUR_MCP_NAMESPACE override and give each project a distinct plugins/<name>/plugin.json name`,
                });
            }
            return { projects, diagnostics };
        },
    };

    /** Count every final response once, so refusals and upstream failures are not invisible (R1). */
    const handle = async (req: Request): Promise<Response> => {
        const url = new URL(req.url);
        if (deps.edge) {
            const refused = gatewayGuard(req, deps.edge);
            if (refused) {
                emit({
                    kind: refused.status === 421 ? 'guard.host' : 'guard.csrf',
                    path: url.pathname,
                    status: refused.status,
                });
                return refused;
            }
        }
        if (url.pathname === '/' || url.pathname === '') {
            return index();
        }
        // Before prefix matching: `/mcp` is the gateway's own MCP entry, never a project prefix.
        if (url.pathname === '/mcp') {
            return deps.mcp === undefined
                ? new Response('Not Found\n', { status: 404, headers: { 'content-type': 'text/plain' } })
                : deps.mcp(req, mcpRegistry);
        }
        if (url.pathname === '/api/projects/remove') {
            return removeProject(req);
        }
        const known = await localEntries();
        if (url.pathname === '/api/health') {
            return health(known, url.searchParams.get('mcpSince'));
        }

        const segments = url.pathname.split('/');
        const requested = `/${segments[1] ?? ''}`;
        const match = known.find(({ prefix }) => prefix === requested);
        if (!match) {
            const prefixes = known.map(({ prefix }) => prefix).join(', ') || '(none registered)';
            return new Response(`Unknown prefix ${requested}. Known prefixes: ${prefixes}\n`, {
                status: 404,
                headers: { 'content-type': 'text/plain; charset=utf-8' },
            });
        }

        const collisions = findPrefixCollisions(await deps.listProjects());
        const collidingNames = collisions.get(match.prefix);
        if (collidingNames) {
            emit({ kind: 'route.collision', prefix: match.prefix, names: collidingNames });
            return new Response(
                `Prefix ${match.prefix} is claimed by "${collidingNames.join('" and "')}"; ` +
                    `set one with spur projects add <path> --prefix /<other>\n`,
                { status: 409, headers: { 'content-type': 'text/plain; charset=utf-8' } },
            );
        }

        if (url.pathname === match.prefix) {
            return new Response(null, { status: 308, headers: { location: `${match.prefix}/${url.search}` } });
        }

        return proxy(req, match.entry, match.prefix, url.pathname.slice(match.prefix.length), url.search);
    };

    return async (req: Request): Promise<Response> => {
        const response = await handle(req);
        if (deps.mcp !== undefined && req.method === 'POST' && new URL(req.url).pathname === '/mcp') {
            countMcp(response.status);
        }
        counters.requests += 1;
        if (response.status >= 500) counters.status5xx += 1;
        else if (response.status >= 400) counters.status4xx += 1;
        return response;
    };
}
