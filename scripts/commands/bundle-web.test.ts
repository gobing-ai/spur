/**
 * Guard: npm publish must ship board static assets next to spur.js, otherwise
 * `spur serve` from an arbitrary project cwd returns JSON 404 on /board. Since task 0988 the
 * packaged board must also advertise its runtime (`board-runtime.json` + resolvable facade
 * assets) — those cases are covered here too.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    BOARD_FACADE_SPECIFIERS,
    buildRuntimeManifest,
    renderImportMapScript,
} from '../../apps/web/src/modules/runtime/manifest';
import { bundleWeb } from './bundle-web';

/** Minimal board distribution that satisfies the packaging contract. */
async function writeBoardFixture(
    source: string,
    options: { manifest?: object | string; facade?: boolean } = {},
): Promise<void> {
    const base = buildRuntimeManifest({
        versions: { react: '19.2.1', reactDom: '19.2.1', reactRouter: '7.11.0' },
        imports: Object.fromEntries(
            BOARD_FACADE_SPECIFIERS.map((specifier) => [specifier, '/_astro/board-facade-react.js']),
        ),
        reservedModules: [],
    });
    await writeFile(
        join(source, 'index.html'),
        `<html>${renderImportMapScript(base)}<script type="module" src="/_astro/app.js"></script>board</html>`,
    );
    await mkdir(join(source, '_astro'), { recursive: true });
    await writeFile(join(source, '_astro', 'app.js'), 'console.log(1)');
    await writeFile(join(source, '_astro', 'board-facade-react.js'), 'export const useState = () => {};');
    if (options.facade === false) await rm(join(source, '_astro', 'board-facade-react.js'));
    if (options.manifest === undefined) {
        await writeFile(join(source, 'board-runtime.json'), JSON.stringify(base));
    } else {
        await writeFile(
            join(source, 'board-runtime.json'),
            typeof options.manifest === 'string'
                ? options.manifest
                : JSON.stringify({
                      ...base,
                      ...options.manifest,
                      imports: { ...base.imports, ...(options.manifest as { imports?: object }).imports },
                  }),
        );
    }
}

