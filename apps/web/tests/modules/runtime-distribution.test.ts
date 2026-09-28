/**
 * Board runtime distribution contract (task 0988 R2, AC1 evidence half).
 *
 * Builds the board freshly (never trusting an existing `dist/web`) and asserts the frozen
 * distribution outputs a consumer reads before loading any project contribution:
 * `board-runtime.json`, the emitted React/JSX facade assets, and the import map that must
 * precede the document's first module import.
 *
 * The runtime half of AC1 (actual shared-instance identity in a real browser) lives in
 * `board-runtime-browser.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BOARD_FACADE_SPECIFIERS, type BoardRuntimeManifest } from '../../src/modules/runtime/manifest';
import { buildBoardToTemp, removeBoardBuild, WEB_ROOT } from '../test-helpers/board-build';

let dist: string;

/** Installed version of a package the workspace resolves (walks up from its entry). */
async function installedVersion(name: string): Promise<string> {
    let dir = join(Bun.resolveSync(name, WEB_ROOT), '..');
    for (let depth = 0; depth < 6; depth += 1) {
        const text = await readFile(join(dir, 'package.json'), 'utf-8').catch(() => undefined);
        if (text) {
            const pkg = JSON.parse(text) as { name?: string; version?: string };
            if (pkg.name === name && pkg.version) return pkg.version;
        }
        dir = join(dir, '..');
    }
    throw new Error(`cannot find the installed version of ${name} from ${Bun.resolveSync(name, WEB_ROOT)}`);
}

/** Read the distribution manifest. */
async function manifest(): Promise<BoardRuntimeManifest> {
    return JSON.parse(await readFile(join(dist, 'board-runtime.json'), 'utf-8')) as BoardRuntimeManifest;
}

/** Import URL for a supported specifier, asserted present. */
function importUrl(runtime: BoardRuntimeManifest, specifier: string): string {
    const url = runtime.imports[specifier];
    if (!url) throw new Error(`manifest does not map "${specifier}"`);
    return url;
}

