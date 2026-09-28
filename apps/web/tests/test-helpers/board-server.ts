/**
 * Static board server for the browser proof (task 0988 R4).
 *
 * Mirrors the two behaviours the proof depends on from `spur serve`'s board path
 * (`apps/server/src/bootstrap.ts` `createApp`): extension-derived MIME types (browsers refuse ES
 * modules served without a JS content type) and the SPA fallback that makes a deep link a real page
 * load. Kept here rather than importing `apps/server` because `apps/web` does not depend on that
 * workspace; `apps/server/tests/static-assets.test.ts` owns the real handler's behaviour.
 */
import { extname, join, normalize, sep } from 'node:path';

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

/** Serve `distDir` on an ephemeral port, with SPA fallback for client routes. */
export function serveBoard(distDir: string): BoardServer {
    const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        async fetch(request) {
            const pathname = decodeURIComponent(new URL(request.url).pathname);
            const relative = normalize(pathname).replace(/^([./\\])+/, '');
            if (pathname.startsWith('/api')) {
                return new Response(JSON.stringify({ error: 'Not Found' }), {
                    status: 404,
                    headers: { 'content-type': 'application/json' },
                });
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
