/**
 * Fresh board builds for runtime-distribution tests (task 0988).
 *
 * The task's distribution evidence must come from a build made by the test, never from a
 * `dist/web` that happens to exist (the plan's step 0 precondition).
 */
import { cpSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEnvVar } from '@gobing-ai/spur-config';

/** `apps/web` — the workspace whose Astro build emits the board distribution. */
export const WEB_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Astro CLI entry (Vite itself is not a direct dependency of this workspace). */
const ASTRO_BIN = join(WEB_ROOT, 'node_modules/.bin/astro');

/**
 * Where a proof build's test-only contribution module is injected (task 0988 R4).
 *
 * The Board discovers modules under `src/modules/`, so a proof build copies its adapter there
 * around one build only and removes it once the build settles — including on failure. The build
 * integration deliberately has no test seam; `runtime-distribution.test.ts` fails if a production
 * build ever contains this module, which is the alarm for a crashed proof build leaving a
 * leftover.
 */
export const TEST_ADAPTER_MODULE_DIR = join(WEB_ROOT, 'src/modules/__tests-board-adapter__');

/**
 * Environment variable the launcher sets to the run-scoped seed directory (task 1462 R1).
 *
 * Set only by `scripts/commands/run-tests.ts`, so a direct `bun test` never seeds: the seed lives
 * exactly as long as that launcher's registry directory.
 */
export const BOARD_SEED_ENV = 'SPUR_TEST_BOARD_SEED_DIR';

/** Options for {@link buildBoardToTemp}. */
export interface BoardBuildOptions {
    /**
     * Test-only: directory copied in as a discovered module for this build (the R4 browser proof
     * adapter). Omitted for a production-shaped build.
     */
    readonly testAdapterDir?: string;
}

/**
 * Cross-process build mutex.
 *
 * `astro build` stages its prerender entry in the workspace-shared `.astro` cache, not in the
 * `--outDir` below, and `bun test` runs files in parallel processes — so two test files building
 * the board at once (`runtime-distribution` + `composed-board-browser`) raced: one cleared `.astro`
 * while the other imported its entry ("Cannot find module … prerender-entry.<hash>.mjs"). The
 * test-adapter injection window below is workspace-wide too, so every build of this root holds the
 * lock.
 */
export const BUILD_LOCK = join(tmpdir(), 'spur-board-0988-build.lock');
const BUILD_LOCK_WAIT_MS = 600_000;

/**
 * Per-process staging name for the pid.
 *
 * The pid is written here first and then hard-linked onto {@link BUILD_LOCK}, so the lock name
 * appears only once its content is on disk. Writing the lock directly (`flag: 'wx'`) publishes an
 * empty file for the microseconds between `open` and `write`, and a reader that parsed that empty
 * file as an abandoned lock deleted a live one — which let two builds share the workspace `.astro`
 * prerender cache and fail with `Cannot find module … prerender-entry.<hash>.mjs`.
 */
const BUILD_LOCK_STAGING = `${BUILD_LOCK}.${process.pid}`;

/** The file lock is not re-entrant; a process-local queue keeps a second caller from waiting on itself. */
let buildQueue: Promise<unknown> = Promise.resolve();

function lockOwnerAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

export async function acquireBuildLock(): Promise<void> {
    const deadline = Date.now() + BUILD_LOCK_WAIT_MS;
    for (;;) {
        try {
            writeFileSync(BUILD_LOCK_STAGING, String(process.pid));
            linkSync(BUILD_LOCK_STAGING, BUILD_LOCK);
            return;
        } catch {
            // Held by another process — check whether its owner is still alive.
        } finally {
            rmSync(BUILD_LOCK_STAGING, { force: true });
        }
        let owner: number;
        try {
            owner = Number.parseInt(readFileSync(BUILD_LOCK, 'utf8'), 10);
        } catch {
            continue; // released between the two attempts
        }
        if (Number.isInteger(owner) && lockOwnerAlive(owner)) {
            if (Date.now() >= deadline) {
                throw new Error(`board build lock ${BUILD_LOCK} held by pid ${owner} for over ${BUILD_LOCK_WAIT_MS}ms`);
            }
            await Bun.sleep(200);
            continue;
        }
        rmSync(BUILD_LOCK, { force: true }); // abandoned: unparsable pid, or a dead owner
    }
}

/**
 * Build the board into a fresh temporary distribution root and return that directory.
 *
 * With {@link BOARD_SEED_ENV} set and no `testAdapterDir`, the build is done once per launcher run
 * into the run-scoped seed and every caller gets a copy of it (task 1462 R2). Callers keep owning
 * cleanup (see {@link removeBoardBuild}), and a copy is what they get because callers such as
 * `board-base-path` write into their build dir.
 */
