/**
 * Guard: npm publish must ship board static assets next to spur.js, otherwise
 * `spur serve` from an arbitrary project cwd returns JSON 404 on /board. Since task 0988 the
 * packaged board must also advertise its runtime (`board-runtime.json` + resolvable facade
 * assets) — those cases are covered here too.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleWeb } from './bundle-web';

/** Minimal board distribution that satisfies the packaging contract. */
async function writeBoardFixture(
    source: string,
    options: { manifest?: object | string; facade?: boolean } = {},
): Promise<void> {
    await writeFile(join(source, 'index.html'), '<html>board</html>');
    await mkdir(join(source, '_astro'), { recursive: true });
    await writeFile(join(source, '_astro', 'app.js'), 'console.log(1)');
    await writeFile(join(source, '_astro', 'board-facade-react.js'), 'export const useState = () => {};');
    if (options.facade === false) await rm(join(source, '_astro', 'board-facade-react.js'));
    if (options.manifest === undefined) {
        await writeFile(
            join(source, 'board-runtime.json'),
            JSON.stringify({
                manifestVersion: 1,
                catalogVersion: 1,
                contributionApiVersion: 1,
                imports: {
                    react: '/_astro/board-facade-react.js',
                    'react/jsx-runtime': '/_astro/board-facade-react.js',
                    'react/jsx-dev-runtime': '/_astro/board-facade-react.js',
                },
            }),
        );
    } else {
        await writeFile(
            join(source, 'board-runtime.json'),
            typeof options.manifest === 'string' ? options.manifest : JSON.stringify(options.manifest),
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
