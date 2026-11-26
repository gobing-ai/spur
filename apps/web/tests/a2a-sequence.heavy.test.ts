/**
 * The A2A cooperation sequence at the compact breakpoint (A821 1454, R7 / AC7) — `test:heavy` only.
 *
 * The unit suite pins the grid, the filters and the tooltip content against a stubbed client, but it
 * cannot prove the **breakpoint**: `(max-width: 639px)` is decided by `matchMedia`, which only a real
 * engine evaluates against a real layout viewport. So this proof builds the production-shaped board,
 * serves it beside a fixture API (a status, a usage window and three timeline rows), and drives
 * Chromium over CDP at 639 px wide:
 *
 * 1. the sequence renders as a stacked `sender → receiver · kind · status · time` list, and the grid
 *    is absent from the document (not merely hidden);
 * 2. a row's tooltip still opens on keyboard focus, so the compact layout loses no detail;
 * 3. widening the viewport to 1280 px restores the grid — the list is the breakpoint's answer, not a
 *    different render path that happens to be shipping.
 *
 * The Board build is a real `astro build` into a temp dir (`buildBoardToTemp`), never a stale
 * `dist/web`; the fixture API answers the same shapes `apps/server` projects, so the module parses a
 * status instead of degrading to its diagnostic.
 */
import { expect, test } from 'bun:test';
import { buildBoardToTemp, removeBoardBuild } from './test-helpers/board-build';
import { serveBoard } from './test-helpers/board-server';
import { availableBrowserBinary, type BrowserSession, launchBrowser } from './test-helpers/cdp';

/** Three rows: a request, its reply, and a self-message the sequence must draw as a loop. */
const NOW = Date.now();
const ROWS = [
    {
        id: 'm1',
        fromId: 'operator',
        toId: 'proj-coder',
        body: 'implement task 1454',
        kind: 'request',
        status: 'delivered',
        attempts: 1,
        error: null,
        claimedAt: NOW - 2_800,
        deliveredAt: NOW - 2_600,
        readAt: NOW - 2_400,
        inReplyTo: null,
        threadId: 'm1',
        requestKey: 'a2a:proj-coder:m1',
        taskId: null,
        parentRunId: null,
        createdAt: NOW - 3_000,
    },
    {
        id: 'm2',
        fromId: 'proj-coder',
        toId: 'operator',
        body: 'the lane is fenced',
        kind: 'chat',
        status: 'claimed',
        attempts: 1,
        error: null,
        claimedAt: NOW - 1_900,
        deliveredAt: null,
        readAt: null,
        inReplyTo: 'm1',
        threadId: 'm1',
        requestKey: null,
        taskId: null,
        parentRunId: null,
        createdAt: NOW - 2_000,
    },
    {
        id: 'm3',
        fromId: 'proj-coder',
        toId: 'proj-coder',
        body: 'note to self',
        kind: 'chat',
        status: 'queued',
        attempts: 0,
        error: null,
        claimedAt: null,
        deliveredAt: null,
        readAt: null,
        inReplyTo: null,
        threadId: 'm3',
        requestKey: null,
        taskId: null,
        parentRunId: null,
        createdAt: NOW - 1_000,
    },
];

/** The status the Board parses: one inbound member (its card is fetchable) and one outbound peer. */
const STATUS = {
    generatedAt: new Date(NOW).toISOString(),
    mcp: {
        enabled: false,
        path: '/mcp',
        url: null,
        auth: { envName: '', tokenPresent: false },
        protocolVersion: '2026-07-28',
        tools: [],
        resources: [],
    },
    a2a: {
        enabled: true,
        basePath: '/a2a',
        auth: { envName: 'SPUR_A2A_TOKEN', tokenPresent: false },
        members: [
            {
                member: 'proj-coder',
                direction: 'inbound',
                role: 'coder',
                cardUrl: '/a2a/members/proj-coder/.well-known/agent-card.json',
                writeFenced: true,
            },
            {
                member: 'proj-peer',
                direction: 'outbound',
                kind: 'a2a',
                target: 'https://peer.example',
                auth: { envName: 'PEER_A2A_TOKEN', tokenPresent: false },
            },
        ],
    },
    gateway: { served: false },
};

const USAGE = {
    tools: [],
    resources: [],
    byActor: [],
    a2a: [],
    authDenied: [],
    failureClusters: [],
};

const CARD = {
    name: 'proj-coder',
    description: 'Spur fleet member proj-coder (claude)',
    version: '1.0.0',
    supportedInterfaces: [{ url: 'http://localhost/a2a/members/proj-coder', protocolVersion: '1.0' }],
    skills: [{ id: 'coder', name: 'coder', description: 'writes the code', tags: ['coder'] }],
};

