/**
 * Real-browser proof of the Board shared runtime and the downstream authoring contract
 * (task 0988 R3/R4, AC1).
 *
 * Evidence chain, all built by this test:
 *   packed @gobing-ai/spur tarball -> consumer installed OUTSIDE the checkout with its OWN React ->
 *   entry type-checked against the installed declaration-only `./board` export -> Vite library
 *   build -> fixture copied into a temporary Board proof build -> served -> driven in real
 *   Chromium over CDP.
 *
 * Happy-dom is not used here on purpose: module-instance identity and hook behaviour are exactly
 * what a simulated DOM cannot establish.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBoardToTemp, removeBoardBuild } from '../test-helpers/board-build';
import { type BoardServer, serveBoard } from '../test-helpers/board-server';
import { availableBrowserBinary, type BrowserSession, launchBrowser } from '../test-helpers/cdp';

// Browser proofs require a real Chromium; state the absence instead of failing machines (and CI runners) without one.
const browserReady = availableBrowserBinary() !== undefined;

import {
    type DownstreamConsumer,
    deployFixtureIntoBoardBuild,
    packCliTarball,
    prepareDownstreamConsumer,
    REPO_ROOT,
} from '../test-helpers/downstream-fixture';

/** The fixture's throwing component message (must match the fixture source). */
const THROW_MESSAGE = 'downstream contribution failed to render';

/** Deep route the proof module is mounted at (built-in wildcard child route). */
const DEEP_PATH = '/board/test-board-runtime-proof/deep/segment';

let workspace: string | undefined;
let tarballDir: string;
let tarball: string;
let consumer: DownstreamConsumer;
let proofBuild: string;
let server: BoardServer;
let browser: BrowserSession;
let page: string;

/** Read the published proof record from the page. */
async function proofRecord(): Promise<Record<string, unknown>> {
    return browser.evaluate<Record<string, unknown>>('window.__spurBoardProof', { sessionId: page });
}

/** Read one DOM value from the page. */
async function dom<T>(expression: string): Promise<T> {
    return browser.evaluate<T>(expression, { sessionId: page });
}

beforeAll(async () => {
    if (!browserReady) return;
    workspace = await mkdtemp(join(tmpdir(), 'spur-proof-0988-'));
    tarballDir = join(workspace, 'pack');

    tarball = packCliTarball(tarballDir);
    consumer = await prepareDownstreamConsumer(tarball, workspace);
    proofBuild = await buildBoardToTemp({
        testAdapterDir: join(REPO_ROOT, 'apps/web/tests/fixtures/board-test-adapter'),
    });
    await deployFixtureIntoBoardBuild(consumer.distDir, proofBuild);
    server = serveBoard(proofBuild);
    browser = await launchBrowser();
    page = await browser.newPage();
    await browser.navigate(`${server.origin}${DEEP_PATH}`, page);
    await browser.waitFor('Boolean(window.__spurBoardProof && window.__spurBoardProof.fixtureLoaded)', {
        sessionId: page,
        label: 'proof adapter to load the fixture',
    });
}, 900_000);

afterAll(async () => {
    await browser?.close();
    server?.stop();
    await removeBoardBuild(proofBuild);
    if (workspace) await rm(workspace, { recursive: true, force: true });
});

describe.skipIf(!browserReady)('installed package exports (R3)', () => {
    test('the tarball ships the declaration-only ./board export and the runtime manifest', async () => {
        const declared = await readFile(consumer.installedBoardTypes, 'utf-8');
        expect(declared).toContain('export interface BoardModuleContribution {');
        expect(declared).toContain('readonly apiVersion: 1;');
        expect(declared).toContain('export declare const webModule: BoardModuleContribution;');
        expect(declared).toContain("import type { ComponentType } from 'react';");
        expect(/^\s*import\s+(?!type\b)/m.test(declared)).toBeFalse();

        const pkg = JSON.parse(
            await readFile(join(consumer.dir, 'node_modules/@gobing-ai/spur/package.json'), 'utf-8'),
        ) as {
            exports?: Record<string, unknown>;
        };
        expect(pkg.exports?.['./board']).toEqual({ types: './board/index.d.ts' });

        const manifest = JSON.parse(await readFile(consumer.installedRuntimeManifest, 'utf-8')) as {
            manifestVersion?: number;
            contributionApiVersion?: number;
            imports?: Record<string, string>;
        };
        expect(manifest.manifestVersion).toBe(1);
        expect(manifest.contributionApiVersion).toBe(1);
        expect(Object.keys(manifest.imports ?? {}).sort()).toEqual([
            'react',
            'react-dom',
            'react-dom/client',
            'react-router',
            'react-router/dom',
            'react/jsx-dev-runtime',
            'react/jsx-runtime',
        ]);
    }, 60_000);

    test('the downstream entry type-checks against the installed ./board export', async () => {
        expect(consumer.typecheck.output).not.toContain('@gobing-ai/spur/board');
        expect(consumer.typecheck.code).toBe(0);
    }, 60_000);
});

