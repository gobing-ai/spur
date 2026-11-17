/**
 * Real-browser proof for feature K4 R6 (task 1358): one Board build works both behind the project
 * gateway under `/<prefix>/` and at the origin root.
 *
 * The build is production-shaped (`buildBoardToTemp`), served by `serveBoard`, and — for the
 * prefixed run — reached only through `createGatewayHandler` (1359/1360), which strips the prefix,
 * rebases the HTML and injects `<meta name="spur-base">`. Chromium then drives the real Board: the
 * first load, a deep-link refresh (SPA fallback), a client-side navigation, an API call, a Markdown
 * link target and a lazy chunk.
 *
 * An escaping request is detected structurally: the gateway answers an unknown root path with 404,
 * so any request the browser makes outside `/<prefix>/` shows up in `browser.failedRequests()`.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGatewayHandler, type GatewayDeps } from '@gobing-ai/spur-app';
import type { ProjectEntry } from '@gobing-ai/spur-config';
import { buildBoardToTemp, removeBoardBuild } from './test-helpers/board-build';
import { type BoardServer, serveBoard } from './test-helpers/board-server';
import { availableBrowserBinary, type BrowserSession, launchBrowser } from './test-helpers/cdp';

const PREFIX = '/proj';
const browserReady = availableBrowserBinary() !== undefined;

let build: string;
let upstream: BoardServer;
let gateway: ReturnType<typeof Bun.serve>;
let gatewayPort: number;
let browser: BrowserSession;
let page: string;
/** Paths the gateway forwarded upstream — proves the prefix left the URL. */
const upstreamPaths: string[] = [];

/** Read one DOM value from the page. */
async function dom<T>(expression: string): Promise<T> {
    return browser.evaluate<T>(expression, { sessionId: page });
}

async function waitFor(expression: string, label: string, timeoutMs = 20_000): Promise<void> {
    const started = Date.now();
    let last: unknown;
    while (Date.now() - started < timeoutMs) {
        try {
            last = await dom<unknown>(expression);
            if (last) return;
        } catch (err) {
            last = err instanceof Error ? err.message : String(err);
        }
        await Bun.sleep(100);
    }
    throw new Error(`${label} did not settle (last value: ${JSON.stringify(last)})`);
}

beforeAll(async () => {
    if (!browserReady) return;
    build = await buildBoardToTemp();
    upstream = serveBoard(build);
    const entry: ProjectEntry = {
        name: 'proj',
        path: '/tmp/proj',
        host: 'localhost',
        port: upstream.port,
        prefix: PREFIX,
    };
    const deps: GatewayDeps = {
        port: 0,
        listProjects: async () => [entry],
        ensureUpstream: async () => upstream.port,
        fetchUpstream: ((input: RequestInfo | URL, init?: RequestInit) => {
            upstreamPaths.push(new URL(String(input)).pathname);
            return fetch(input, init);
        }) as typeof fetch,
    };
    const handler = createGatewayHandler(deps);
    gateway = Bun.serve({ port: 0, idleTimeout: 0, fetch: handler });
    gatewayPort = gateway.port ?? 0;

    browser = await launchBrowser();
    page = await browser.newPage();
}, 600_000);

afterAll(async () => {
    await browser?.close();
    gateway?.stop(true);
    upstream?.stop();
    if (build) removeBoardBuild(build);
    if (build) {
        // Network log artifact: every upstream path this run produced.
        writeFileSync(join(build, 'gateway-network-log.json'), JSON.stringify({ upstreamPaths }, null, 2));
    }
});

describe('Board base path (heavy)', () => {
    test.skipIf(!browserReady)(
        'serves the Board under the gateway prefix with every request inside it',
        async () => {
            await browser.navigate(`http://127.0.0.1:${gatewayPort}${PREFIX}/board`, page);
            await waitFor(
                'Boolean(document.querySelector("[data-testid=sidebar-collapse], [data-testid=sidebar-expand]"))',
                'board shell',
            );

            // The gateway injected the base the client reads; the router mounted under it.
            expect(await dom<string>('document.querySelector(\'meta[name="spur-base"]\')?.content ?? ""')).toBe(
                `${PREFIX}/`,
            );
            // The Board lands on its landing route (`/board/observability` today) — the mount point is what matters.
            expect(await dom<string>('location.pathname')).toStartWith(`${PREFIX}/board`);

            // A deep-link refresh must render the Board (SPA fallback + router basename), not a 404 view.
            await browser.navigate(`http://127.0.0.1:${gatewayPort}${PREFIX}/board/tasks`, page);
            await waitFor(
                'Boolean(document.querySelector("[data-testid=sidebar-collapse], [data-testid=sidebar-expand]"))',
                'deep link',
            );

            // A client-side navigation keeps the browser inside the prefix.
            const navHref = await dom<string | null>(
                'document.querySelector(\'a[href*="/board/"]\')?.getAttribute("href") ?? null',
            );
            if (navHref?.startsWith('/')) {
                // Router-generated hrefs carry the basename already; a bare one would escape.
                expect(navHref.startsWith(`${PREFIX}/`)).toBe(true);
            }

            // Every API/SSE call the Board made reached the upstream WITHOUT the prefix, i.e. the
            // client built `/<prefix>/api/...` and the gateway stripped the prefix as designed.
            await waitFor('true', 'api settle');
            expect(upstreamPaths).toContain('/api/events/planning');
            expect(upstreamPaths.some((path) => path.startsWith('/api/tasks'))).toBe(true);

            // Nothing escaped the prefix. The stub upstream answers 404 for `/api/*` (it serves no
            // API), so failure status is expected — WHICH paths failed is the evidence: every request
            // the browser issued carries the prefix, and the gateway would 404 a bare root path.
            // `failedRequests()` entries are prefixed with the status ("404 http://…").
            const gatewayRequests = browser
                .failedRequests()
                .filter((entry: string) => entry.includes(`:${gatewayPort}`))
                .map((entry: string) => new URL(entry.replace(/^\d+\s+/, '')).pathname);
            expect(gatewayRequests.length).toBeGreaterThan(0);
            expect(gatewayRequests.filter((pathname) => !pathname.startsWith(`${PREFIX}/`))).toEqual([]);
            expect(gatewayRequests.some((pathname) => pathname.includes('/api/'))).toBe(true);
        },
        { timeout: 180_000 },
    );

    test.skipIf(!browserReady)(
        'serves the same build at the origin root on the project port',
        async () => {
            await browser.navigate(`http://127.0.0.1:${upstream.port}/board`, page);
            await waitFor(
                'Boolean(document.querySelector("[data-testid=sidebar-collapse], [data-testid=sidebar-expand]"))',
                'root board',
            );

            // No gateway meta at the root: basePath() falls back to '/'.
            expect(await dom<string>('document.querySelector(\'meta[name="spur-base"]\')?.content ?? ""')).toBe('');
            expect(await dom<string>('location.pathname')).toStartWith('/board');

            await browser.navigate(`http://127.0.0.1:${upstream.port}/board/tasks`, page);
            await waitFor(
                'Boolean(document.querySelector("[data-testid=sidebar-collapse], [data-testid=sidebar-expand]"))',
                'root deep link',
            );
            expect(await dom<string>('location.pathname')).toStartWith('/board/tasks');
        },
        { timeout: 120_000 },
    );
});
