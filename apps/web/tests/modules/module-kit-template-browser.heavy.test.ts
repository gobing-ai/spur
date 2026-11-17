/**
 * Real-browser proof of the Board module starter template (A81 1350 R2, AC1/AC2).
 *
 * The chain proven here is the one a downstream author walks:
 *
 *   template (`plugins/sp/skills/spur-composer/templates/board-module/`)
 *     -> installed `@gobing-ai/spur` tarball (packed, its Board distribution served as-is)
 *     -> Vite library build externalizing exactly the advertised specifiers
 *     -> declared module served at `/modules/<id>/*` through the shipped catalog path
 *     -> real Chromium: kit header / tabs / empty state, in both themes.
 *
 * Host-styling parity is measured, not asserted by eye: the same computed properties are read from
 * the module's shell and from a built-in module's shell, in each theme. Screenshots and a JSON
 * report are written to the gitignored `.spur/run/module-kit-proof/`; the committed snapshot under
 * `docs/reports/artifacts/module-kit-proof/` is refreshed from it deliberately.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoardCatalog, BoardHostRuntime } from '@gobing-ai/spur-contracts';
import { type BoardServer, serveBoard } from '../test-helpers/board-server';
import { availableBrowserBinary, type BrowserSession, launchBrowser } from '../test-helpers/cdp';
import { packCliTarball } from '../test-helpers/downstream-fixture';

const WEB_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REPO_ROOT = join(WEB_ROOT, '..', '..');
const TEMPLATE_DIR = join(REPO_ROOT, 'plugins/sp/skills/spur-composer/templates/board-module');
// Evidence goes to a gitignored plane: a heavy test that rewrites TRACKED files mid-pass moves the
// working tree, and `spur feature verify` fails a pass whose tree digest moved during the run. The
// committed snapshot under `docs/reports/artifacts/module-kit-proof/` is refreshed deliberately (see
// its README) and is never written by this test.
const ARTIFACT_DIR = join(REPO_ROOT, '.spur', 'run', 'module-kit-proof');

const MODULE_ID = 'kit-demo';
const browserReady = availableBrowserBinary() !== undefined;

/** Computed style facts that carry the host shell's look; compared module vs built-in. */
const PROBED_SELECTORS: Readonly<Record<string, string>> = {
    header: '[data-starter-module] > div:first-child',
    title: '[data-starter-module] h1',
    tablist: '[data-starter-module] [role="tablist"]',
    empty: '[data-starter-module] [data-testid="starter-empty"]',
};
const PROBED_PROPERTIES = ['borderBottomColor', 'paddingBottom', 'fontSize', 'fontWeight', 'backgroundColor'] as const;

let fixtureDir: string;
let moduleDist: string;
let boardDir: string;
let server: BoardServer;
let browser: BrowserSession;
let page: string;
let host: BoardHostRuntime;
/** Everything the artifact records. */
const report: Record<string, unknown> = {};

/** Run a command, refusing to continue on a non-zero exit. */
function run(command: string[], cwd: string, timeoutMs = 600_000): string {
    const proc = Bun.spawnSync(command, { cwd, stdout: 'pipe', stderr: 'pipe', timeout: timeoutMs });
    const output = `${proc.stdout.toString()}${proc.stderr.toString()}`;
    if (proc.exitCode !== 0) throw new Error(`${command.join(' ')} failed (${proc.exitCode}):\n${output}`);
    return output;
}

/** Installed version of a package this workspace resolves (walks up from its entry). */
async function installedVersion(name: string): Promise<string> {
    const entry = (() => {
        try {
            return Bun.resolveSync(`${name}/package.json`, WEB_ROOT);
        } catch {
            return Bun.resolveSync(name, WEB_ROOT);
        }
    })();
    let dir = join(entry, '..');
    for (let depth = 0; depth < 6; depth += 1) {
        const text = await readFile(join(dir, 'package.json'), 'utf-8').catch(() => undefined);
        if (text) {
            const pkg = JSON.parse(text) as { name?: string; version?: string };
            if (pkg.name === name && pkg.version) return pkg.version;
        }
        dir = join(dir, '..');
    }
    throw new Error(`cannot find the installed version of ${name}`);
}

/** Turn the built Board manifest into the catalog's host descriptor. */
function hostFrom(manifest: Record<string, unknown>): BoardHostRuntime {
    return {
        manifestVersion: manifest.manifestVersion as 1,
        contributionApiVersion: manifest.contributionApiVersion as 1,
        reactVersion: manifest.reactVersion as string,
        reactDomVersion: manifest.reactDomVersion as string,
        reactRouterVersion: manifest.reactRouterVersion as string,
        imports: manifest.imports as Record<string, string>,
        reservedModules: manifest.reservedModules as BoardHostRuntime['reservedModules'],
    };
}

