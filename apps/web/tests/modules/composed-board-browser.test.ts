/**
 * Real-browser proof of the COMPOSED Board path (task 0992 R1–R3, AC1–AC3).
 *
 * This closes the successor that 0990/0991 left open: the composition chain
 * `composeBoardModules` -> `BoardRegistryProvider` -> router `ModuleErrorBoundary` -> `FramedResource`
 * was proven only by unit tests. Here a production-shaped Board build is served with a real
 * `GET /api/board/modules` catalog and real `/modules/:id/*` asset trees, so the shipped `BoardApp`
 * drives its own default loaders (dynamic ESM import through the document import map, deferred
 * stylesheet link) in real Chromium over CDP.
 *
 * Deliberately NOT the 0988 build-injected test adapter: the assertion that
 * `window.__spurBoardProof` is absent proves the modules arrived through the served catalog, not
 * through a module compiled into the Board. The downstream module here is a raw ESM served at the
 * declared `entryUrl`, so it shares React with the Board only through the shipped import map — the
 * same resolution an installed Vite library build relies on.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoardCatalog, BoardHostRuntime } from '@gobing-ai/spur-contracts';
import { buildBoardToTemp, removeBoardBuild } from '../test-helpers/board-build';
import { type BoardServer, serveBoard } from '../test-helpers/board-server';
import { availableBrowserBinary, type BrowserSession, launchBrowser } from '../test-helpers/cdp';

// Browser proofs require a real Chromium; state the absence instead of failing machines (and CI runners) without one.
const browserReady = availableBrowserBinary() !== undefined;

import { type FrameFixtureServer, serveFrameFixtures } from '../test-helpers/frame-fixtures';

/** The native contribution fixture served as a module asset tree. */
const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/composed-board/', import.meta.url));

/** A second project's module tree, served under the SAME `/modules/native-probe/*` path. */
const ALT_FIXTURE_DIR = fileURLToPath(new URL('../fixtures/composed-board-alt/', import.meta.url));

/** Fixture throw message (must match `throwing.js`). */
const THROW_MESSAGE = 'composed probe failed to render';

let fixtures: FrameFixtureServer;
let proofBuild: string;
let host: BoardHostRuntime;
let server: BoardServer;
let altServer: BoardServer;
let browser: BrowserSession;
let page: string;

/** Read one DOM value from the page. */
async function dom<T>(expression: string): Promise<T> {
    return browser.evaluate<T>(expression, { sessionId: page });
}

/**
 * Bound-wait for an asynchronous condition.
 *
 * CDP `Log.entryAdded` events reach the harness after the page event that caused them, so a
 * one-shot `logEntries()` read races the browser: it passes on an idle machine and loses under a
 * loaded full-suite run. Waiting removes the race without weakening the evidence.
 */