describe.skipIf(!browserReady)('shared runtime identity in a real browser (R4, AC1)', () => {
    test('the Board renderer mounted the fixture on a deep link', async () => {
        const record = await proofRecord();
        expect(record.mountedPath).toBe(DEEP_PATH);
        expect(record.fixtureLoaded).toBe(true);
        expect(record.fixtureError).toBeNull();
        expect(record.validation).toEqual({ accepted: true, reason: null });
        // The page really is the board shell, not a bare fixture harness.
        expect(await dom<number>('document.querySelectorAll("nav a").length')).toBeGreaterThanOrEqual(8);
        expect(await dom<boolean>('Boolean(document.querySelector(".board-layout"))')).toBe(true);
    }, 60_000);

    test('React is shared by instance, not by version', async () => {
        const record = await proofRecord();
        const identity = record.identity as Record<string, unknown> | null;
        expect(identity).not.toBeNull();
        expect(identity?.useStateSameFunction).toBe(true);
        expect(identity?.createElementSameFunction).toBe(true);
        expect(identity?.jsxSameFunction).toBe(true);
        expect(identity?.internalsObjectShared).toBe(true);
        expect(identity?.mapImportIsFixtureModule).toBe(true);
        // Negative control: the fixture's OWN React install is version-equal but instance-distinct.
        expect(identity?.ownReactIsDistinct).toBe(true);
        expect(identity?.ownReactVersionEqualsHost).toBe(true);
        expect(identity?.hostVersion).toBe(identity?.ownVersion);
    }, 60_000);

    test('hooks, host context and scoped CSS work inside the Board tree', async () => {
        expect(await dom<string>('document.querySelector("[data-proof-counter]").textContent')).toBe('0');
        expect(await dom<string>('document.querySelector("[data-proof-context]").textContent')).toContain(
            `spur-board|1|${server.origin}`,
        );
        const color = await dom<string>('getComputedStyle(document.querySelector("[data-proof-contribution]")).color');
        expect(color).toBe('rgb(12, 34, 156)');

        // State update through a real user click.
        await browser.click('[data-proof-increment]', page);
        await browser.waitFor('document.querySelector("[data-proof-counter]").textContent === "1"', {
            sessionId: page,
            label: 'counter to increment',
        });
        await browser.click('[data-proof-increment]', page);
        await browser.waitFor('document.querySelector("[data-proof-counter]").textContent === "2"', {
            sessionId: page,
            label: 'counter to increment again',
        });
    }, 60_000);

    test('a lazy chunk and a referenced asset load on demand', async () => {
        expect(await dom<string>('document.querySelector("[data-proof-lazy-value]").textContent')).toBe('');
        await browser.click('[data-proof-lazy]', page);
        await browser.waitFor('document.querySelector("[data-proof-lazy-value]").textContent === "lazy-chunk-loaded"', {
            sessionId: page,
            label: 'lazy chunk value',
        });
        const asset = await dom<{ ready: string; naturalWidth: number }>(
            '(() => { const img = document.querySelector("[data-proof-asset]");' +
                ' return { ready: document.querySelector("[data-proof-asset-ready]").textContent, naturalWidth: img.naturalWidth }; })()',
        );
        expect(asset.ready).toBe('true');
        expect(asset.naturalWidth).toBeGreaterThan(0);
    }, 60_000);

    test('the fixture’s optional right panel renders in the Board’s panel chrome', async () => {
        const panel = await dom<{ text: string; collapsed: string; source: string }>(
            '(() => { const panel = document.querySelector("[data-proof-panel]");' +
                ' return { text: panel ? panel.textContent : "",' +
                ' collapsed: document.querySelector(".board-layout").dataset.rightpanelCollapsed,' +
                ' source: window.__spurBoardProof.rightPanelSource }; })()',
        );
        expect(panel.text).toBe('fixture right panel');
        expect(panel.source).toBe('fixture');
        expect(panel.collapsed).toBe('false');
    }, 60_000);

    test('a malformed export and a throwing contribution leave the built-ins usable', async () => {
        const record = await proofRecord();
        expect(record.malformed).toEqual({ rejected: true, reason: 'apiVersion/component check failed' });
        expect(record.throwing).toEqual({ contained: true, message: THROW_MESSAGE });
        expect(record.builtInsAfter).toEqual(record.builtInsBefore);
        expect((record.builtInsAfter as string[]).length).toBeGreaterThanOrEqual(8);
        // The failing contribution is contained: the fixture still renders next to its boundary.
        expect(
            await dom<string>('document.querySelector("[data-proof-contribution] [data-proof-counter]").textContent'),
        ).not.toBe('');
        expect(await dom<boolean>('Boolean(document.querySelector("[data-proof-throwing=contained]"))')).toBe(true);

        // Built-ins stay navigable: a real deep page load into a built-in module route.
        await browser.navigate(`${server.origin}/board/designs`, page);
        await browser.waitFor('Boolean(document.querySelector("nav a[aria-current=page]"))', {
            sessionId: page,
            label: 'built-in module route to activate',
        });
        expect(await dom<string>('document.querySelector("nav a[aria-current=page]").getAttribute("href")')).toBe(
            '/board/designs',
        );
        expect(await dom<boolean>('Boolean(document.querySelector("[data-proof-root]"))')).toBe(false);
        expect(await dom<boolean>('Boolean(document.querySelector(".board-layout"))')).toBe(true);
    }, 60_000);
});
