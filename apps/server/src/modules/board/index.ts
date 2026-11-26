import { resolve } from 'node:path';
import { isInsideRoot, type PreparedBoardModules } from '@gobing-ai/spur-app';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import type { Context, Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';

/**
 * Symlink-resolved path, or `undefined` when the backend cannot resolve one.
 *
 * `FileSystem.realPath` is optional by contract, so absence means "cannot verify" rather than
 * "verified" — the same treatment the extension loader gives its confinement check (ADR-022).
 */
function resolvedOrUndefined(fs: FileSystem, path: string): string | undefined {
    try {
        return fs.realPath?.(path);
    } catch {
        return undefined;
    }
}

/** Mount prefix of a project module's asset tree — the `:id` segment follows (R5). */
const ASSET_PREFIX = '/modules/';

/**
 * Whether one request path is an asset request rather than the board's own deep route.
 *
 * `/modules/<id>` (no asset segment) stays an application route and must reach the SPA
 * fallback; only a path below the mount is served here.
 */
export function isModuleAssetPath(pathname: string): boolean {
    if (!pathname.startsWith(ASSET_PREFIX)) return false;
    const rest = pathname.slice(ASSET_PREFIX.length);
    const slash = rest.indexOf('/');
    return slash > 0 && rest.length > slash + 1;
}

/** Split one asset request into its module id and the still-encoded relative path. */
export function splitModuleAssetPath(pathname: string): { id: string; relative: string } | undefined {
    const rest = pathname.slice(ASSET_PREFIX.length);
    const slash = rest.indexOf('/');
    if (slash <= 0) return undefined;
    return { id: rest.slice(0, slash), relative: rest.slice(slash + 1) };
}

/** Plain-text refusal. Never HTML: a missing asset must not be answered with the SPA document. */
function refusal(status: 400 | 403 | 404 | 405, message: string): Response {
    return new Response(`${message}\n`, {
        status,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
}

/** JSON refusal in the server's `{ ok: false, error }` envelope, for the module API routes. */
function apiRefusal(status: 404 | 500, code: string, message: string): Response {
    return Response.json(
        { ok: false as const, error: { code, message } },
        { status, headers: { 'cache-control': 'no-store' } },
    );
}

/**
 * Serve one declaration's asset tree, confined to its declared directory (R5).
 *
 * Every refusal is decided here rather than by the static/SPA handlers, so an undeclared or
 * disabled root, a traversal attempt, a malformed escape, a symlink leaving the tree and a
 * genuinely missing asset each get a real 4xx instead of an index.html — the failure mode
 * that makes a browser report "Unexpected token '<'".
 */
async function serveModuleAsset(
    c: Context,
    modules: PreparedBoardModules,
    fs: FileSystem,
): Promise<Response | undefined> {
    const method = c.req.method;
    if (method !== 'GET' && method !== 'HEAD') return refusal(405, 'Method Not Allowed');

    const split = splitModuleAssetPath(c.req.path);
    if (!split) return refusal(404, 'Not Found');

    let relative: string;
    try {
        relative = decodeURIComponent(split.relative);
    } catch {
        return refusal(400, 'Malformed path encoding');
    }
    if (relative.includes('\0') || relative.split('/').some((segment) => segment === '..' || segment === '')) {
        return refusal(403, 'Forbidden path');
    }

    const declared = modules.roots.find((entry) => entry.id === split.id);
    // Undeclared, disabled and unknown ids are indistinguishable from outside.
    if (!declared) return refusal(404, 'Not Found');

    const target = resolve(declared.root, relative);
    if (!isInsideRoot(declared.root, target)) return refusal(403, 'Forbidden path');

    // Missing, non-file and dangling targets are 404s decided on the lexical path before any
    // canonical IO, after the declaration/traversal gates above.
    if (!(await fs.stat(target))?.isFile()) return refusal(404, 'Not Found');

    // Fail closed: an existing file is served only when BOTH real paths resolve and stay
    // contained. An absent `FileSystem.realPath`, a throwing backend or an escape is a 403 —
    // never the lexical fallback, which would serve symlinked outside bytes (task 1208 R2).
    const realRoot = resolvedOrUndefined(fs, declared.root);
    const realTarget = resolvedOrUndefined(fs, target);
    if (realRoot === undefined || realTarget === undefined || !isInsideRoot(realRoot, realTarget)) {
        return refusal(403, 'Forbidden path');
    }

    const file = Bun.file(realTarget);
    const headers = new Headers({
        'content-type': file.type || 'application/octet-stream',
        // Declared trees are rebuilt in place; a cached chunk would survive its own replacement.
        'cache-control': 'no-store',
    });
    return new Response(method === 'HEAD' ? null : file.stream(), { headers });
}

/** Mount prefix of a module's own backend routes (task 1455 R4). */
export const MODULE_API_PREFIX = '/api/modules';

/** One loaded backend bundle, keyed by the bundle's real path (R5). */
interface LoadedModuleApi {
    readonly mtimeMs: number;
    readonly handler: BoardModuleApiHandler | undefined;
}

/**
 * Loaded backend bundles, keyed by real path.
 *
 * Process-wide on purpose: two modules declaring the same `api` bundle share one loaded instance,
 * and a rebuilt bundle is picked up through its `mtimeMs` rather than by restarting the server.
 */
const moduleApiCache = new Map<string, LoadedModuleApi>();

/** The Web-Fetch shape a module bundle publishes — structurally the published `BoardModuleApiHandler`. */
interface BoardModuleApiHandler {
    readonly fetch: (request: Request, ctx: { projectPath: string; moduleId: string }) => Response | Promise<Response>;
}

/**
 * Split one module API path into its module id and the still-encoded module-relative suffix.
 *
 * `/api/modules/<id>` yields `suffix: ''` — the handler's root — while `/api/modules/<id>/x`
 * yields `'/x'`. A missing or empty id is not a module API path at all.
 */
export function splitModuleApiPath(pathname: string): { id: string; suffix: string } | undefined {
    if (pathname !== MODULE_API_PREFIX && !pathname.startsWith(`${MODULE_API_PREFIX}/`)) return undefined;
    const rest = pathname.slice(MODULE_API_PREFIX.length + 1);
    if (rest === '') return undefined;
    const slash = rest.indexOf('/');
    if (slash === -1) return { id: rest, suffix: '' };
    if (slash === 0) return undefined;
    return { id: rest.slice(0, slash), suffix: rest.slice(slash) };
}

/**
 * Load (or reuse) one module's backend bundle (R5).
 *
 * The cache key is the bundle's real path plus its `mtimeMs`, so a rebuild takes effect on the next
 * request while an unchanged bundle is loaded once. A bundle that exports no usable `fetch` is
 * cached as unusable rather than re-imported per request.
 *
 * shortcut: the bundle is loaded through `require` because Bun's module registry keys a module by
 * file path and ignores `?v=`/`#` cache busters, so `import()` can never see a rebuilt file. A bundle
 * relying on top-level await fails instead of reloading; upgrade to a real re-import seam if a
 * module needs TLA.
 */
async function loadModuleApi(
    fs: FileSystem,
    realApiPath: string,
    warn: (message: string) => void,
): Promise<LoadedModuleApi> {
    const stat = await fs.stat(realApiPath);
    if (!stat?.isFile()) return { mtimeMs: -1, handler: undefined };
    const cached = moduleApiCache.get(realApiPath);
    if (cached !== undefined && cached.mtimeMs === stat.mtimeMs) return cached;

    let handler: BoardModuleApiHandler | undefined;
    try {
        const loaded = await loadBundleOnce(realApiPath);
        const fetchExport = typeof loaded.fetch === 'function' ? loaded.fetch : loaded.default?.fetch;
        if (typeof fetchExport === 'function') {
            handler = { fetch: fetchExport as BoardModuleApiHandler['fetch'] };
        } else {
            warn(`board module api bundle ${realApiPath} exports no fetch handler`);
        }
    } catch (error) {
        // A bundle that fails to evaluate is a per-request 500, never a crashed server (R4).
        warn(`board module api bundle ${realApiPath} failed to load: ${(error as Error).message}`);
        handler = undefined;
    }
    const loaded: LoadedModuleApi = { mtimeMs: stat.mtimeMs, handler };
    moduleApiCache.set(realApiPath, loaded);
    return loaded;
}

/**
 * Evaluate one bundle, evicting any previous evaluation so a rebuilt file is really re-read.
 *
 * `node:module` is imported lazily: this file is also bundled for the Cloudflare Worker target,
 * where module loading cannot work and must never be evaluated at boot.
 */
async function loadBundleOnce(realApiPath: string): Promise<{ fetch?: unknown; default?: { fetch?: unknown } }> {
    const { createRequire } = await import('node:module');
    const requireBundle = createRequire(import.meta.url);
    const resolved = requireBundle.resolve(realApiPath);
    delete requireBundle.cache[resolved];
    return requireBundle(realApiPath) as { fetch?: unknown; default?: { fetch?: unknown } };
}

/**
 * Dispatch one `/api/modules/<id>/*` request to its module's Web-Fetch handler (R4/R5).
 *
 * Unknown, disabled and API-less modules are indistinguishable from outside: all three answer
 * 404 JSON, before any bundle is touched. Confinement is re-proven at request time on the real
 * paths, so a symlink introduced after startup cannot move the mount outside the project root.
 * The mount prefix is stripped with query string, method, headers and body preserved; a throwing
 * or malformed handler becomes a 500 JSON answer and the server keeps serving.
 */
async function serveModuleApi(
    c: Context,
    modules: PreparedBoardModules,
    fs: FileSystem,
    projectPath: string,
    warn: (message: string) => void,
): Promise<Response> {
    const split = splitModuleApiPath(c.req.path);
    const declared = split === undefined ? undefined : modules.roots.find((entry) => entry.id === split.id);
    if (split === undefined || declared?.apiPath === undefined) {
        return apiRefusal(404, 'MODULE_API_NOT_FOUND', 'No module API is mounted at this path');
    }

    const realProject = resolvedOrUndefined(fs, projectPath);
    const declaredApi = declared.apiPath;
    const realApi = resolvedOrUndefined(fs, declaredApi);
    if (realProject === undefined || realApi === undefined || !isInsideRoot(realProject, realApi)) {
        warn(`board module "${declared.id}" api "${declaredApi}" resolves outside the project root`);
        return apiRefusal(404, 'MODULE_API_NOT_FOUND', 'No module API is mounted at this path');
    }

    const { handler } = await loadModuleApi(fs, realApi, warn);
    if (handler === undefined) {
        return apiRefusal(500, 'MODULE_API_UNAVAILABLE', 'The module API handler is unavailable');
    }

    const url = new URL(c.req.url);
    const suffix = split.suffix === '' ? '/' : split.suffix;
    const hasBody = c.req.method !== 'GET' && c.req.method !== 'HEAD';
    // Buffered rather than streamed: a module handler is a same-process call, and a consumed
    // stream cannot be replayed by anything downstream.
    const body = hasBody ? new Uint8Array(await c.req.arrayBuffer()) : null;
    const rewritten = new Request(new URL(`${suffix}${url.search}`, url.origin).href, {
        method: c.req.method,
        headers: c.req.raw.headers,
        ...(body === null ? {} : { body }),
    });

    try {
        const response = await handler.fetch(rewritten, { projectPath, moduleId: declared.id });
        if (!(response instanceof Response)) {
            warn(`board module "${declared.id}" api handler returned a non-Response value`);
            return apiRefusal(500, 'MODULE_API_FAILED', 'The module API handler failed');
        }
        return response;
    } catch (error) {
        warn(`board module "${declared.id}" api handler threw: ${(error as Error).message}`);
        return apiRefusal(500, 'MODULE_API_FAILED', 'The module API handler failed');
    }
}

/**
 * Board module asset module.
 *
 * Registered with the other built-ins, i.e. BEFORE the static/SPA fallback mount, so a
 * declared module's assets are answered here and an asset this server does not know about
 * can never be answered with index.html (R5). Matching is per asset path: a prepared but empty
 * snapshot still refuses `/modules/<id>/<asset>` (no undeclared root is ever served) while
 * `/modules/<id>` remains the board's own deep route.
 */
export const boardModule: ServerModule = {
    name: 'board',

    mount(app: Hono, ctx: ServerContext | undefined): void {
        const modules = ctx?.boardModules;
        const fs = ctx?.fs;
        if (!modules || !fs) return;

        app.use(`${ASSET_PREFIX}*`, async (c, next) => {
            if (!isModuleAssetPath(c.req.path)) {
                await next();
                return;
            }
            return (await serveModuleAsset(c, modules, fs)) ?? next();
        });

        // 1455 R4: mounted from the same module, so a project module's backend inherits the host
        // guard + CSRF the middleware pipeline already applied and never falls into oRPC.
        const apiHandler = async (c: Context): Promise<Response> =>
            serveModuleApi(c, modules, fs, ctx.cwd, (message) => ctx.logger?.warn?.(message));
        app.use(MODULE_API_PREFIX, apiHandler);
        app.use(`${MODULE_API_PREFIX}/*`, apiHandler);
    },
};