async function waitUntil(condition: () => boolean, label: string, timeoutMs = 10_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (condition()) return true;
        if (Date.now() >= deadline) {
            console.warn(`waitUntil('${label}') timed out after ${timeoutMs}ms`);
            return false;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

/** The catalog the proof server answers at `GET /api/board/modules`. */
function proofCatalog(host: BoardHostRuntime): BoardCatalog {
    return {
        catalogVersion: 1,
        host,
        modules: [
            {
                id: 'native-probe',
                name: 'Native probe',
                icon: '🧩',
                type: 'react',
                route: '/modules/native-probe',
                entryUrl: '/modules/native-probe/entry.js',
                styles: ['/modules/native-probe/style.css'],
                sidebarLabel: 'Native probe',
                order: 1,
            },
            {
                id: 'frame-ok',
                name: 'Frame permitting app',
                icon: '🖼',
                type: 'iframe',
                route: '/modules/frame-ok',
                url: fixtures.permittedUrl,
                sidebarLabel: 'Framed app',
                order: 2,
            },
            {
                id: 'frame-blocked',
                name: 'Frame denying app',
                icon: '🚫',
                type: 'iframe',
                route: '/modules/frame-blocked',
                url: fixtures.deniedUrl,
                sidebarLabel: 'Blocked app',
                order: 3,
            },
            {
                id: 'broken-probe',
                name: 'Broken probe',
                icon: '💥',
                type: 'react',
                route: '/modules/broken-probe',
                entryUrl: '/modules/broken-probe/throwing.js',
                styles: [],
                order: 4,
            },
            {
                id: 'missing-probe',
                name: 'Missing probe',
                icon: '❓',
                type: 'react',
                route: '/modules/missing-probe',
                entryUrl: '/modules/missing-probe/absent.js',
                styles: [],
                order: 5,
            },
        ],
    };
}

/** Turn the build's real runtime manifest into the catalog's host descriptor (0989 R4). */
async function hostFromBuild(distDir: string): Promise<BoardHostRuntime> {
    const manifest = JSON.parse(await readFile(join(distDir, 'board-runtime.json'), 'utf-8')) as BoardHostRuntime;
    return {
        manifestVersion: manifest.manifestVersion,
        contributionApiVersion: manifest.contributionApiVersion,
        reactVersion: manifest.reactVersion,
        reactDomVersion: manifest.reactDomVersion,
        reactRouterVersion: manifest.reactRouterVersion,
        imports: manifest.imports,
        reservedModules: manifest.reservedModules,
    };
}

/**
 * The SECOND project origin's catalog (R2/AC3): the same module id, different sidebar metadata and a
 * different declared frame URL, so a leaked catalog or a stale stylesheet would fail the proof.
 */
function altCatalog(host: BoardHostRuntime): BoardCatalog {
    return {
        catalogVersion: 1,
        host,
        modules: [
            {
                id: 'native-probe',
                name: 'Native probe',
                icon: '🧩',
                type: 'react',
                route: '/modules/native-probe',
                entryUrl: '/modules/native-probe/entry.js',
                styles: ['/modules/native-probe/style.css'],
                sidebarLabel: 'Alternate probe',
                order: 1,
            },
            {
                id: 'frame-alt',
                name: 'Alternate framed app',
                icon: '🚫',
                type: 'iframe',
                route: '/modules/frame-alt',
                url: fixtures.deniedUrl,
                order: 2,
            },
        ],
    };
}

/**
 * The alt-catalog post-conditions (AC3 and the same-origin restart proof): this catalog's sidebar
 * routes, content, stylesheet and declared frame URL render, with no first-catalog route, content
 * or in-page state left. Shared by the second-origin and restart-plus-reload cases so the two
 * proofs cannot drift apart.
 */
async function expectAltCatalog(origin: string): Promise<void> {
    // This catalog's sidebar module routes are present and the first catalog's are not.
    const hrefs = await dom<string[]>(
        '[...document.querySelectorAll("nav a[href^=\\"/board/modules/\\"]")].map((a) => a.getAttribute("href"))',
    );
    expect(hrefs).toContain('/board/modules/native-probe');
    expect(hrefs).toContain('/board/modules/frame-alt');
    expect(hrefs).not.toContain('/board/modules/frame-ok');
    expect(hrefs).not.toContain('/board/modules/broken-probe');
    // This catalog's compiled content and stylesheet, not the first catalog's.
    expect(await dom<boolean>('Boolean(document.querySelector("[data-probe-variant=alternate]"))')).toBe(true);
    expect(await dom<boolean>('Boolean(document.querySelector("[data-probe-variant=original]"))')).toBe(false);
    expect(await dom<string>('getComputedStyle(document.querySelector("[data-probe]")).color')).toBe(
        'rgb(10, 150, 60)',
    );
    // No prior-catalog module state survives: the counter starts fresh.
    expect(await dom<string>('document.querySelector("[data-probe-counter]").textContent')).toBe('0');

    // The declared frame URL belongs to this catalog too.
    await browser.navigate(`${origin}/board/modules/frame-alt`, page);
    await browser.waitFor('Boolean(document.querySelector("[data-testid=framed-resource-frame]"))', {
        sessionId: page,
        label: 'alternate frame to render',
    });
    expect(await dom<string>('document.querySelector("[data-testid=framed-resource-frame]").src')).toBe(
        fixtures.deniedUrl,
    );
}

beforeAll(async () => {
    if (!browserReady) return;
    fixtures = await serveFrameFixtures();
    proofBuild = await buildBoardToTemp();
    host = await hostFromBuild(proofBuild);
    server = serveBoard(proofBuild, {
        catalog: proofCatalog(host),
        moduleAssets: { 'native-probe': FIXTURE_DIR, 'broken-probe': FIXTURE_DIR },
    });
    altServer = serveBoard(proofBuild, {
        catalog: altCatalog(host),
        moduleAssets: { 'native-probe': ALT_FIXTURE_DIR },
    });
    browser = await launchBrowser();
    page = await browser.newPage();
    await browser.navigate(`${server.origin}/board/modules/native-probe`, page);
    await browser.waitFor('Boolean(document.querySelector("[data-probe-counter]"))', {
        sessionId: page,
        label: 'catalog-composed native module to render',
        timeoutMs: 60_000,
    });
}, 600_000);

afterAll(async () => {
    await browser?.close();
    server?.stop();
    altServer?.stop();
    fixtures?.stop();
    await removeBoardBuild(proofBuild);
});

describe.skipIf(!browserReady)('catalog composition renders without a build-injected adapter (R1, AC1)', () => {
    test('the modules arrived through the served catalog, not the 0988 test adapter', async () => {
        // The build is production-shaped: no adapter route, no proof record compiled in.
        expect(await dom<boolean>('"__spurBoardProof" in window')).toBe(false);
        expect(await dom<number>('document.querySelectorAll("[data-proof-root]").length')).toBe(0);
        // No host-level catalog diagnostic: the real catalog was read and composed.
        expect(await dom<boolean>('Boolean(document.querySelector("[data-testid=board-diagnostics]"))')).toBe(false);
    }, 60_000);

    test('one sidebar lists every declared module — native tools and framed resources alike', async () => {
        const hrefs = await dom<string[]>(
            '[...document.querySelectorAll("nav a[href^=\\"/board/modules/\\"]")].map((a) => a.getAttribute("href"))',
        );
        expect(hrefs).toContain('/board/modules/native-probe');
        expect(hrefs).toContain('/board/modules/frame-ok');
        expect(hrefs).toContain('/board/modules/frame-blocked');
        // Built-ins are still present beside them.
        expect(await dom<number>('document.querySelectorAll("nav a").length')).toBeGreaterThanOrEqual(8);
    }, 60_000);

    test('the native contribution renders with hook state, its own context and its declared CSS', async () => {
        expect(await dom<string>('document.querySelector("[data-probe-counter]").textContent')).toBe('0');
        // The Board does not provide this module's context, so the module's OWN default shows:
        // its context object is independent of the host, not shared by accident.
        expect(await dom<string>('document.querySelector("[data-probe-context]").textContent')).toBe('unprovided|0|');
        expect(await dom<string>('getComputedStyle(document.querySelector("[data-probe]")).color')).toBe(
            'rgb(20, 90, 200)',
        );
    }, 60_000);

    test('a real click drives the module’s own state', async () => {
        await browser.click('[data-probe-increment]', page);
        await browser.waitFor('document.querySelector("[data-probe-counter]").textContent === "1"', {
            sessionId: page,
            label: 'probe counter to increment',
        });
        await browser.click('[data-probe-increment]', page);
        await browser.waitFor('document.querySelector("[data-probe-counter]").textContent === "2"', {
            sessionId: page,
            label: 'probe counter to increment again',
        });
    }, 60_000);

    test('the module’s on-demand chunk loads from its served asset tree', async () => {
        expect(await dom<string>('document.querySelector("[data-probe-lazy-value]").textContent')).toBe('');
        await browser.click('[data-probe-lazy]', page);
        await browser.waitFor(
            'document.querySelector("[data-probe-lazy-value]").textContent === "composed-lazy-loaded"',
            {
                sessionId: page,
                label: 'on-demand chunk value',
            },
        );
    }, 60_000);

    test('the optional right panel renders in the Board’s own panel chrome', async () => {
        const panel = await dom<{ text: string; collapsed: string }>(
            '(() => { const panel = document.querySelector("[data-probe-panel]");' +
                ' return { text: panel ? panel.textContent : "",' +
                ' collapsed: document.querySelector(".board-layout").dataset.rightpanelCollapsed }; })()',
        );
        expect(panel.text).toBe('composed probe panel');
        expect(panel.collapsed).toBe('false');
    }, 60_000);
});

describe.skipIf(!browserReady)('framed resources share navigation with native tools (R3, AC2)', () => {
    test('an iframe module frames its configured cross-origin URL verbatim, with an escape hatch', async () => {
        await browser.navigate(`${server.origin}/board/modules/frame-ok`, page);
        await browser.waitFor('Boolean(document.querySelector("[data-testid=framed-resource-frame]"))', {
            sessionId: page,
            label: 'framed resource to render',
        });
        const frame = await dom<{ src: string; title: string; framed: string; panelSuppressed: string }>(
            '(() => { const frame = document.querySelector("[data-testid=framed-resource-frame]");' +
                ' const root = document.querySelector(".board-layout").dataset;' +
                ' return { src: frame.src, title: frame.title, framed: root.framedWorkspace,' +
                ' panelSuppressed: String(root.rightpanelCollapsed) }; })()',
        );
        expect(frame.src).toBe(fixtures.permittedUrl);
        expect(frame.title).toBe('Frame permitting app');
        // The framed workspace owns the whole surface (R2): the panel column is not rendered.
        expect(frame.framed).toBe('true');
        expect(await dom<boolean>('Boolean(document.querySelector("[data-probe-panel]"))')).toBe(false);

        const link = await dom<{ href: string; target: string; rel: string }>(
            '(() => { const a = document.querySelector("[data-testid=framed-resource-external]");' +
                ' return { href: a.href, target: a.target, rel: a.rel }; })()',
        );
        expect(link.href).toBe(fixtures.permittedUrl);
        expect(link.target).toBe('_blank');
        expect(link.rel).toContain('noopener');
        expect(link.rel).toContain('noreferrer');
        // Cross-origin for real: the framed app is served on its own origin.
        expect(new URL(frame.src).origin).not.toBe(server.origin);
    }, 60_000);

    test('the permitted framed app actually runs inside the frame', async () => {
        const frames = await browser.childFrames(page);
        const childFrame = frames.find((candidate) => candidate.url.startsWith(fixtures.origin));
        expect(childFrame).toBeDefined();
        // The execution context is created asynchronously once the child frame commits, so bound-wait
        // for it rather than sampling a snapshot once (same CDP race class as the refusal log).
        expect(
            await waitUntil(
                () =>
                    browser
                        .executionContexts()
                        .some(
                            (candidate) =>
                                candidate.frameId === childFrame?.frameId && candidate.origin === fixtures.origin,
                        ),
                'permitted frame execution context',
            ),
        ).toBe(true);
        const context = browser
            .executionContexts()
            .find((candidate) => candidate.frameId === childFrame?.frameId && candidate.origin === fixtures.origin);
        expect(context).toBeDefined();
        expect(await browser.evaluate<string>('document.title', { sessionId: page, contextId: context?.id })).toBe(
            'Frameable fixture app',
        );
    }, 60_000);

    test('a refused frame never claims readiness and keeps the external action usable', async () => {
        await browser.navigate(`${server.origin}/board/modules/frame-blocked`, page);
        await browser.waitFor('Boolean(document.querySelector("[data-testid=framed-resource-frame]"))', {
            sessionId: page,
            label: 'blocked framed resource to render',
        });
        expect(await dom<string>('document.querySelector("[data-testid=framed-resource-frame]").src')).toBe(
            fixtures.deniedUrl,
        );
        // The refused document never executed in this browser: no context from the denied origin.
        const deniedOrigin = new URL(fixtures.deniedUrl).origin;
        expect(browser.executionContexts().some((candidate) => candidate.origin === deniedOrigin)).toBe(false);
        // Chromium reports the refusal on the console. That entry arrives asynchronously over CDP, so
        // bound-wait for it rather than sampling once. The deterministic proof of refusal is the
        // execution-context assertion above (the denied document never executed); this corroborates it.
        expect(
            await waitUntil(
                () =>
                    browser
                        .logEntries()
                        .some((entry) =>
                            /frame-ancestors|X-Frame-Options|Refused to (frame|display)/i.test(entry.text),
                        ),
                'chromium refusal log',
            ),
        ).toBe(true);

        const link = await dom<{ href: string; target: string }>(
            '(() => { const a = document.querySelector("[data-testid=framed-resource-external]");' +
                ' return { href: a.href, target: a.target }; })()',
        );
        expect(link.href).toBe(fixtures.deniedUrl);
        expect(link.target).toBe('_blank');
    }, 60_000);
});

describe.skipIf(!browserReady)('failure containment keeps the Board navigable (R3, AC1)', () => {
    test('a throwing contribution is contained by the module boundary', async () => {
        await browser.navigate(`${server.origin}/board/modules/broken-probe`, page);
        await browser.waitFor('Boolean(document.querySelector("[data-testid=module-diagnostic]"))', {
            sessionId: page,
            label: 'render diagnostic to appear',
        });
        const diagnostic = await dom<{ id: string; category: string; text: string }>(
            '(() => { const d = document.querySelector("[data-testid=module-diagnostic]");' +
                ' return { id: d.dataset.moduleId, category: d.dataset.failureCategory, text: d.textContent }; })()',
        );
        expect(diagnostic.id).toBe('broken-probe');
        expect(diagnostic.category).toBe('render');
        expect(diagnostic.text).toContain(THROW_MESSAGE);
        // The rest of the Board is still mounted around the contained failure.
        expect(await dom<boolean>('Boolean(document.querySelector(".board-layout"))')).toBe(true);
    }, 60_000);

    test('a missing asset is a real error, never a blank route', async () => {
        await browser.navigate(`${server.origin}/board/modules/missing-probe`, page);
        await browser.waitFor('Boolean(document.querySelector("[data-testid=module-diagnostic]"))', {
            sessionId: page,
            label: 'import diagnostic to appear',
        });
        expect(await dom<string>('document.querySelector("[data-testid=module-diagnostic]").dataset.moduleId')).toBe(
            'missing-probe',
        );
        expect(
            await dom<string>('document.querySelector("[data-testid=module-diagnostic]").dataset.failureCategory'),
        ).toBe('import');
        // The absent asset was refused as a real 4xx, not answered with the SPA document. The failure
        // is reported over CDP, so bound-wait for it (same race class as the refusal log).
        expect(
            await waitUntil(
                () => browser.failedRequests().some((entry) => entry.includes('/modules/missing-probe/absent.js')),
                'absent asset failure report',
            ),
        ).toBe(true);
    }, 60_000);

    test('built-in modules stay reachable after a downstream failure', async () => {
        await browser.navigate(`${server.origin}/board/designs`, page);
        await browser.waitFor('Boolean(document.querySelector("nav a[aria-current=page]"))', {
            sessionId: page,
            label: 'built-in route to activate',
        });
        expect(await dom<string>('document.querySelector("nav a[aria-current=page]").getAttribute("href")')).toBe(
            '/board/designs',
        );
        expect(await dom<boolean>('Boolean(document.querySelector(".board-layout"))')).toBe(true);
    }, 60_000);
});

describe.skipIf(!browserReady)('each project origin owns its own catalog (R2, AC3)', () => {
    test('a second origin serves the same module id with different metadata, content and frame URL', async () => {
        await browser.navigate(`${altServer.origin}/board/modules/native-probe`, page);
        await browser.waitFor('Boolean(document.querySelector("[data-probe-counter]"))', {
            sessionId: page,
            label: 'second project module to render',
            timeoutMs: 60_000,
        });
        await expectAltCatalog(altServer.origin);
    }, 60_000);
});

describe.skipIf(!browserReady)('module assets follow the documented restart lifecycle (R4)', () => {
    test('module assets carry no-store, so restart plus reload cannot be masked by a cached chunk', async () => {
        const cache = await dom<{ entry: string | null; style: string | null }>(
            '(async () => { const entry = await fetch("/modules/native-probe/entry.js");' +
                ' const style = await fetch("/modules/native-probe/style.css");' +
                ' return { entry: entry.headers.get("cache-control"), style: style.headers.get("cache-control") }; })()',
        );
        // There is no live replacement in v1: a rebuild or a selection change is only visible after
        // a restart plus a reload, and no-store is what keeps the reload from serving a stale entry.
        expect(cache.entry).toBe('no-store');
        expect(cache.style).toBe('no-store');
    }, 60_000);
    test('a changed selection is used only after restart plus reload on the same origin (R13)', async () => {
        // Owns its server lifecycle: not the shared `server`/`altServer`.
        const first = serveBoard(proofBuild, {
            catalog: proofCatalog(host),
            moduleAssets: { 'native-probe': FIXTURE_DIR, 'broken-probe': FIXTURE_DIR },
        });
        let changed: BoardServer | undefined;
        try {
            // The first catalog composed and rendered, with in-page state to detect leaks of.
            await browser.navigate(`${first.origin}/board/modules/native-probe`, page);
            await browser.waitFor('Boolean(document.querySelector("[data-probe-counter]"))', {
                sessionId: page,
                label: 'first catalog native module to render',
                timeoutMs: 60_000,
            });
            await browser.click('[data-probe-increment]', page);
            await browser.waitFor('document.querySelector("[data-probe-counter]").textContent === "1"', {
                sessionId: page,
                label: 'counter to mark retained first-catalog state',
            });

            // "Restart": the SAME port now serves the changed catalog and module assets.
            const port = first.port;
            first.stop();
            // A forced close can release the port a beat late; retry briefly on EADDRINUSE —
            // never fall back to a new port, which would silently become the second-origin case.
            for (let attempt = 0; !changed; attempt += 1) {
                try {
                    changed = serveBoard(proofBuild, {
                        catalog: altCatalog(host),
                        moduleAssets: { 'native-probe': ALT_FIXTURE_DIR },
                        port,
                    });
                } catch (error) {
                    if (attempt >= 9 || !(error instanceof Error) || !error.message.includes('EADDRINUSE')) {
                        throw error;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }
            }

            // Before any reload, the running Board must still show the first catalog ...
            expect(await dom<boolean>('Boolean(document.querySelector("[data-probe-variant=original]"))')).toBe(true);
            const firstHrefs = await dom<string[]>(
                '[...document.querySelectorAll("nav a[href^=\\"/board/modules/\\"]")].map((a) => a.getAttribute("href"))',
            );
            expect(firstHrefs).toContain('/board/modules/frame-ok');
            expect(firstHrefs).not.toContain('/board/modules/frame-alt');
            // ... including after an in-app (client-side) navigation away and back.
            await browser.click('nav a[href="/board/designs"]', page);
            await browser.waitFor(
                'document.querySelector("nav a[aria-current=page]").getAttribute("href") === "/board/designs"',
                { sessionId: page, label: 'in-app navigation away from the module' },
            );
            await browser.click('nav a[href="/board/modules/native-probe"]', page);
            await browser.waitFor('Boolean(document.querySelector("[data-probe-counter]"))', {
                sessionId: page,
                label: 'module route reached by in-app navigation',
            });
            expect(await dom<boolean>('Boolean(document.querySelector("[data-probe-variant=original]"))')).toBe(true);
            const backHrefs = await dom<string[]>(
                '[...document.querySelectorAll("nav a[href^=\\"/board/modules/\\"]")].map((a) => a.getAttribute("href"))',
            );
            expect(backHrefs).not.toContain('/board/modules/frame-alt');

            // Reload: only now may the changed selection render (R1) — same origin throughout.
            await browser.send('Page.reload', {}, page);
            await browser.waitFor('Boolean(document.querySelector("[data-probe-variant=alternate]"))', {
                sessionId: page,
                label: 'changed catalog content after reload',
                timeoutMs: 60_000,
            });
            await expectAltCatalog(`http://127.0.0.1:${port}`);
        } finally {
            first.stop();
            changed?.stop();
        }
    }, 60_000);
});

describe.skipIf(!browserReady)('navigation does not retain a module’s in-page state (R2, R3)', () => {
    test('leaving and returning to the native module mounts it fresh', async () => {
        await browser.navigate(`${server.origin}/board/modules/native-probe`, page);
        await browser.waitFor('Boolean(document.querySelector("[data-probe-counter]"))', {
            sessionId: page,
            label: 'native module to remount',
        });
        await browser.click('[data-probe-increment]', page);
        await browser.waitFor('document.querySelector("[data-probe-counter]").textContent === "1"', {
            sessionId: page,
            label: 'state to change before leaving',
        });

        await browser.navigate(`${server.origin}/board/designs`, page);
        await browser.waitFor('Boolean(document.querySelector("nav a[aria-current=page]"))', {
            sessionId: page,
            label: 'navigation away from the module',
        });
        await browser.navigate(`${server.origin}/board/modules/native-probe`, page);
        await browser.waitFor('Boolean(document.querySelector("[data-probe-counter]"))', {
            sessionId: page,
            label: 'native module to reload',
        });
        // The contribution is re-imported/re-mounted: no counter state survived navigation.
        expect(await dom<string>('document.querySelector("[data-probe-counter]").textContent')).toBe('0');
    }, 60_000);
});
