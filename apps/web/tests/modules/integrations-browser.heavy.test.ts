/**
 * Real-browser proof of the Integrations module (A82 1425 R4).
 *
 * The protocol leg (`scripts/commands/integrations-e2e.ts`) proves the server; this leg proves the
 * Board renders it: a production-shaped build (`buildBoardToTemp`), served by `serveBoard`, driven by
 * real Chromium at `/board/integrations` with the status contract stubbed at the network boundary
 * (the Board under test is the module's own rendering, not a live serve).
 *
 * It writes `docs/reports/integrations-e2e-summary-{light,dark}.png` beside the protocol receipt —
 * the two artifacts the feature's AC names.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoardToTemp, removeBoardBuild } from '../test-helpers/board-build';
import { type BoardServer, serveBoard } from '../test-helpers/board-server';
import { availableBrowserBinary, type BrowserSession, launchBrowser } from '../test-helpers/cdp';

const WEB_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REPO_ROOT = join(WEB_ROOT, '..', '..');
const ARTIFACT_DIR = join(REPO_ROOT, 'docs/reports');
const ROUTE = '/board/integrations';
const browserReady = availableBrowserBinary() !== undefined;

/** The fixture the page's fetch sees, so the module renders a known, assertable state. */
const FIXTURE_STATUS = {
    generatedAt: '2026-11-22T00:00:00.000Z',
    mcp: {
        enabled: true,
        path: '/mcp',
        url: 'http://127.0.0.1:3007/mcp',
        auth: { envName: 'SPUR_MCP_TOKEN', tokenPresent: true },
        protocolVersion: '2026-07-28',
        tools: [
            {
                name: 'sp_task_list',
                origin: 'built-in',
                description: 'List tasks',
                annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
                inputSchema: { type: 'object' },
            },
        ],
        resources: [{ uriTemplate: 'spur://tasks/{wbs}', description: 'Task by WBS' }],
    },
    a2a: {
        enabled: true,
        basePath: '/a2a',
        auth: { envName: 'SPUR_A2A_TOKEN', tokenPresent: false },
        inbound: [
            {
                member: 'proof-coder',
                role: 'coder',
                cardUrl: 'http://127.0.0.1:3007/a2a/members/proof-coder/.well-known/agent-card.json',
                writeFenced: true,
            },
        ],
        outbound: [{ member: 'proof-peer', kind: 'a2a', target: 'https://peer.example' }],
    },
    gateway: { served: false },
};

const FIXTURE_USAGE = {
    tools: [
        { tool: 'sp_task_list', calls: 3, failures: 1, failureRate: 0.25, p50Ms: 4, p95Ms: 9, durationUnmeasured: 0 },
    ],
    resources: [],
    byActor: [],
    a2a: [{ member: 'proof-coder', received: 1, replayed: 0, conflict: 0, cancelled: 0 }],
    authDenied: [{ surface: 'mcp', reason: 'missing', count: 2 }],
    failureClusters: [],
};

/** Serve every `/api` read the module performs from fixtures; everything else hits the real server. */
const API_STUB = `
(() => {
  const status = ${JSON.stringify(FIXTURE_STATUS)};
  const usage = ${JSON.stringify(FIXTURE_USAGE)};
  const events = [{ id: 'e1', eventName: 'mcp.tool.called', occurredAt: '2026-11-22T01:00:00.000Z', runId: null,
    payload: { data: { tool: 'sp_task_list', durationMs: 12, outcome: 'ok' } } }];
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    const path = url.pathname;
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path.endsWith('/api/integrations/status')) return json(status);
    if (path.endsWith('/api/integrations/usage')) return json(usage);
    if (path.endsWith('/api/inbox/requests')) return json([]);
    if (path.endsWith('/api/inbox/messages')) return json({ messages: [], nextCursor: null });
    if (path.endsWith('/api/events/history')) return json({ events });
    return original(input, init);
  };
})();
`;

let build: string;
let server: BoardServer;
let browser: BrowserSession;
let page: string;

