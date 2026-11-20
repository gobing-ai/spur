/**
 * Ship the `laya-local` decision worker with the npm package (task 1262 R1).
 *
 * `@gobing-ai/ts-laya-mlx` resolves its Python worker as `join(import.meta.dir, '..', 'worker',
 * 'laya_worker.py')`. Bundled into `spur.js` that path points at
 * `node_modules/@gobing-ai/worker/laya_worker.py`, which does not exist, so every `laya-local`
 * ask failed in ~100 ms with `reason: error` (0/161 accepted under knowledge-kit). The package
 * already accepts an explicit `workerScript`; this step copies the worker next to the bundled
 * config root (`apps/cli/worker/`), which `DecisionService` resolves at runtime.
 *
 * A94 1410: the checkout is an explicit source root, so a downstream CLI project can stage its own
 * worker through `spur builder bundle-laya-worker`.
 */
import { cp, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BuildResult } from './compile';

/** Worker file name inside the installed package. */
const WORKER_FILE = 'laya_worker.py';

/** Worker staging options; the target defaults beside the CLI package's bundled config root. */
export interface BundleLayaWorkerOptions {
    sourceRoot: string;
    /** destination directory (default `<sourceRoot>/apps/cli/worker`) */
    target?: string;
}

/**
 * Locate the installed `@gobing-ai/ts-laya-mlx` package root by resolving its entry point from a
 * workspace that declares the dependency (`packages/app`), because bun hoists the package under
 * `node_modules/.bun/` and the root `node_modules/@gobing-ai` shim does not exist.
 */
async function resolvePackageRoot(sourceRoot: string): Promise<string> {
    const pkgEntry = Bun.resolveSync('@gobing-ai/ts-laya-mlx', join(sourceRoot, 'packages', 'app'));
    // Walk up from the entry to the nearest directory that owns a package.json.
    let dir = dirname(pkgEntry);
    for (let depth = 0; depth < 6; depth++) {
        const entries = await tryReaddir(dir);
        if (entries.includes('package.json')) {
            const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { name?: string };
            if (manifest.name === '@gobing-ai/ts-laya-mlx') return dir;
        }
        dir = dirname(dir);
    }
    throw new Error(`bundle-laya-worker: could not resolve the @gobing-ai/ts-laya-mlx package root from ${pkgEntry}`);
}

/** Directory listing, or an empty list when the path is not a readable directory. */
async function tryReaddir(dir: string): Promise<string[]> {
    try {
        return await readdir(dir);
    } catch {
        return [];
    }
}

/** File stat, or `undefined` when the path does not exist. */
async function tryStat(path: string): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
    try {
        return await stat(path);
    } catch {
        return undefined;
    }
}

/** Copy `worker/laya_worker.py` from the installed package into the CLI package tree. */
export async function bundleLayaWorker(options: BundleLayaWorkerOptions): Promise<BuildResult> {
    const target = options.target ?? join(options.sourceRoot, 'apps', 'cli', 'worker');
    const source = join(await resolvePackageRoot(options.sourceRoot), 'worker', WORKER_FILE);
    const sourceSize = await tryStat(source);
    if (sourceSize === undefined || !sourceSize.isFile()) {
        throw new Error(`bundle-laya-worker: installed worker missing at ${source}`);
    }
    await mkdir(target, { recursive: true });
    const destination = join(target, WORKER_FILE);
    await cp(source, destination);
    return {
        ok: true,
        sourceRoot: options.sourceRoot,
        artifacts: [
            { path: destination, kind: 'worker' },
            { path: source, kind: 'source' },
        ],
        diagnostics: [],
    };
}
