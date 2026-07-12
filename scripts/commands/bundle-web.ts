/**
 * Package the built Spur Board static assets into the CLI npm tarball.
 *
 * The published `@gobing-ai/spur` package must ship a `web/` directory next to
 * `spur.js` so `spur serve` can resolve board assets from any project cwd
 * (see `resolveWebDistPath` in apps/server/src/serve.ts). Without this step,
 * `/board` returns `{"error":"Not Found"}` after a global npm/bun install.
 *
 * Source: repo-root `dist/web` (produced by `bun run --filter '@gobing-ai/spur-web' build`).
 * Target: `apps/cli/web` by default (override with the first CLI arg).
 */
import { cp, rm } from 'node:fs/promises';
import { join } from 'node:path';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const DEFAULT_SOURCE = join(REPO_ROOT, 'dist/web');
const DEFAULT_TARGET = join(REPO_ROOT, 'apps/cli/web');

/** True when `dir/index.html` exists (board SPA entry). */
async function hasBoardIndex(dir: string): Promise<boolean> {
    return Bun.file(join(dir, 'index.html')).exists();
}

/**
 * Ensure the board source exists. When the default monorepo `dist/web` path is
 * missing, run the web workspace build. Custom sources are not auto-built —
 * callers must supply a directory that already contains `index.html`.
 */
async function ensureWebBuild(source: string): Promise<string> {
    if (await hasBoardIndex(source)) return source;

    if (source !== DEFAULT_SOURCE) {
        throw new Error(`bundle-web: ${source}/index.html is missing`);
    }

    console.log('bundle-web: dist/web missing — building @gobing-ai/spur-web …');
    const result = Bun.spawnSync(['bun', 'run', '--filter', '@gobing-ai/spur-web', 'build'], {
        cwd: REPO_ROOT,
        stdio: ['ignore', 'inherit', 'inherit'],
    });
    if (result.exitCode !== 0) {
        throw new Error(`web build failed (exit ${result.exitCode})`);
    }
    if (!(await hasBoardIndex(source))) {
        throw new Error(`web build finished but ${source}/index.html is still missing`);
    }
    return source;
}

/**
 * Copy the built board assets into the CLI package tree for npm publish.
 *
 * @param target - destination directory (default: `apps/cli/web`)
 * @param source - built web dist (default: `dist/web`)
 */
export async function bundleWeb(
    target: string = DEFAULT_TARGET,
    source: string = DEFAULT_SOURCE,
): Promise<{ source: string; target: string }> {
    const resolvedSource = await ensureWebBuild(source);
    await rm(target, { recursive: true, force: true });
    await cp(resolvedSource, target, { recursive: true });
    if (!(await hasBoardIndex(target))) {
        throw new Error(`bundle-web: copy succeeded but ${target}/index.html is missing`);
    }
    return { source: resolvedSource, target };
}
