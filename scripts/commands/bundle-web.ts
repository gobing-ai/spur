/**
 * Package the built Spur Board static assets into the CLI npm tarball.
 *
 * The published `@gobing-ai/spur` package must ship a `web/` directory next to
 * `spur.js` so `spur serve` can resolve board assets from any project cwd
 * (see `resolveWebDistPath` in apps/server/src/serve.ts). Without this step,
 * `/board` returns `{"error":"Not Found"}` after a global npm/bun install.
 *
 * Since task 0988 the board distribution also advertises the runtime it provides: the copied tree
 * must carry the import map in `index.html` and the distribution-root `board-runtime.json` whose
 * facade URLs resolve to emitted assets. A board build without that manifest is not packageable —
 * a consumer would map `react` to a missing asset instead of the renderer's module instance.
 *
 * Source: repo-root `dist/web` (produced by `bun run --filter '@gobing-ai/spur-web' build`).
 * Target: `apps/cli/web` by default (override with the first CLI arg).
 */
import { cp, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardHostRuntimeSchema } from '@gobing-ai/spur-contracts';
import { BOARD_FACADE_SPECIFIERS } from '../../apps/web/src/modules/runtime/manifest';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEFAULT_SOURCE = join(REPO_ROOT, 'dist/web');
const DEFAULT_TARGET = join(REPO_ROOT, 'apps/cli/web');

/** Frozen protocol version the packaged board must advertise (task 0988 R2). */
export const BOARD_RUNTIME_MANIFEST_FILE = 'board-runtime.json';
export const BOARD_RUNTIME_MANIFEST_VERSION = 1;

/** True when `dir/index.html` exists (board SPA entry). */
async function hasBoardIndex(dir: string): Promise<boolean> {
    return Bun.file(join(dir, 'index.html')).exists();
}

/**
 * Assert a copied board distribution advertises the runtime protocol it was built for.
 * Throws naming the offending file so a packaging regression is never silent.
 */
async function verifyBoardRuntime(dir: string): Promise<void> {
    const manifestPath = join(dir, BOARD_RUNTIME_MANIFEST_FILE);
    const manifestFile = Bun.file(manifestPath);
    if (!(await manifestFile.exists())) {
        throw new Error(`bundle-web: ${manifestPath} is missing — rebuild the board with the boardRuntime integration`);
    }
    let raw: unknown;
    try {
        raw = JSON.parse(await manifestFile.text());
    } catch (error) {
        throw new Error(`bundle-web: ${manifestPath} is not valid JSON: ${String(error)}`);
    }
    const parsed = boardHostRuntimeSchema
        .extend({ catalogVersion: boardHostRuntimeSchema.shape.manifestVersion })
        .safeParse(raw);
    if (!parsed.success)
        throw new Error(`bundle-web: ${manifestPath} has invalid runtime metadata: ${parsed.error.message}`);
    const manifest = parsed.data;
    for (const key of ['manifestVersion', 'catalogVersion', 'contributionApiVersion'] as const) {
        if (manifest[key] !== BOARD_RUNTIME_MANIFEST_VERSION) {
            throw new Error(
                `bundle-web: ${manifestPath} advertises ${key} ${manifest[key]}, expected ${BOARD_RUNTIME_MANIFEST_VERSION}`,
            );
        }
    }
    const imports = manifest.imports;
    for (const specifier of BOARD_FACADE_SPECIFIERS) {
        if (!imports[specifier]) {
            throw new Error(`bundle-web: ${manifestPath} does not map "${specifier}" to a facade asset`);
        }
    }
    for (const [specifier, url] of Object.entries(imports)) {
        if (!url.startsWith('/') || url.includes('*')) {
            throw new Error(`bundle-web: ${manifestPath} maps "${specifier}" to the unsupported URL "${url}"`);
        }
        if (!(await Bun.file(join(dir, url.replace(/^\//, ''))).exists())) {
            throw new Error(`bundle-web: facade asset for "${specifier}" is missing from the packaged board`);
        }
    }
    const html = await Bun.file(join(dir, 'index.html')).text();
    const importMap = /<script\b[^>]*\btype\s*=\s*["']importmap["'][^>]*>([\s\S]*?)<\/script\s*>/i.exec(html);
    const moduleScript = /<script\b[^>]*\btype\s*=\s*["']module["']/i.exec(html);
    if (!importMap || (moduleScript && moduleScript.index < importMap.index)) {
        throw new Error('bundle-web: import map must precede module scripts in index.html');
    }
    let mapped: unknown;
    try {
        mapped = JSON.parse(importMap[1] ?? '');
    } catch {
        throw new Error('bundle-web: import map in index.html is not valid JSON');
    }
    const map = boardHostRuntimeSchema.pick({ imports: true }).safeParse(mapped);
    if (
        !map.success ||
        Object.keys(map.data.imports).length !== Object.keys(imports).length ||
        Object.entries(imports).some(([key, value]) => map.data.imports[key] !== value)
    ) {
        throw new Error('bundle-web: import map in index.html differs from board-runtime.json');
    }
}

/** Resolve aliases even when the destination's final directories do not exist yet. */
async function canonicalPath(path: string): Promise<string> {
    const absolute = resolve(path);
    try {
        return await realpath(absolute);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return join(await canonicalPath(dirname(absolute)), basename(absolute));
    }
}

function contains(parent: string, child: string): boolean {
    const path = relative(parent, child);
    return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
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
    const sourcePath = await canonicalPath(resolvedSource);
    const targetPath = await canonicalPath(target);
    if (contains(sourcePath, targetPath) || contains(targetPath, sourcePath)) {
        throw new Error('bundle-web: source and destination overlap');
    }
    await verifyBoardRuntime(resolvedSource);
    await rm(target, { recursive: true, force: true });
    await cp(resolvedSource, target, { recursive: true });
    if (!(await hasBoardIndex(target))) {
        throw new Error(`bundle-web: copy succeeded but ${target}/index.html is missing`);
    }
    return { source: resolvedSource, target };
}
