/**
 * Downstream consumer setup for the task 0988 browser proof (R3/R4).
 *
 * Builds the evidence chain the task asks for, outside the Spur checkout:
 *   repo tarball (`@gobing-ai/spur`)  ->  consumer install with its OWN React  ->  Vite library
 *   build of the fixture ESM  ->  copied into a temporary Board proof build at a fixed test asset
 *   path  ->  served under the installed Board renderer in a real browser.
 *
 * The consumer also type-checks its entry against the installed tarball's declaration-only
 * `@gobing-ai/spur/board` export.
 */
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (assertions use it to prove the consumer lives outside the checkout). */
export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** Fixture sources copied into the consumer. */
const FIXTURE_SOURCE = join(REPO_ROOT, 'apps/web/tests/fixtures/downstream-board');

/** Assets the proof build must receive at the fixed test path. */
export const FIXTURE_ASSETS = ['index.js', 'style.css', 'own-react.js', 'malformed.js', 'throwing.js'] as const;

/** A prepared, installed and built downstream consumer. */
export interface DownstreamConsumer {
    readonly dir: string;
    readonly distDir: string;
    /** Type-check result of `src/` against the installed `@gobing-ai/spur/board` declaration. */
    readonly typecheck: { readonly code: number; readonly output: string };
    /** Absolute path of the installed declaration-only export inside the consumer. */
    readonly installedBoardTypes: string;
    /** Absolute path of the installed board distribution manifest. */
    readonly installedRuntimeManifest: string;
}

/** Run a command in a directory (inheriting this process's environment), returning its output. */
function run(command: string[], cwd: string, timeoutMs = 300_000): { code: number; output: string } {
    const proc = Bun.spawnSync(command, { cwd, stdout: 'pipe', stderr: 'pipe', timeout: timeoutMs });
    return { code: proc.exitCode, output: `${proc.stdout.toString()}${proc.stderr.toString()}` };
}

/** Throw with full command output when a step fails. */
function must(result: { code: number; output: string }, label: string): void {
    if (result.code !== 0) throw new Error(`${label} failed (exit ${result.code}):\n${result.output}`);
}

/**
 * Pack `@gobing-ai/spur` locally (the real release path: `prepack` builds the bundle, the board
 * assets and the declaration artifact).
 *
 * `prepack` chains into `build:bundle` → `bundle-web`, which copies the board out of `dist/web` and
 * refuses to package a board whose runtime manifest is missing. A fresh board build is therefore a
 * hard precondition of packing, and it is built HERE rather than assumed: `dist/` is gitignored, so
 * a fresh clone, a CI runner or a tree that never ran `bun run build` would otherwise fail with a
 * confusing `bundle-web` error rather than a clear one. This also keeps the helper's own contract —
 * that distribution evidence never comes from a `dist/web` that merely happens to exist.
 */
export function packCliTarball(destination: string): string {
    const boardBuild = run(['bun', 'run', '--filter', '@gobing-ai/spur-web', 'build'], REPO_ROOT, 600_000);
    must(boardBuild, 'board build (dist/web)');
    const result = run(['bun', 'pm', 'pack', '--destination', destination, '--quiet'], join(REPO_ROOT, 'apps/cli'));
    must(result, 'bun pm pack');
    const tarball = result.output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.endsWith('.tgz'))
        .pop();
    if (!tarball) throw new Error(`bun pm pack produced no tarball:\n${result.output}`);
    return tarball.startsWith('/') ? tarball : join(destination, tarball);
}

/**
 * Copy the fixture outside the checkout, install its own React + the packed tarball, build both
 * Vite passes and type-check the entry.
 */
export async function prepareDownstreamConsumer(tarball: string, parentDir: string): Promise<DownstreamConsumer> {
    const dir = await mkdtemp(join(parentDir, 'consumer-'));
    if (dir.startsWith(REPO_ROOT)) {
        throw new Error(`downstream fixture must live outside the checkout, got ${dir}`);
    }
    await cp(FIXTURE_SOURCE, dir, { recursive: true });
    await writeFile(
        join(dir, 'package.json'),
        (await readFile(join(FIXTURE_SOURCE, 'package.json'), 'utf-8')).replace('__SPUR_TARBALL__', tarball),
        'utf-8',
    );

    must(run(['bun', 'install'], dir), 'bun install (downstream consumer)');

    // Own-React pass first (it empties dist/), then the externalized library build.
    must(
        run(['bun', 'node_modules/vite/bin/vite.js', 'build', '--config', 'vite.own-react.config.ts'], dir),
        'vite own-react build',
    );
    must(
        run(['bun', 'node_modules/vite/bin/vite.js', 'build', '--config', 'vite.config.ts'], dir),
        'vite fixture build',
    );

    const typecheck = run(['bun', 'node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.json'], dir);

    return {
        dir,
        distDir: join(dir, 'dist'),
        typecheck: { code: typecheck.code, output: typecheck.output },
        installedBoardTypes: join(dir, 'node_modules/@gobing-ai/spur/board/index.d.ts'),
        installedRuntimeManifest: join(dir, 'node_modules/@gobing-ai/spur/web/board-runtime.json'),
    };
}

/** Copy the built fixture into a proof build at the fixed test asset path the adapter imports. */
export async function deployFixtureIntoBoardBuild(distDir: string, boardBuildDir: string): Promise<string> {
    const target = join(boardBuildDir, '__test__/downstream');
    await cp(distDir, target, { recursive: true });
    for (const asset of FIXTURE_ASSETS) {
        if (!(await Bun.file(join(target, asset)).exists())) {
            throw new Error(`fixture build did not emit ${asset} (looked in ${target})`);
        }
    }
    return target;
}