/** The fixture API the module talks to, in the shapes `apps/server` projects. */
async function fixtureApi(distDir: string): Promise<{ origin: string; stop: () => void }> {
    // The built board itself comes from the shared static server: MIME types, the SPA fallback and
    // the module asset tree are exactly what a real `spur self serve` answers.
    const staticServer = serveBoard(distDir);
    const api = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        // The planning stream is held open; a non-zero idle timeout would cut it mid-proof.
        idleTimeout: 0,
        async fetch(request) {
            const url = new URL(request.url);
            const path = url.pathname;
            if (path === '/api/health') {
                return Response.json({ status: 'ok', service: 'spur', version: '0.0.0-heavy', uptime_seconds: 90 });
            }
            if (path === '/api/integrations/status') return Response.json(STATUS);
            if (path === '/api/integrations/usage') return Response.json(USAGE);
            if (path === '/api/integrations/agent-readiness') return Response.json({ available: false, agents: [] });
            if (path === '/api/events/history') return Response.json({ events: [] });
            if (path === '/api/inbox/requests') return Response.json([]);
            if (path === '/api/inbox/messages') return Response.json({ messages: [], nextCursor: null });
            if (path === '/api/inbox/timeline') return Response.json({ messages: ROWS, nextCursor: null });
            if (path.endsWith('/.well-known/agent-card.json')) return Response.json(CARD);
            if (path === '/api/events/planning') {
                // One comment frame keeps the EventSource open for the length of the proof.
                const stream = new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(': connected\n\n'));
                    },
                });
                return new Response(stream, {
                    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
                });
            }
            if (path.startsWith('/api')) return Response.json({ error: 'not found' }, { status: 404 });
            // Everything else is the built board: assets, the SPA document and its deep-link fallback.
            return fetch(`${staticServer.origin}${path}${url.search}`);
        },
    });
    const port = api.port;
    if (port === undefined) throw new Error('the fixture API did not bind a TCP port');
    return {
        origin: `http://127.0.0.1:${port}`,
        stop: () => {
            api.stop(true);
            staticServer.stop();
        },
    };
}

const browserReady = availableBrowserBinary() !== undefined;

test.skipIf(!browserReady)(
    'AC7 — at 639 px the sequence is a stacked list and its tooltip still opens',
    async () => {
        // The build, the fixture server and the browser live inside the test body so the test's own
        // timeout bounds them: a `beforeAll` hook runs under bun's 5 s default, which a cold
        // `astro build` legitimately exceeds.
        let page: string | undefined;
        let browser: BrowserSession | undefined;
        let server: { stop: () => void } | undefined;
        let build: string | undefined;
        try {
            build = await buildBoardToTemp();
            const fixture = await fixtureApi(build);
            server = { stop: fixture.stop };
            browser = await launchBrowser();
            page = await browser.newPage();
            const session = page;

            /** Read one DOM value from the page. */
            const dom = async <T>(expression: string): Promise<T> =>
                browser?.evaluate<T>(expression, { sessionId: session }) as Promise<T>;
            /** Wait for a CSS selector, so a failure names the selector instead of dying on a null. */
            const waitForSelector = async (selector: string, label: string, timeoutMs = 20_000): Promise<void> => {
                await browser?.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, {
                    sessionId: session,
                    label,
                    timeoutMs,
                });
            };

            // The breakpoint is the layout viewport's width; CDP emulation is what changes it.
            await browser.send(
                'Emulation.setDeviceMetricsOverride',
                { width: 639, height: 900, deviceScaleFactor: 1, mobile: true },
                session,
            );
            await browser.navigate(`${fixture.origin}/board/integrations`, session);
            await waitForSelector('[data-testid=integrations-summary-table]', 'the Integrations module');
            await browser.click('#integrations-tab-a2a', session);

            await waitForSelector('[data-testid=integrations-a2a-sequence-stacked]', 'the compact sequence list');
            // Not a hidden grid: the compact layout replaces it, so nothing needs horizontal scrolling.
            expect(
                await dom<boolean>("Boolean(document.querySelector('[data-testid=integrations-a2a-sequence-grid]'))"),
            ).toBe(false);

            const rows = await dom<string[]>(
                "Array.from(document.querySelectorAll('[data-testid^=integrations-a2a-stacked-]'), (row) => row.textContent)",
            );
            expect(rows).toHaveLength(3);
            // `sender → receiver · kind · status · time`, with the status as text (never color alone).
            expect(rows[0]).toContain('operator → proj-coder');
            expect(rows[0]).toContain('request');
            expect(rows[0]).toContain('delivered');
            expect(rows[0]).toMatch(/\d{1,2}:\d{2}/);
            expect(rows[1]).toContain('proj-coder → operator');
            expect(rows[1]).toContain('claimed');
            // A self-message is a loop, not a second column.
            expect(rows[2]).toContain('proj-coder ↺');
            // The filter row survives the compact layout.
            expect(
                await dom<boolean>("Boolean(document.querySelector('[data-testid=integrations-a2a-filters]'))"),
            ).toBe(true);

            // So do the lifelines: the stacked list still lists its addresses, so the card and
            // credential tooltips stay reachable at 639 px.
            await waitForSelector(
                '[data-testid=integrations-a2a-lane-trigger-proj-coder]',
                'the compact lifeline header',
            );

            // The tooltip is reachable without a pointer: keyboard focus opens the same panel.
            await dom<null>("document.querySelector('[data-testid=integrations-a2a-arrow-trigger-m1]').focus()");
            await waitForSelector('[data-testid=integrations-a2a-arrow-detail-m1]', 'the arrow tooltip');
            const detail = await dom<string>(
                "document.querySelector('[data-testid=integrations-a2a-arrow-detail-m1]').textContent",
            );
            expect(detail).toContain('implement task 1454');
            expect(detail).toContain('a2a:proj-coder:m1');
            expect(
                await dom<string>(
                    "document.querySelector('[data-testid=integrations-a2a-arrow-detail-panel-m1]').getAttribute('role')",
                ),
            ).toBe('tooltip');

            // Widening past the breakpoint restores the grid: the list is the breakpoint's answer.
            await browser.send(
                'Emulation.setDeviceMetricsOverride',
                { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
                session,
            );
            await waitForSelector('[data-testid=integrations-a2a-sequence-grid]', 'the desktop grid');
            expect(
                await dom<boolean>(
                    "Boolean(document.querySelector('[data-testid=integrations-a2a-sequence-stacked]'))",
                ),
            ).toBe(false);
        } finally {
            await browser?.close();
            server?.stop();
            await removeBoardBuild(build);
        }
    },
    { timeout: 300_000 },
);
