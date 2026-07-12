/**
 * Guard: npm publish must ship board static assets next to spur.js, otherwise
 * `spur serve` from an arbitrary project cwd returns JSON 404 on /board.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleWeb } from './bundle-web';

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
        await writeFile(join(source, 'index.html'), '<html>board</html>');
        await mkdir(join(source, '_astro'), { recursive: true });
        await writeFile(join(source, '_astro', 'app.js'), 'console.log(1)');

        const result = await bundleWeb(dest, source);
        expect(result.target).toBe(dest);
        expect(await Bun.file(join(dest, 'index.html')).exists()).toBe(true);
        expect(await Bun.file(join(dest, '_astro', 'app.js')).text()).toBe('console.log(1)');
    });

    test('throws when a custom source has no board index.html', async () => {
        source = await mkdtemp(join(tmpdir(), 'spur-web-empty-'));
        target = join(await mkdtemp(join(tmpdir(), 'spur-web-dst-')), 'web');
        await expect(bundleWeb(target, source)).rejects.toThrow(/index\.html is missing/);
    });
});
