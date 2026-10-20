/**
 * Ship the `laya-local` decision worker with the npm package (task 1262 R1).
 *
 * `@gobing-ai/ts-laya-mlx` resolves its Python worker as `join(import.meta.dir, '..', 'worker',
 * 'laya_worker.py')`. Bundled into `spur.js` that path points at
 * `node_modules/@gobing-ai/worker/laya_worker.py`, which does not exist, so every `laya-local`
 * ask failed in ~100 ms with `reason: error` (0/161 accepted under knowledge-kit). The package
 * already accepts an explicit `workerScript`; this step copies the worker next to the bundled
 * config root (`apps/cli/worker/`), which `DecisionService` resolves at runtime.
 */
import { cp, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
/** Default destination: the CLI package's packaged root, beside its bundled `config/`. */
const DEFAULT_TARGET = join(REPO_ROOT, 'apps', 'cli', 'worker');

/** Worker file name inside the installed package. */
const WORKER_FILE = 'laya_worker.py';

/**
 * Locate the installed `@gobing-ai/ts-laya-mlx` package root by resolving its entry point from a
 * workspace that declares the dependency (`packages/app`), because bun hoists the package under
 * `node_modules/.bun/` and the root `node_modules/@gobing-ai` shim does not exist.
 */
async function resolvePackageRoot(): Promise<string> {
    const pkgEntry = Bun.resolveSync('@gobing-ai/ts-laya-mlx', join(REPO_ROOT, 'packages', 'app'));
    // Walk up from the entry to the nearest directory that owns a package.json.
    let dir = dirname(pkgEntry);
    for (let depth = 0; depth < 6; depth++) {
        const entries = await readdir(dir).catch(() => [] as string[]);
        if (entries.includes('package.json')) {
            const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { name?: string };
            if (manifest.name === '@gobing-ai/ts-laya-mlx') return dir;
        }
        dir = dirname(dir);
    }
    throw new Error(`bundle-laya-worker: could not resolve the @gobing-ai/ts-laya-mlx package root from ${pkgEntry}`);
}

/** Copy `worker/laya_worker.py` from the installed package into `target` (default: apps/cli/worker). */
export async function bundleLayaWorker(
    target: string = DEFAULT_TARGET,
): Promise<{ target: string; source: string; bytes: number }> {
    const source = join(await resolvePackageRoot(), 'worker', WORKER_FILE);
    const sourceSize = await stat(source).catch(() => undefined);
    if (sourceSize === undefined || !sourceSize.isFile()) {
        throw new Error(`bundle-laya-worker: installed worker missing at ${source}`);
    }
    await mkdir(target, { recursive: true });
    const destination = join(target, WORKER_FILE);
    await cp(source, destination);
    const { size } = await stat(destination);
    return { target: destination, source, bytes: size };
}
