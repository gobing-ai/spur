/**
 * Fresh board builds for runtime-distribution tests (task 0988).
 *
 * The task's distribution evidence must come from a build made by the test, never from a
 * `dist/web` that happens to exist (the plan's step 0 precondition).
 */
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const BUILD_LOCK = join(tmpdir(), 'spur-board-0988-build.lock');
const BUILD_LOCK_WAIT_MS = 600_000;

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

async function acquireBuildLock(): Promise<void> {
    const deadline = Date.now() + BUILD_LOCK_WAIT_MS;
    for (;;) {
        try {
            writeFileSync(BUILD_LOCK, String(process.pid), { flag: 'wx' });
            return;
        } catch {
            // Held by another process — check whether its owner is still alive.
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
 * The caller owns cleanup (see {@link removeBoardBuild}).
 */
export async function buildBoardToTemp(options: BoardBuildOptions = {}): Promise<string> {
    const queued = buildQueue.then(() => buildBoardLocked(options));
    buildQueue = queued.catch(() => undefined);
    return queued;
}

async function buildBoardLocked(options: BoardBuildOptions): Promise<string> {
    await acquireBuildLock();
    try {
        return await buildBoardOnce(options);
    } finally {
        rmSync(BUILD_LOCK, { force: true });
    }
}

async function buildBoardOnce(options: BoardBuildOptions): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'spur-board-0988-'));
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
        return dir;
    } catch (error) {
        rmSync(dir, { recursive: true, force: true });
        throw error;
    } finally {
        rmSync(TEST_ADAPTER_MODULE_DIR, { recursive: true, force: true });
    }
}

/** Delete a temporary distribution root. */
export async function removeBoardBuild(dir: string | undefined): Promise<void> {
    if (dir) await rm(dir, { recursive: true, force: true });
}
