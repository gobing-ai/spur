/**
 * A83 1430 R6 — a real browser loads every built-in Board module and leaves an artifact.
 *
 * `buildBoardToTemp` builds the Board once, `serveBoard` serves it without a project API (data
 * calls fail by design — each module's own tests own their data), and real Chromium visits
 * `/board/<route>` for the ten built-in modules. Per module it asserts the kit shell, one kit
 * header whose icon is an `<svg>`, no module-error-boundary fallback, no asset/MIME failure, and no
 * uncaught page error. The sidebar is checked for emoji text, and every module gets a screenshot.
 *
 * Live receipts go to `.spur/run/board-maturity-proof/`, including on failure. The committed
 * `docs/reports/` snapshot is refreshed deliberately; a verifier must not mutate its own inputs.
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
const RECEIPT_DIR = join(REPO_ROOT, '.spur/run/board-maturity-proof');
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
const sidebar: { entries: number; withSvg: number; emoji: string[]; ids: string[] } = {
    entries: 0,
    withSvg: 0,
    emoji: [],
    ids: [],
};

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
    return browser.failedRequests().filter((failure) => {
        try {
            const path = new URL(failure.replace(/^\d+\s+/, '')).pathname;
            return !path.startsWith('/api/') && !path.startsWith('/rpc/');
        } catch {
            return true;
        }
    });
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
    mkdirSync(RECEIPT_DIR, { recursive: true });
    build = await buildBoardToTemp();
    server = serveBoard(build, { moduleAssets: {} });
    browser = await launchBrowser();
    page = await browser.newPage();
    await browser.send(
        'Emulation.setDeviceMetricsOverride',
        {
            width: 1280,
            height: 800,
            deviceScaleFactor: 1,
            mobile: false,
        },
        page,
    );
}, 600_000);

afterAll(async () => {
    if (browserReady) writeReceipt();
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
                failed: MODULES.length - rows.filter((row) => row.shell && row.icon && row.errors.length === 0).length,
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
                const tabErrors = await dom<string[]>(`(() => {
                    const title = document.querySelector('[data-${entry.id}-shell] h1');
                    const header = title?.parentElement?.parentElement?.parentElement;
                    const list = header?.querySelector('[role="tablist"]');
                    if (!list) return [];
                    const errors = [];
                    if (list.parentElement !== header) errors.push('tab strip is not in the header tabs slot');
                    for (const tab of list.querySelectorAll('[role="tab"]')) {
                        const selected = tab.getAttribute('aria-selected') === 'true';
                        if (tab.tabIndex !== (selected ? 0 : -1)) errors.push('tab has incorrect tabIndex');
                        if (selected) {
                            const panel = document.getElementById(tab.getAttribute('aria-controls'));
                            if (panel?.getAttribute('role') !== 'tabpanel' || panel?.getAttribute('aria-labelledby') !== tab.id)
                                errors.push('selected tab has no labelled panel');
                        }
                    }
                    return errors;
                })()`);
                const errors = [
                    ...(shells === 1 ? [] : [`shell count ${shells}`]),
                    ...(h1 === entry.title ? [] : [`title "${h1}"`]),
                    ...(boundary ? ['module error boundary'] : []),
                    ...tabErrors,
                    ...assetFailures(),
                    ...pageErrors(),
                ];

                const shot = (await browser.send('Page.captureScreenshot', { format: 'png' }, page)) as {
                    data: string;
                };
                const png = Buffer.from(shot.data, 'base64');
                expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1280, 800]);
                const file = `board-maturity-${entry.id}.png`;
                writeFileSync(join(RECEIPT_DIR, file), png);

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
            const nav = await dom<{ entries: number; withSvg: number; emoji: string[]; ids: string[] }>(
                `(() => {
                    const links = Array.from(document.querySelectorAll('aside a[href*="/board/"]'));
                    const builtins = links.filter((el) => ${JSON.stringify(MODULES.map((m) => m.route))}.some((r) => (el.getAttribute('href') ?? '').includes('/board/' + r)));
                    const emoji = builtins.map((el) => el.textContent ?? '').filter((text) => /\\p{Extended_Pictographic}/u.test(text));
                    const ids = builtins.map(el => new URL(el.getAttribute('href'), location.href).pathname.split('/')[2]);
                    return { entries: builtins.length, withSvg: builtins.filter((el) => el.querySelector('svg') !== null).length, emoji, ids };
                })()`,
            );
            Object.assign(sidebar, nav);

            const receipt = writeReceipt();
            expect(receipt).toStartWith(join(REPO_ROOT, '.spur/run/board-maturity-proof'));
            expect(receipt).toEndWith('board-maturity-e2e-receipt.json');
            // The receipts rows are the evidence; the assertions below are what fails a red run.
            expect(rows.map((row) => row.shell)).toEqual(MODULES.map(() => true));
            expect(rows.map((row) => row.icon)).toEqual(MODULES.map(() => true));
            expect(rows.flatMap((row) => row.errors)).toEqual([]);
            expect(sidebar.entries).toBe(MODULES.length);
            expect(sidebar.withSvg).toBe(MODULES.length);
            expect([...sidebar.ids].sort()).toEqual(MODULES.map((entry) => entry.id).sort());
            expect(sidebar.emoji).toEqual([]);
        },
        900_000,
    );

    test.skipIf(!browserReady)('Designs and Plans preserve their document panes at desktop and 375px', async () => {
        const injected = (await browser.send(
            'Page.addScriptToEvaluateOnNewDocument',
            {
                source: `(() => {
                const original = window.fetch.bind(window);
                window.fetch = (input, init) => {
                    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input), location.href);
                    const match = /\\/project\\/(designs|plans)(\\/file)?$/.exec(url.pathname);
                    if (!match) return original(input, init);
                    const path = match[1] === 'designs' ? 'docs/design/a83.md' : 'docs/plans/a83.md';
                    const body = match[2]
                        ? { ok: true, path, title: 'A83 layout fixture', content: '# A83 layout fixture\\n\\n## Detail\\n\\nReadable document fixture.\\n' }
                        : { files: [{ id: 'a83', path, name: 'a83.md', title: 'A83 layout fixture', category: match[1] === 'designs' ? 'satellite' : 'plan' }], total: 1 };
                    return Promise.resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }));
                };
            })()`,
            },
            page,
        )) as { identifier: string };
        const layouts: Array<{ module: string; width: number; panes: number[]; screenshot: string }> = [];
        try {
            for (const entry of [
                { module: 'designs', prefix: 'design' },
                { module: 'plans', prefix: 'plan' },
            ]) {
                for (const width of [1280, 375]) {
                    await browser.send(
                        'Emulation.setDeviceMetricsOverride',
                        {
                            width,
                            height: 800,
                            deviceScaleFactor: 1,
                            mobile: false,
                        },
                        page,
                    );
                    await browser.navigate(`http://127.0.0.1:${server.port}/board/${entry.module}`, page);
                    await browser.waitFor(
                        `document.querySelector('[data-testid="${entry.prefix}-body-container"]')?.textContent.includes('Readable document fixture.')`,
                        { sessionId: page },
                    );
                    if (width === 375) {
                        await dom(`(() => {
                            document.querySelector('button[aria-controls="${entry.prefix}-files-dock"]').click();
                            document.querySelector('button[aria-controls="${entry.prefix}-toc-dock"]').click();
                        })()`);
                        await browser.waitFor(
                            `document.getElementById('${entry.prefix}-files-dock')?.hidden !== false && document.getElementById('${entry.prefix}-toc-dock')?.hidden !== false`,
                            { sessionId: page },
                        );
                    }
                    const panes = await dom<number[]>(
                        `['${entry.prefix}-files-dock', '${entry.prefix}-workspace', '${entry.prefix}-toc-dock'].map(id => (document.getElementById(id) ?? document.querySelector('[data-testid="' + id + '"]'))?.getBoundingClientRect().width ?? 0)`,
                    );
                    const capture = (await browser.send('Page.captureScreenshot', { format: 'png' }, page)) as {
                        data: string;
                    };
                    const screenshot = `board-maturity-${entry.module}-${width}.png`;
                    writeFileSync(join(RECEIPT_DIR, screenshot), Buffer.from(capture.data, 'base64'));
                    layouts.push({ module: entry.module, width, panes, screenshot });
                    if (width === 1280) expect(panes.every((value) => value > 0)).toBe(true);
                    else expect(panes[1]).toBeGreaterThan(0);
                    expect(
                        await dom<boolean>(
                            `document.querySelector('[data-${entry.module}-shell]').getBoundingClientRect().right <= innerWidth`,
                        ),
                    ).toBe(true);
                }
            }
        } finally {
            writeFileSync(join(RECEIPT_DIR, 'document-layouts.json'), `${JSON.stringify(layouts, null, 4)}\n`);
            await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier }, page);
            await browser.send(
                'Emulation.setDeviceMetricsOverride',
                { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
                page,
            );
        }
    });

    test.skipIf(!browserReady)('Tasks keeps its full-bleed body below a centered header', async () => {
        await browser.send(
            'Emulation.setDeviceMetricsOverride',
            {
                width: 1920,
                height: 900,
                deviceScaleFactor: 1,
                mobile: false,
            },
            page,
        );
        try {
            await browser.navigate(`http://127.0.0.1:${server.port}/board/tasks`, page);
            await browser.waitFor('Boolean(document.querySelector("[data-tasks-shell]"))', { sessionId: page });
            const widths = await dom<{ body: number; header: number }>(`(() => {
                const shell = document.querySelector('[data-tasks-shell]');
                const header = shell.querySelector('h1').parentElement.parentElement.parentElement;
                return { body: shell.getBoundingClientRect().width, header: header.getBoundingClientRect().width };
            })()`);
            expect(widths.body).toBeGreaterThan(1600);
            expect(widths.header).toBeLessThanOrEqual(1600);
        } finally {
            await browser.send(
                'Emulation.setDeviceMetricsOverride',
                {
                    width: 1280,
                    height: 800,
                    deviceScaleFactor: 1,
                    mobile: false,
                },
                page,
            );
        }
    });

    // Failure sensitivity: query strings cannot disguise failed assets as data requests,
    // and real uncaught exceptions must reach the CDP error log used by the proof.
    test.skipIf(!browserReady)('a data-path query cannot hide a failed module asset', async () => {
        const path = '/modules/a83-missing/probe.js?source=/api/not-a-data-request';
        expect(await dom<number>(`fetch(${JSON.stringify(path)}).then(response => response.status)`)).toBe(404);
        expect(assetFailures().some((failure) => failure.includes('/modules/a83-missing/probe.js'))).toBe(true);
    });

    test.skipIf(!browserReady)('the proof captures an actual uncaught browser exception', async () => {
        await dom(`(() => {
            window.addEventListener('error', () => { document.documentElement.dataset.a83ErrorProbe = 'done'; }, { once: true });
            setTimeout(() => { throw new Error('A83 uncaught error probe'); }, 0);
        })()`);
        await browser.waitFor('document.documentElement.dataset.a83ErrorProbe === "done"', {
            sessionId: page,
            label: 'uncaught error probe',
        });
        expect(pageErrors().some((error) => error.includes('A83 uncaught error probe'))).toBe(true);
    });

    test.skipIf(!browserReady)('the proof captures a failed asset connection', async () => {
        const url = 'http://127.0.0.1:1/a83-failed-asset';
        await dom(`fetch(${JSON.stringify(url)}).catch(() => null)`);
        expect(assetFailures().some((failure) => failure.includes('/a83-failed-asset'))).toBe(true);
    });

    test.skipIf(browserReady)('skips without a browser binary and says why', () => {
        expect(browserReady).toBe(false);
    });
});