/** Copy the template out of the checkout, install the packed package and build it. */
async function prepareFixture(): Promise<{ dir: string; dist: string; installed: string }> {
    const root = await mkdtemp(join(tmpdir(), 'spur-kit-template-'));
    const tarball = packCliTarball(root);
    const dir = join(root, 'starter');
    await cp(TEMPLATE_DIR, dir, { recursive: true });
    await writeFile(
        join(dir, 'package.json'),
        `${JSON.stringify(
            {
                name: 'spur-kit-template-proof',
                private: true,
                type: 'module',
                dependencies: {
                    '@gobing-ai/spur': `file:${tarball}`,
                    react: await installedVersion('react'),
                    'react-dom': await installedVersion('react-dom'),
                },
                devDependencies: {
                    '@types/react': await installedVersion('@types/react'),
                    '@types/react-dom': await installedVersion('@types/react-dom'),
                    typescript: await installedVersion('typescript'),
                    vite: await installedVersion('vite'),
                },
            },
            null,
            4,
        )}\n`,
        'utf-8',
    );
    run(['bun', 'install'], dir);
    run(['bun', 'node_modules/vite/bin/vite.js', 'build'], dir);
    return { dir, dist: join(dir, 'dist'), installed: join(dir, 'node_modules/@gobing-ai/spur') };
}

/** Read the probed computed styles on the currently loaded page, for one set of selectors. */
async function probe(selectorMap: Readonly<Record<string, string>>): Promise<Record<string, string>> {
    return browser.evaluate<Record<string, string>>(
        `(() => {
            const map = ${JSON.stringify(selectorMap)};
            const out = {};
            for (const [key, selector] of Object.entries(map)) {
                const element = document.querySelector(selector);
                if (!element) { out[key] = 'missing'; continue; }
                const style = getComputedStyle(element);
                out[key] = ${JSON.stringify(PROBED_PROPERTIES)}.map((property) => style[property]).join('|');
            }
            return out;
        })()`,
        { sessionId: page },
    );
}

/** Switch the Board theme the way the shipped toggle does. */
async function setTheme(theme: 'light' | 'dark'): Promise<void> {
    await browser.evaluate(`document.documentElement.setAttribute('data-theme', '${theme}')`, { sessionId: page });
}

/** Save one PNG screenshot and return its path. */
async function screenshot(name: string): Promise<string> {
    const result = (await browser.send('Page.captureScreenshot', { format: 'png' }, page)) as { data: string };
    const target = join(ARTIFACT_DIR, `${name}.png`);
    await writeFile(target, Buffer.from(result.data, 'base64'));
    // File name only: the report sits beside the shots and is copied into the tracked snapshot.
    return `${name}.png`;
}

beforeAll(async () => {
    // Gated as a whole, build proof included: the fixture packs the CLI, and its `prepack` bundle
    // fails on Linux because `@gobing-ai/ts-laya-mlx` is a darwin-only optional dependency
    // (ADR-041). So the whole chain is runnable where this file is runnable — a host with an
    // engine — and every test states that precondition instead of crashing on an undefined path.
    if (!browserReady) return;
    const prepared = await prepareFixture();
    fixtureDir = prepared.dir;
    moduleDist = prepared.dist;
    boardDir = join(prepared.installed, 'web');

    const manifest = JSON.parse(await readFile(join(boardDir, 'board-runtime.json'), 'utf-8')) as Record<
        string,
        unknown
    >;
    host = hostFrom(manifest);
    report.host = host;
    report.uiKitVersion = manifest.uiKitVersion;

    const catalog: BoardCatalog = {
        catalogVersion: 1,
        host,
        modules: [
            {
                id: MODULE_ID,
                name: 'Starter module',
                icon: '◆',
                type: 'react',
                route: `/modules/${MODULE_ID}`,
                entryUrl: `/modules/${MODULE_ID}/entry.js`,
                styles: [`/modules/${MODULE_ID}/style.css`],
                sidebarLabel: 'Starter',
                order: 1,
            },
        ],
    };
    await mkdir(ARTIFACT_DIR, { recursive: true });
    server = serveBoard(boardDir, { catalog, moduleAssets: { [MODULE_ID]: moduleDist } });
    browser = await launchBrowser();
    report.browser = browser.version;
    page = await browser.newPage();
}, 900_000);

afterAll(async () => {
    if (browser) await browser.close();
    server?.stop();
    if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
});

