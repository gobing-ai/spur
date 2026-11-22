/**
 * A83 1430 R6 — a real browser loads every built-in Board module and leaves an artifact.
 *
 * `buildBoardToTemp` builds the Board once, `serveBoard` serves it without a project API (data
 * calls fail by design — each module's own tests own their data), and real Chromium visits
 * `/board/<route>` for the ten built-in modules. Per module it asserts the kit shell, one kit
 * header whose icon is an `<svg>`, no module-error-boundary fallback, no asset/MIME failure, and no
 * uncaught page error. The sidebar is checked for emoji text, and every module gets a screenshot.
 *
 * The receipt (`docs/reports/board-maturity-e2e-receipt.json`, stable name, overwritten) is written
 * even when an assertion fails, so a red run still leaves the failing rows behind.
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
const RECEIPT_DIR = join(REPO_ROOT, 'docs/reports');
const RECEIPT = join(RECEIPT_DIR, 'board-maturity-e2e-receipt.json');
const browserReady = availableBrowserBinary() !== undefined;

/** The frozen built-in module list (A83 1430 R1): id and route, nothing discovered at runtime. */
const MODULES = [
    { id: 'designs', route: 'designs', title: 'Designs' },
    { id: 'features', route: 'features', title: 'Features' },
    { id: 'history', route: 'history', title: 'Histories' },
    { id: 'integrations', route: 'integrations', title: 'Integrations' },
    { id: 'observability', route: 'observability', title: 'Observabilities' },
    { id: 'plans', route: 'plans', title: 'Plans' },
    { id: 'projects', route: 'projects', title: 'Projects' },
    { id: 'search', route: 'search', title: 'Search' },
    { id: 'settings', route: 'settings', title: 'Settings' },
    { id: 'tasks', route: 'tasks', title: 'Tasks' },
] as const;

/** One module's row in the receipt. */
interface ModuleRow {
    id: string;
    route: string;
    shell: boolean;
    icon: boolean;
    errors: string[];
    screenshot: string | null;
}

const rows: ModuleRow[] = [];
const sidebar: { entries: number; withSvg: number; emoji: string[] } = { entries: 0, withSvg: 0, emoji: [] };

let build: string;
let server: BoardServer;
let browser: BrowserSession;
let page: string;

/** Read one JSON value out of the page. */
async function dom<T>(expression: string): Promise<T> {
    return browser.evaluate<T>(expression, { sessionId: page });
}

/**
 * Asset/MIME failures only. Every `/api/*` read fails here BY DESIGN: `serveBoard` serves the static
 * build without a project API, and each module's own test owns its data path.
 */
function assetFailures(): string[] {
    return browser
        .failedRequests()
        .filter((url) => !url.includes('/api/'))
        .filter((url) => !url.includes('/rpc/'));
}

/** Page-level errors: an uncaught exception or a CSP violation. */
function pageErrors(): string[] {
    return browser
        .logEntries()
        .filter((entry) => entry.level === 'error')
        .map((entry) => entry.text ?? '')
        .filter((text) => /uncaught|content security policy/i.test(text));
}

beforeAll(async () => {
    if (!browserReady) return;
    build = await buildBoardToTemp();
    server = serveBoard(build);
    browser = await launchBrowser();
    page = await browser.newPage();
}, 600_000);

afterAll(async () => {
    await browser?.close();
    server?.stop();
    if (build) removeBoardBuild(build);
});

/** Write the receipt (always, including on failure) and return the path. */
function writeReceipt(): string {
    mkdirSync(RECEIPT_DIR, { recursive: true });
    writeFileSync(
        RECEIPT,
        `${JSON.stringify(
            {
                artifact: 'board-maturity-e2e',
                generatedAt: new Date().toISOString(),
                sidebar,
                modules: rows,
                passed: rows.filter((row) => row.shell && row.icon && row.errors.length === 0).length,
                failed: rows.filter((row) => !row.shell || !row.icon || row.errors.length > 0).length,
            },
            null,
            4,
        )}\n`,
    );
    return RECEIPT;
}

describe('Board maturity (browser)', () => {
    test.skipIf(!browserReady)(
        'every built-in module renders the kit shell with a vector icon, and the run leaves a receipt',
        async () => {
            for (const entry of MODULES) {
                await browser.navigate(`http://127.0.0.1:${server.port}/board/${entry.route}`, page);
                // The shell attribute is the probe 1426/1427 put on `ModuleShell`.
                await browser
                    .waitFor(`Boolean(document.querySelector('[data-${entry.id}-shell]'))`, {
                        sessionId: page,
                        label: `${entry.id} shell`,
                        timeoutMs: 30_000,
                    })
                    .catch(() => undefined);

                const shells = await dom<number>(`document.querySelectorAll('[data-${entry.id}-shell]').length`);
                const h1 = await dom<string>(`document.querySelector('h1')?.textContent ?? ''`);
                const iconSvg = await dom<boolean>(
                    `document.querySelector('h1')?.closest('div')?.parentElement?.querySelector('svg') !== null`,
                );
                const boundary = await dom<boolean>(
                    `document.body.innerHTML.includes('This module could not be loaded')`,
                );
                const errors = [
                    ...(shells === 1 ? [] : [`shell count ${shells}`]),
                    ...(h1 === entry.title ? [] : [`title "${h1}"`]),
                    ...(boundary ? ['module error boundary'] : []),
                    ...assetFailures(),
                    ...pageErrors(),
                ];

                const shot = (await browser.send('Page.captureScreenshot', { format: 'png' }, page)) as {
                    data: string;
                };
                const file = `board-maturity-${entry.id}.png`;
                writeFileSync(join(RECEIPT_DIR, file), Buffer.from(shot.data, 'base64'));

                rows.push({
                    id: entry.id,
                    route: entry.route,
                    shell: shells === 1,
                    icon: iconSvg,
                    errors,
                    screenshot: file,
                });
            }

            // Sidebar: every built-in entry renders an svg and no emoji text.
            const nav = await dom<{ entries: number; withSvg: number; emoji: string[] }>(
                `(() => {
                    const links = Array.from(document.querySelectorAll('a[href*="/board/"], button[data-module-id], [data-module-nav]'));
                    const builtins = links.filter((el) => ${JSON.stringify(MODULES.map((m) => m.route))}.some((r) => (el.getAttribute('href') ?? '').includes('/board/' + r)));
                    const emoji = builtins.map((el) => el.textContent ?? '').filter((text) => /\\p{Extended_Pictographic}/u.test(text));
                    return { entries: builtins.length, withSvg: builtins.filter((el) => el.querySelector('svg') !== null).length, emoji };
                })()`,
            );
            Object.assign(sidebar, nav);

            const receipt = writeReceipt();
            expect(receipt).toEndWith('board-maturity-e2e-receipt.json');
            // The receipts rows are the evidence; the assertions below are what fails a red run.
            expect(rows.map((row) => row.shell)).toEqual(MODULES.map(() => true));
            expect(rows.map((row) => row.icon)).toEqual(MODULES.map(() => true));
            expect(rows.flatMap((row) => row.errors)).toEqual([]);
            expect(sidebar.emoji).toEqual([]);
        },
        900_000,
    );

    test.skipIf(browserReady)('skips without a browser binary and says why', () => {
        expect(browserReady).toBe(false);
    });
});
