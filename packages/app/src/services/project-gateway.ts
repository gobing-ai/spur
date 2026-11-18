import { findPrefixCollisions, isLocalHost, type ProjectEntry, resolveProjectPrefix } from '@gobing-ai/spur-config';
import { allowedHostnames, isAllowedHost, rejectHost } from './host-guard';
import { type GatewayIndexProject, renderGatewayIndex } from './project-gateway-html';

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
    /** Start or adopt one project's `spur serve` and resolve its loopback port. */
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
 * binds `127.0.0.1` (`project-start.ts:466`), while a hand-started `spur serve` binds `localhost`,
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
    const familyByEntry = new Map<string, string>();
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

    function health(known: Array<{ entry: ProjectEntry; prefix: string }>): Response {
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
            counters: { ...counters, upstreamRestarts: { ...counters.upstreamRestarts } },
        });
    }

    async function index(): Promise<Response> {
        const entries = await deps.listProjects();
        const projects = entries.flatMap<GatewayIndexProject>((entry) => {
            if (!isLocalHost(entry.host)) return [{ entry, prefix: null }];
            const prefix = resolveProjectPrefix(entry);
            return prefix === null ? [] : [{ entry, prefix }];
        });
        return new Response(renderGatewayIndex({ port: deps.port, edge: deps.edge, projects }), {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
        });
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

        const attempt = async (family: string, port: number): Promise<Response> => {
            const authority = loopbackAuthority(family, port);
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
        };

        /** Dial each candidate family in turn, remembering whichever one answers. */
        async function dial(port: number): Promise<Response> {
            const cached = familyByEntry.get(key);
            const families = cached === undefined ? LOOPBACK_FAMILIES : [cached];
            const dialed: string[] = [];
            let lastError: unknown = null;
            for (const family of families) {
                const authority = loopbackAuthority(family, port);
                dialed.push(authority);
                try {
                    const res = await attempt(family, port);
                    familyByEntry.set(key, family);
                    return res;
                } catch (err) {
                    if (!isConnectionRefused(err)) throw err;
                    lastError = err;
                }
            }
            const message = lastError instanceof Error ? lastError.message : String(lastError);
            throw new UnreachableUpstream(dialed, message);
        }

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
        if (url.pathname === '/api/projects/remove') {
            return removeProject(req);
        }
        const known = await localEntries();
        if (url.pathname === '/api/health') {
            return health(known);
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
        counters.requests += 1;
        if (response.status >= 500) counters.status5xx += 1;
        else if (response.status >= 400) counters.status4xx += 1;
        return response;
    };
}