describe('starter template build (R1/R2)', () => {
    test('externalizes exactly the advertised specifiers and ships no host CSS', async () => {
        if (!browserReady) return;
        const entry = await readFile(join(moduleDist, 'entry.js'), 'utf-8');
        const style = await readFile(join(moduleDist, 'style.css'), 'utf-8');
        const advertised = Object.keys(host.imports);
        const imported = [...entry.matchAll(/from\s*"([^"]+)"/g)].map((match) => match[1] as string);

        expect(imported.length).toBeGreaterThan(0);
        for (const specifier of imported) expect(advertised).toContain(specifier);
        // The kit comes from the host, not a bundled copy.
        expect(imported).toContain('@gobing-ai/spur/board/ui');
        // Module-private CSS only: no host stylesheet, no Tailwind output, no global reset.
        expect(style).not.toContain(':root');
        expect(style).not.toContain('@theme');
        expect(style).not.toContain('--color-base');
        expect(style.length).toBeLessThan(2048);
        report.build = { imported, styleBytes: style.length, entryBytes: entry.length };
    });
});

describe('installed Board renders the template (AC1/AC2)', () => {
    test('the declared module route renders the kit header, tabs and empty state', async () => {
        if (!browserReady) return;
        await browser.navigate(`${server.origin}/board/modules/${MODULE_ID}`, page);
        await browser.waitFor('Boolean(document.querySelector("[data-starter-module] h1"))', {
            sessionId: page,
            label: 'module shell mounted',
        });

        expect(
            await browser.evaluate<string>('document.querySelector("[data-starter-module] h1").textContent', {
                sessionId: page,
            }),
        ).toBe('Starter module');
        const tabs = await browser.evaluate<string[]>(
            '[...document.querySelectorAll(\'[data-starter-module] [role="tab"]\')].map((tab) => tab.textContent)',
            { sessionId: page },
        );
        expect(tabs).toEqual(['Overview', 'Settings']);
        // The shell's own module marker is the contribution's, not the host's.
        expect(
            await browser.evaluate<boolean>('Boolean(document.querySelector("[data-testid=starter-empty]"))', {
                sessionId: page,
            }),
        ).toBe(true);
        // The module's own assets all resolved through the declared entry/styles URLs.
        expect(browser.failedRequests().filter((url) => url.includes(`/modules/${MODULE_ID}/`))).toEqual([]);
    });

    test('kit styles match the built-in shell in both themes', async () => {
        if (!browserReady) return;
        const comparisons: Record<string, unknown> = {};

        for (const theme of ['light', 'dark'] as const) {
            await browser.navigate(`${server.origin}/board/modules/${MODULE_ID}`, page);
            await browser.waitFor('Boolean(document.querySelector("[data-starter-module] h1"))', {
                sessionId: page,
                label: `${theme}: module shell`,
            });
            await setTheme(theme);
            const moduleStyles = await probe(PROBED_SELECTORS);
            const moduleShot = await screenshot(`module-${theme}`);

            await browser.navigate(`${server.origin}/board/observability`, page);
            await browser.waitFor('Boolean(document.querySelector("[data-observability-shell] h1"))', {
                sessionId: page,
                label: `${theme}: built-in shell`,
            });
            await setTheme(theme);
            const builtinStyles = await probe({
                header: '[data-observability-shell] > div:first-child',
                title: '[data-observability-shell] h1',
                tablist: '[data-observability-shell] [role="tablist"]',
            });
            const builtinShot = await screenshot(`builtin-${theme}`);

            // The shell primitives are the same code, so the shared properties are identical.
            for (const key of ['header', 'title', 'tablist'] as const) {
                expect([theme, key, moduleStyles[key]]).toEqual([theme, key, builtinStyles[key]]);
            }
            expect(moduleStyles.empty).not.toBe('missing');
            comparisons[theme] = { module: moduleStyles, builtin: builtinStyles, moduleShot, builtinShot };
        }

        // The tokens resolve: the two themes do not compute the same colors.
        const light = comparisons.light as { module: Record<string, string> };
        const dark = comparisons.dark as { module: Record<string, string> };
        expect(light.module.title).not.toBe(dark.module.title);
        report.themes = comparisons;
    });

    test('writes the repeatable evidence artifact', async () => {
        if (!browserReady) return;
        report.generatedAt = new Date().toISOString();
        report.moduleDist = MODULE_ID;
        await writeFile(join(ARTIFACT_DIR, 'report.json'), `${JSON.stringify(report, null, 4)}\n`, 'utf-8');
        const written = await readFile(join(ARTIFACT_DIR, 'report.json'), 'utf-8');
        expect(JSON.parse(written)).toHaveProperty('themes.dark.module.title');
    });
});