export async function buildBoardToTemp(options: BoardBuildOptions = {}): Promise<string> {
    // An adapter build injects a test-only module, so its output can never serve as the shared seed.
    const seedDir = options.testAdapterDir === undefined ? getEnvVar(BOARD_SEED_ENV) : undefined;
    if (seedDir === undefined || seedDir === '') return withBoardBuildLock(() => buildBoardOnce(options));
    await withBoardBuildLock(() => ensureBoardSeed(seedDir));
    return copyBoardSeed(seedDir);
}

/**
 * Publishes the run-scoped seed if it is absent, holding the build lock.
 *
 * The build lands in `<seed>.staging-<pid>` and is renamed onto the seed path, so a caller never
 * observes a half-built seed; a failed build removes the staging dir and leaves no seed, which lets
 * the next caller retry (task 1462 R4).
 *
 * @param seedDir - Absolute seed directory (absent until the first caller builds).
 * @param build - Build step writing a complete distribution into the given directory.
 */
export async function ensureBoardSeed(
    seedDir: string,
    build: (dir: string) => Promise<void> = (dir) => buildImpl(dir, {}),
): Promise<void> {
    if (existsSync(seedDir)) return;
    const staging = `${seedDir}.staging-${process.pid}`;
    rmSync(staging, { recursive: true, force: true });
    try {
        // Own the staging dir: the build writes into it, and `astro build` tolerates an empty outDir.
        mkdirSync(staging, { recursive: true });
        await build(staging);
        renameSync(staging, seedDir);
    } catch (error) {
        rmSync(staging, { recursive: true, force: true });
        throw error;
    }
}

/**
 * Copies the seed into a fresh temp root for one caller.
 *
 * Runs outside the build lock: the seed is immutable once published, and holding the lock for a
 * copy would serialize callers for no reason.
 *
 * @param seedDir - The published seed directory.
 * @returns A caller-owned copy.
 */
export async function copyBoardSeed(seedDir: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'spur-board-0988-'));
    try {
        await cp(seedDir, dir, { recursive: true });
        return dir;
    } catch (error) {
        await rm(dir, { recursive: true, force: true });
        throw error;
    }
}

/**
 * Run `work` holding the board build lock: queued behind this process's other builds (the lock is
 * not re-entrant), then exclusive across processes. EVERY `astro build` of this root goes through
 * here — including `packCliTarball`'s `dist/web` build — or it races the shared `.astro` cache.
 */
export function withBoardBuildLock<T>(work: () => Promise<T> | T): Promise<T> {
    const queued = buildQueue.then(async () => {
        await acquireBuildLock();
        try {
            return await work();
        } finally {
            releaseBuildLock();
        }
    });
    buildQueue = queued.catch(() => undefined);
    return queued;
}

/** Release {@link acquireBuildLock}. Exported with it for the cross-process exclusion test. */
export function releaseBuildLock(): void {
    rmSync(BUILD_LOCK, { force: true });
}

async function buildBoardOnce(options: BoardBuildOptions): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'spur-board-0988-'));
    try {
        await buildImpl(dir, options);
        return dir;
    } catch (error) {
        rmSync(dir, { recursive: true, force: true });
        throw error;
    }
}

/** One `astro build` into `dir`, with the test-adapter injection window around it. */
async function astroBuildInto(dir: string, options: BoardBuildOptions): Promise<void> {
    try {
        if (options.testAdapterDir) {
            // Keep injection, the blocking build and removal in one synchronous turn.
            // An awaited copy lets other tests discover the proof adapter in their
            // production registry before this build has removed it.
            rmSync(TEST_ADAPTER_MODULE_DIR, { recursive: true, force: true });
            cpSync(options.testAdapterDir, TEST_ADAPTER_MODULE_DIR, { recursive: true });
        }
        const proc = Bun.spawnSync(['bun', ASTRO_BIN, 'build', '--outDir', dir], {
            cwd: WEB_ROOT,
            stdout: 'pipe',
            stderr: 'pipe',
        });
        if (proc.exitCode !== 0) {
            throw new Error(
                `board build failed (exit ${proc.exitCode}):\n${proc.stdout.toString()}\n${proc.stderr.toString()}`,
            );
        }
    } finally {
        rmSync(TEST_ADAPTER_MODULE_DIR, { recursive: true, force: true });
    }
}

/**
 * Test-only build seam (task 1462 R2-R4).
 *
 * The seed rules are decisions about *when* a build happens, so the failure modes have to be
 * exercised without paying for a real `astro build` each time.
 *
 * @param next - Replacement build step; omit to restore the real `astro build`.
 */
export function setBoardBuildForTest(next?: (dir: string, options: BoardBuildOptions) => Promise<void>): void {
    buildImpl = next ?? astroBuildInto;
}

let buildImpl: (dir: string, options: BoardBuildOptions) => Promise<void> = astroBuildInto;

/** Delete a temporary distribution root. */
export async function removeBoardBuild(dir: string | undefined): Promise<void> {
    if (dir) await rm(dir, { recursive: true, force: true });
}
