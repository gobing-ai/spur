/**
 * Frame fixtures and their explicit headers (task 0988 R5).
 *
 * Both fixtures are owned by the repository and served on SEPARATE origins (different ports =
 * different origins, exactly the conditions of a real ambient deployment). The harness document
 * itself is served on a third origin.
 *
 * The denying fixture uses both mechanisms a real application would: `Content-Security-Policy:
 * frame-ancestors 'none'` and `X-Frame-Options: DENY`. Nothing here weakens them.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/frames/', import.meta.url));

/** One served fixture origin. */
export interface FrameFixtureServer {
    readonly origin: string;
    readonly permittedUrl: string;
    readonly deniedUrl: string;
    stop(): void;
}

/** One served harness origin. */
export interface FrameHarnessServer {
    /** URL of the harness document with both fixture URLs substituted. */
    readonly url: string;
    stop(): void;
}

/** Headers each fixture document is served with. */
const PERMITTED_HEADERS = {
    'content-type': 'text/html; charset=utf-8',
    // Frameable by the harness origin (and therefore any ancestor — this app opts in).
    'content-security-policy': 'frame-ancestors *',
};

const DENIED_HEADERS = {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "frame-ancestors 'none'",
    'x-frame-options': 'DENY',
};

/** Serve the permitting app and the denying app on two ephemeral origins. */
export async function serveFrameFixtures(): Promise<FrameFixtureServer> {
    const permittedHtml = await readFile(join(FIXTURE_DIR, 'permitted.html'), 'utf-8');
    const deniedHtml = await readFile(join(FIXTURE_DIR, 'denied.html'), 'utf-8');

    const permitted = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: () => new Response(permittedHtml, { headers: PERMITTED_HEADERS }),
    });
    const denied = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: () => new Response(deniedHtml, { headers: DENIED_HEADERS }),
    });

    const permittedPort = permitted.port;
    const deniedPort = denied.port;
    if (permittedPort === undefined || deniedPort === undefined) {
        throw new Error('frame fixture servers did not bind TCP ports');
    }
    return {
        origin: `http://127.0.0.1:${permittedPort}`,
        permittedUrl: `http://127.0.0.1:${permittedPort}/permitted.html`,
        deniedUrl: `http://127.0.0.1:${deniedPort}/denied.html`,
        stop: () => {
            permitted.stop(true);
            denied.stop(true);
        },
    };
}

/** Serve the harness document (both fixture URLs substituted in) on its own origin. */
export async function serveFrameHarness(fixtures: FrameFixtureServer): Promise<FrameHarnessServer> {
    const template = await readFile(join(FIXTURE_DIR, 'harness.html'), 'utf-8');
    const html = template
        .replace('__PERMITTED_URL__', fixtures.permittedUrl)
        .replace('__DENIED_URL__', fixtures.deniedUrl);
    const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    });
    const port = server.port;
    if (port === undefined) throw new Error('frame harness server did not bind a TCP port');
    return {
        url: `http://127.0.0.1:${port}/harness.html`,
        stop: () => server.stop(true),
    };
}