/** Read one value out of the page. */
async function dom<T>(expression: string): Promise<T> {
    return browser.evaluate<T>(expression, { sessionId: page });
}

/** Save one PNG of the current page. */
async function screenshot(name: 'light' | 'dark'): Promise<string> {
    const result = (await browser.send('Page.captureScreenshot', { format: 'png' }, page)) as { data: string };
    const target = join(ARTIFACT_DIR, `integrations-e2e-summary-${name}.png`);
    writeFileSync(target, Buffer.from(result.data, 'base64'));
    return target;
}

beforeAll(async () => {
    if (!browserReady) return;
    build = await buildBoardToTemp();
    server = serveBoard(build);
    browser = await launchBrowser();
    page = await browser.newPage();
    // Installed before every document, so the module's first read is already stubbed.
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: API_STUB }, page);
}, 600_000);

afterAll(async () => {
    await browser?.close();
    server?.stop();
    if (build) removeBoardBuild(build);
});

describe('Integrations module (browser)', () => {
    test.skipIf(!browserReady)(
        'renders one Summary row per surface, then writes the light and dark screenshots',
        async () => {
            mkdirSync(ARTIFACT_DIR, { recursive: true });
            await browser.navigate(`http://127.0.0.1:${server.port}${ROUTE}`, page);
            await browser.waitFor('Boolean(document.querySelector("[data-testid=integrations-summary-table]"))', {
                sessionId: page,
                label: 'integrations summary',
                timeoutMs: 30_000,
            });

            const surfaces = await dom<string[]>(
                'Array.from(document.querySelectorAll("[data-testid^=integrations-row-]")).map((el) => el.getAttribute("data-testid"))',
            );
            expect(surfaces.sort()).toEqual([
                'integrations-row-a2a-inbound',
                'integrations-row-a2a-outbound',
                'integrations-row-gateway-mcp',
                'integrations-row-project-mcp',
            ]);
            // The A2A row is the token-unset case: enabled, its bearer variable empty.
            const a2aRow = await dom<string>(
                'document.querySelector("[data-testid=integrations-row-a2a-inbound]")?.textContent ?? ""',
            );
            expect(a2aRow).toContain('on · token unset');

            const light = await screenshot('light');
            await dom('document.documentElement.setAttribute("data-theme", "dark")');
            await Bun.sleep(150);
            const dark = await screenshot('dark');

            // Both artifacts exist where the receipt expects them.
            expect(light).toEndWith('integrations-e2e-summary-light.png');
            expect(dark).toEndWith('integrations-e2e-summary-dark.png');
        },
        300_000,
    );

    test.skipIf(!browserReady)(
        'the MCP and A2A tabs render from the same status read',
        async () => {
            await browser.navigate(`http://127.0.0.1:${server.port}${ROUTE}`, page);
            await browser.waitFor('Boolean(document.querySelector("[data-testid=integrations-summary-table]"))', {
                sessionId: page,
                label: 'integrations summary',
                timeoutMs: 30_000,
            });
            await browser.click('#integrations-tab-mcp', page);
            await browser.waitFor('Boolean(document.querySelector("[data-testid=integrations-mcp-tools]"))', {
                sessionId: page,
                label: 'mcp tab',
                timeoutMs: 15_000,
            });
            expect(
                await dom<string>(
                    'document.querySelector("[data-testid=integrations-mcp-snippet]")?.textContent ?? ""',
                ),
            ).toContain(`\${SPUR_MCP_TOKEN}`);

            await browser.click('#integrations-tab-a2a', page);
            await browser.waitFor('Boolean(document.querySelector("[data-testid=integrations-a2a-members]"))', {
                sessionId: page,
                label: 'a2a tab',
                timeoutMs: 15_000,
            });
            expect(
                await dom<string>(
                    'document.querySelector("[data-testid=integrations-a2a-member-proof-coder] a")?.getAttribute("href") ?? ""',
                ),
            ).toContain('/a2a/members/proof-coder/');
        },
        300_000,
    );
});