describe('bundleWeb', () => {
    let source: string;
    let target: string;

    afterEach(async () => {
        if (source) await rm(source, { recursive: true, force: true });
        if (target) await rm(target, { recursive: true, force: true });
    });

    test.each([
        'same',
        'ancestor',
        'descendant',
        'symlink',
    ])('rejects %s source/destination overlap without deleting assets', async (kind) => {
        target = await mkdtemp(join(tmpdir(), 'spur-web-overlap-'));
        source = join(target, 'source');
        await mkdir(source);
        await writeBoardFixture(source);
        let destination = kind === 'same' ? source : kind === 'ancestor' ? target : join(source, 'nested', 'output');
        if (kind === 'symlink') {
            await symlink(target, join(target, 'alias'));
            destination = join(target, 'alias', 'source', 'nested', 'output');
        }
        await expect(bundleWeb(destination, source)).rejects.toThrow(/overlap/);
        expect(await Bun.file(join(source, 'index.html')).exists()).toBe(true);
    });

    test.each([
        'catalogVersion',
        'contributionApiVersion',
        'reactVersion',
        'reactDomVersion',
        'reactRouterVersion',
        'reservedModules',
    ])('rejects invalid %s metadata before replacing the destination', async (field) => {
        source = await mkdtemp(join(tmpdir(), 'spur-web-protocol-'));
        target = await mkdtemp(join(tmpdir(), 'spur-web-preserved-'));
        await writeFile(join(target, 'keep.txt'), 'previous distribution');
        await writeBoardFixture(source);
        const manifest: Record<string, unknown> = await Bun.file(join(source, 'board-runtime.json')).json();
        manifest[field] = field.endsWith('Version') && !field.startsWith('react') ? 99 : null;
        await writeFile(join(source, 'board-runtime.json'), JSON.stringify(manifest));
        await expect(bundleWeb(target, source)).rejects.toThrow(/board-runtime/);
        expect(await Bun.file(join(target, 'keep.txt')).text()).toBe('previous distribution');
    });

    test.each(['missing', 'mismatched', 'late', 'malformed'])('rejects a %s import map', async (kind) => {
        source = await mkdtemp(join(tmpdir(), 'spur-web-importmap-'));
        target = join(await mkdtemp(join(tmpdir(), 'spur-web-dst-')), 'web');
        await writeBoardFixture(source);
        let html = await Bun.file(join(source, 'index.html')).text();
        if (kind === 'missing') html = html.replace(/<script type="importmap">.*?<\/script>/, '');
        if (kind === 'mismatched') html = html.replace('/_astro/board-facade-react.js', '/_astro/wrong.js');
        if (kind === 'late') html = html.replace('<html>', '<html><script type="module" src="/early.js"></script>');
        if (kind === 'malformed') html = html.replace('{"imports":', '{invalid:');
        await writeFile(join(source, 'index.html'), html);
        await expect(bundleWeb(target, source)).rejects.toThrow(/import map/);
    });

    test('rejects a missing supported facade mapping', async () => {
        source = await mkdtemp(join(tmpdir(), 'spur-web-mapping-'));
        target = join(await mkdtemp(join(tmpdir(), 'spur-web-dst-')), 'web');
        await writeBoardFixture(source);
        const manifest = await Bun.file(join(source, 'board-runtime.json')).json();
        delete manifest.imports['react-dom/client'];
        await writeFile(join(source, 'board-runtime.json'), JSON.stringify(manifest));
        await expect(bundleWeb(target, source)).rejects.toThrow(/react-dom\/client/);
    });

    test('copies index.html and nested assets into the CLI package web/ dir', async () => {
        source = await mkdtemp(join(tmpdir(), 'spur-web-src-'));
        target = await mkdtemp(join(tmpdir(), 'spur-web-dst-'));
        // mkdtemp creates the target; bundleWeb rm+cp's into it — use a nested dest
        const dest = join(target, 'web');
        await writeBoardFixture(source);

        const result = await bundleWeb(dest, source);
        expect(result.target).toBe(dest);
        expect(await Bun.file(join(dest, 'index.html')).exists()).toBe(true);
        expect(await Bun.file(join(dest, '_astro', 'app.js')).text()).toBe('console.log(1)');
        expect(await Bun.file(join(dest, 'board-runtime.json')).exists()).toBe(true);
    });

    test('throws when a custom source has no board index.html', async () => {
        source = await mkdtemp(join(tmpdir(), 'spur-web-empty-'));
        target = join(await mkdtemp(join(tmpdir(), 'spur-web-dst-')), 'web');
        await expect(bundleWeb(target, source)).rejects.toThrow(/index\.html is missing/);
    });

    test('refuses to package a board without the runtime manifest (task 0988 R2)', async () => {
        source = await mkdtemp(join(tmpdir(), 'spur-web-nomanifest-'));
        target = join(await mkdtemp(join(tmpdir(), 'spur-web-dst-')), 'web');
        await writeBoardFixture(source, { manifest: undefined });
        await rm(join(source, 'board-runtime.json'));
        await expect(bundleWeb(target, source)).rejects.toThrow(/board-runtime\.json is missing/);
    });

    test('refuses a manifest whose protocol version or facade asset is wrong', async () => {
        source = await mkdtemp(join(tmpdir(), 'spur-web-badmanifest-'));
        target = join(await mkdtemp(join(tmpdir(), 'spur-web-dst-')), 'web');
        await writeBoardFixture(source, { manifest: { manifestVersion: 2, imports: {} } });
        await expect(bundleWeb(target, source)).rejects.toThrow(/manifestVersion 2/);

        await writeBoardFixture(source, {});
        await rm(join(source, '_astro', 'board-facade-react.js'));
        await expect(bundleWeb(target, source)).rejects.toThrow(/facade asset for "react" is missing/);
    });

    test('refuses an unsupported facade URL shape', async () => {
        source = await mkdtemp(join(tmpdir(), 'spur-web-badurl-'));
        target = join(await mkdtemp(join(tmpdir(), 'spur-web-dst-')), 'web');
        await writeBoardFixture(source, {
            manifest: {
                manifestVersion: 1,
                imports: {
                    react: 'https://cdn.example.test/react.js',
                    'react/jsx-runtime': '/_astro/board-facade-react.js',
                    'react/jsx-dev-runtime': '/_astro/board-facade-react.js',
                },
            },
        });
        await expect(bundleWeb(target, source)).rejects.toThrow(/unsupported URL/);
    });
});
