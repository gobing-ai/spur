/**
 * Static board server for the browser proofs (task 0988 R4, task 0992 R1/R3).
 *
 * Mirrors the behaviours the proofs depend on from `spur serve`'s board path
 * (`apps/server/src/bootstrap.ts` `createApp` and `apps/server/src/modules/board/index.ts`):
 * extension-derived MIME types (browsers refuse ES modules served without a JS content type), the
 * SPA fallback that makes a deep link a real page load, the read-only `GET /api/board/modules`
 * catalog and the `/modules/:id/*` asset tree with `no-store` and a plain-text 4xx for anything
 * undeclared. Kept here rather than importing `apps/server` because `apps/web` does not depend on
 * that workspace; `apps/server/tests/board-modules.test.ts` owns the real handlers' behaviour.
 */
import { extname, join, normalize, sep } from 'node:path';
import type { BoardCatalog } from '@gobing-ai/spur-contracts';

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
};

/** A listening board server. */
export interface BoardServer {
    readonly origin: string;
    readonly port: number;
    stop(): void;
}

/**
 * Optional composition inputs for {@link serveBoard}.
 *
 * Omitting both yields the built-ins-only board of task 0988. Supplying a `catalog` makes the
 * shipped `BoardApp` take its real catalog path (`GET /api/board/modules` -> `composeBoardModules`
 * -> registry provider), and `moduleAssets` backs the `/modules/:id/*` asset trees those catalog
 * descriptors name.
 */
export interface BoardServeOptions {
    /** Catalog answered by `GET /api/board/modules` (task 0989 R4 shape). */
    readonly catalog?: BoardCatalog;
    /** Module id -> absolute asset directory, served read-only under `/modules/<id>/*` (R5). */
    readonly moduleAssets?: Readonly<Record<string, string>>;
    /** Fixed TCP port, for same-origin restart proofs; omit for an ephemeral port. */
    readonly port?: number;
}

/** Plain-text refusal, so a missing module asset is never answered with the SPA document. */
function refusal(status: 404 | 405, message: string): Response {
    return new Response(`${message}\n`, {
        status,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
}

/** Serve one request from a declared module asset tree, confined to its directory. */
async function serveModuleAsset(
    pathname: string,
    method: string,
    assets: Readonly<Record<string, string>>,
): Promise<Response> {
    if (method !== 'GET' && method !== 'HEAD') return refusal(405, 'Method Not Allowed');
    const rest = pathname.slice('/modules/'.length);
    const slash = rest.indexOf('/');
    if (slash <= 0) return refusal(404, 'Not Found');
    const id = rest.slice(0, slash);
    const root = assets[id];
    if (!root) return refusal(404, 'Not Found');
    let relative: string;
    try {
        relative = decodeURIComponent(rest.slice(slash + 1));
    } catch {
        return refusal(404, 'Not Found');
    }
    if (relative.split('/').some((segment) => segment === '..' || segment === '')) {
        return refusal(404, 'Not Found');
    }
    const file = Bun.file(join(root, relative));
    if (!(await file.exists())) return refusal(404, 'Not Found');
    return new Response(method === 'HEAD' ? null : file.stream(), {
        headers: {
            'content-type': MIME[extname(relative)] ?? file.type,
            'cache-control': 'no-store',
        },
    });
}

/** Serve `distDir` on an ephemeral (or fixed, `options.port`) port, with SPA fallback for client routes. */
export function serveBoard(distDir: string, options: BoardServeOptions = {}): BoardServer {
    const server = Bun.serve({
        port: options.port ?? 0,
        hostname: '127.0.0.1',
        async fetch(request) {
            const pathname = decodeURIComponent(new URL(request.url).pathname);
            const relative = normalize(pathname).replace(/^([./\\])+/, '');
            if (pathname === '/api/board/modules' && options.catalog) {
                return new Response(JSON.stringify(options.catalog), {
                    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
                });
            }
            if (pathname.startsWith('/api')) {
                return new Response(JSON.stringify({ error: 'Not Found' }), {
                    status: 404,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (options.moduleAssets && pathname.startsWith('/modules/')) {
                return serveModuleAsset(pathname, request.method, options.moduleAssets);
            }
            if (!relative.split(sep).includes('..')) {
                const file = Bun.file(join(distDir, relative === '' ? 'index.html' : relative));
                if (await file.exists()) {
                    const contentType = MIME[extname(relative)] ?? file.type;
                    return new Response(file.stream(), { headers: { 'content-type': contentType } });
                }
            }
            // SPA fallback: any client route resolves to the board document (deep links work).
            const index = Bun.file(join(distDir, 'index.html'));
            if (await index.exists()) {
                return new Response(index.stream(), {
                    headers: { 'content-type': 'text/html; charset=utf-8' },
                });
            }
            return new Response('Not Found', { status: 404 });
        },
    });
    const port = server.port;
    if (port === undefined) throw new Error('board server did not bind a TCP port');
    return {
        origin: `http://127.0.0.1:${port}`,
        port,
        stop: () => server.stop(true),
    };
}