/** Relative chunk imports of one emitted asset. */
async function chunkImports(asset: string): Promise<Set<string>> {
    const text = await readFile(join(dist, asset.replace(/^\//, '')), 'utf-8');
    return new Set([...text.matchAll(/from"(\.\/[^"]+)"/g)].map((match) => (match[1] as string).slice(2)));
}

beforeAll(async () => {
    dist = await buildBoardToTemp();
}, 300_000);

afterAll(async () => {
    await removeBoardBuild(dist);
});

describe('board-runtime.json (R2)', () => {
    test('sits at the web distribution root with the frozen protocol versions', async () => {
        const runtime = await manifest();
        expect(runtime.manifestVersion).toBe(1);
        expect(runtime.catalogVersion).toBe(1);
        expect(runtime.contributionApiVersion).toBe(1);
    });

    test('records the versions the client build actually resolved', async () => {
        const runtime = await manifest();
        expect(runtime.reactVersion).toBe(await installedVersion('react'));
        expect(runtime.reactDomVersion).toBe(await installedVersion('react-dom'));
        expect(runtime.reactRouterVersion).toBe(await installedVersion('react-router'));
        // Observed install (task 0988 recon): the board pins React/React DOM 19.2.1, router 7.11.0.
        expect(runtime.reactVersion).toBe('19.2.1');
        expect(runtime.reactRouterVersion).toBe('7.11.0');
    });

    test('lists every supported specifier explicitly, with a real emitted asset behind each', async () => {
        const runtime = await manifest();
        expect(Object.keys(runtime.imports).sort()).toEqual([...BOARD_FACADE_SPECIFIERS].sort());
        for (const [specifier, url] of Object.entries(runtime.imports)) {
            expect(specifier).not.toContain('*');
            expect(url.startsWith('/')).toBeTrue();
            expect(url).not.toContain('*');
            expect(await Bun.file(join(dist, url.replace(/^\//, ''))).exists()).toBe(true);
        }
    });

    test('every facade asset re-exports the api the specifier promises', async () => {
        const runtime = await manifest();
        const react = await readFile(join(dist, importUrl(runtime, 'react').replace(/^\//, '')), 'utf-8');
        expect(react).toMatch(/as useState\b/);
        expect(react).toMatch(/as useRef\b/);
        const jsx = await readFile(join(dist, importUrl(runtime, 'react/jsx-runtime').replace(/^\//, '')), 'utf-8');
        expect(jsx).toMatch(/as jsx\b/);
        expect(jsx).toMatch(/as Fragment\b/);
    });

    test('facade chunks are drawn from the renderer’s own graph chunks', async () => {
        const runtime = await manifest();
        const html = await readFile(join(dist, 'index.html'), 'utf-8');
        const island = html.match(/component-url="(\/_astro\/[^"]+)"/)?.[1];
        expect(island).toBeDefined();

        const boardChunks = new Set<string>();
        for (const entry of await readdir(join(dist, '_astro'))) {
            if (/^BoardApp\..*\.js$/.test(entry)) {
                for (const imported of await chunkImports(`/_astro/${entry}`)) boardChunks.add(imported);
            }
        }
        // The island entry imports react/jsx-runtime through shared chunks; the facades must
        // resolve to those same files, otherwise the consumer gets a second React instance.
        for (const specifier of ['react', 'react/jsx-runtime'] as const) {
            const facadeChunks = await chunkImports(importUrl(runtime, specifier));
            expect(facadeChunks.size).toBeGreaterThan(0);
            for (const chunk of facadeChunks) {
                expect([...boardChunks]).toContain(chunk);
            }
        }
    });

    test('reserved identities are generated from the board’s own declarations', async () => {
        const runtime = await manifest();
        const generated = Bun.spawnSync(['bun', 'scripts/host-inventory.ts'], { cwd: WEB_ROOT, stdout: 'pipe' });
        expect(generated.exitCode).toBe(0);
        expect(runtime.reservedModules).toEqual(JSON.parse(generated.stdout.toString()));

        const ids = runtime.reservedModules.map((mod) => mod.id);
        for (const builtIn of ['tasks', 'designs', 'projects', 'settings']) expect(ids).toContain(builtIn);
        expect(runtime.reservedModules.find((mod) => mod.id === 'workspace')).toEqual({
            id: 'workspace',
            route: 'workspace',
            retired: true,
            redirectTo: '/board/projects',
        });
        expect(runtime.reservedModules.find((mod) => mod.id === 'inbox')?.retired).toBeTrue();
        expect(runtime.reservedModules.find((mod) => mod.id === 'teams')?.retired).toBeTrue();
    });

    test('a shipped board carries no test route or fixture', async () => {
        const runtime = await manifest();
        // `test-board-runtime-proof` is the browser-proof adapter's module id: if it ever shows up
        // here, a proof build left its injected module behind.
        expect(runtime.reservedModules.map((mod) => mod.id)).not.toContain('test-board-runtime-proof');
        expect(runtime.reservedModules.some((mod) => mod.id.startsWith('__tests'))).toBeFalse();
        const html = await readFile(join(dist, 'index.html'), 'utf-8');
        expect(html).not.toContain('__tests-board-adapter__');
        expect(html).not.toContain('/__test__/');
    });
});

describe('import map injection (R2)', () => {
    test('is present in the built document and equal to the manifest imports', async () => {
        const runtime = await manifest();
        const html = await readFile(join(dist, 'index.html'), 'utf-8');
        const map = html.match(/<script type="importmap">(.*?)<\/script>/s);
        expect(map).not.toBeNull();
        expect(JSON.parse(map?.[1] as string)).toEqual({ imports: runtime.imports });
    });

    test('installs before the document’s first module import', async () => {
        const html = await readFile(join(dist, 'index.html'), 'utf-8');
        const mapIndex = html.indexOf('<script type="importmap">');
        expect(mapIndex).toBeGreaterThan(-1);
        // The astro island loads its component with a runtime `import()`; the doc's own theme
        // script is a module script. Every script in this document comes after the import map.
        expect(html.indexOf('<script', mapIndex + 1)).toBeGreaterThan(mapIndex);
        expect(mapIndex).toBeLessThan(html.indexOf('type="module"'));
        expect(mapIndex).toBeLessThan(html.indexOf('component-url'));
        expect(html.match(/<script type="importmap">/g)).toHaveLength(1);
    });
});
