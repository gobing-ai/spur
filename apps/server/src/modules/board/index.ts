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
    },
};
