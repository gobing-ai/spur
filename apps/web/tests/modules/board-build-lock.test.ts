/**
 * Regression check for the cross-process board-build lock (task 0988).
 *
 * Two test files build the board, and `astro build` stages its prerender entry in the
 * workspace-shared `apps/web/.astro`, so a second concurrent holder deletes the first's entry
 * mid-import: `Cannot find module … prerender-entry.<hash>.mjs`.
 *
 * The lock is only exclusive if acquisition is atomic. The earlier `flag: 'wx'` write published
 * the lock file for the microseconds between `open` and `write`; a reader that parsed that empty
 * file as an abandoned lock deleted a live one and admitted a second builder. So the invariant
 * this test pins is the mechanism, not a timing window: a lock file that exists always carries a
 * pid.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEnvVars } from '@gobing-ai/spur-config';
import {
    BOARD_SEED_ENV,
    type BoardBuildOptions,
    buildBoardToTemp,
    removeBoardBuild,
    setBoardBuildForTest,
} from '../test-helpers/board-build';

const HELPER = fileURLToPath(new URL('../test-helpers/board-build.ts', import.meta.url));
const WORKERS = 4;
const ROUNDS = 200;

/** Workers contend for the lock; the reader samples it and counts files published without a pid. */
const CHILD = `
import { readFileSync, writeFileSync } from 'node:fs';
import { BUILD_LOCK, acquireBuildLock, releaseBuildLock } from ${JSON.stringify(HELPER)};
const [role, readsFile] = process.argv.slice(1);
if (role === 'reader') {
    const deadline = Date.now() + 1500;
    let reads = 0;
    let empty = 0;
    while (Date.now() < deadline) {
        let raw;
        try {
            raw = readFileSync(BUILD_LOCK, 'utf8');
        } catch {
            continue; // no lock held: absent is not the same as published-empty
        }
        reads += 1;
        if (!Number.isInteger(Number.parseInt(raw, 10))) empty += 1;
    }
    writeFileSync(readsFile, JSON.stringify({ reads, empty }));
} else {
    for (let i = 0; i < ${ROUNDS}; i++) {
        await acquireBuildLock();
        await Bun.sleep(1);
        releaseBuildLock();
    }
}
`;

test('a board build lock file never exists without a pid', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spur-board-lock-test-'));
    const readsFile = join(dir, 'reads.json');
    const spawnChild = (role: string) =>
        // Args, not environment variables: direct env access is off limits outside the config
        // gateway (env-var-hygiene).
        Bun.spawn(['bun', '-e', CHILD, role, readsFile], { stdout: 'ignore', stderr: 'ignore' });
    try {
        const reader = spawnChild('reader');
        const workers = Array.from({ length: WORKERS }, () => spawnChild('worker'));
        const exits = await Promise.all([reader, ...workers].map((child) => child.exited));
        expect(exits).toEqual([0, 0, 0, 0, 0]);
        const { reads, empty } = JSON.parse(await readFile(readsFile, 'utf8'));
        expect(reads).toBeGreaterThan(0);
        expect({ empty }).toEqual({ empty: 0 });
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}, 120_000);

/**
 * Every board build in the test helpers must hold the lock. `packCliTarball` once ran its
 * `dist/web` build bare, so `test:heavy` raced it against a locked `buildBoardToTemp` over the
 * shared `.astro` cache and lost the prerender entry.
 */
test('every board build in the test helpers runs under withBoardBuildLock', async () => {
    const read = (name: string) => readFile(fileURLToPath(new URL(`../test-helpers/${name}`, import.meta.url)), 'utf8');
    // The dist/web build sits directly inside a withBoardBuildLock callback.
    const fixture = await read('downstream-fixture.ts');
    const distBuild = fixture.indexOf("'@gobing-ai/spur-web', 'build'");
    expect(distBuild).toBeGreaterThan(-1);
    expect(fixture.slice(0, distBuild).lastIndexOf('withBoardBuildLock(')).toBeGreaterThan(distBuild - 200);
    // The temp-dir astro build lives in buildBoardOnce, whose only caller holds the lock.
    const builder = await read('board-build.ts');
    expect(builder.match(/buildBoardOnce\(/g)?.length).toBe(2); // definition + one call
    expect(builder).toContain('withBoardBuildLock(() => buildBoardOnce(options))');
});

test('withBoardBuildLock serializes holders and holds the lock file for the work', async () => {
    const { BUILD_LOCK, withBoardBuildLock } = await import(HELPER);
    let active = 0;
    let maxActive = 0;
    const holder = () =>
        withBoardBuildLock(async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            expect(Number.parseInt(await readFile(BUILD_LOCK, 'utf8'), 10)).toBe(process.pid);
            await Bun.sleep(20);
            active -= 1;
        });
    await Promise.all([holder(), holder(), holder()]);
    expect(maxActive).toBe(1);
});

/**
 * Run-scoped board seed (task 1462 R2-R4).
 *
 * Failure modes first — each one would either lose a caller's proof or pay the ~9 s build per
 * caller anyway:
 *   - the seed is rebuilt on every caller (no win) or only once per process (a second worker misses it)
 *   - a caller receives the seed path itself, so `board-base-path`'s writes corrupt it for everyone
 *   - a `testAdapterDir` build is seeded, leaking the test-only module into every later build
 *   - a failed build leaves a seed behind, so every later caller silently reuses a broken tree
 *   - with the variable unset, a direct `bun test` starts sharing builds it must not share
 */
describe('run-scoped board seed', () => {
    const env = getEnvVars();
    const seeds: string[] = [];
    const builds: string[] = [];

    afterEach(async () => {
        setBoardBuildForTest();
        delete env[BOARD_SEED_ENV];
        for (const dir of seeds.splice(0)) await rm(dir, { recursive: true, force: true });
    });

    const seedDir = async (): Promise<string> => {
        const root = await mkdtemp(join(tmpdir(), 'spur-board-seed-test-'));
        seeds.push(root);
        const dir = join(root, 'board-seed');
        env[BOARD_SEED_ENV] = dir;
        return dir;
    };

    const stubBuild = (fail = false): void => {
        setBoardBuildForTest(async (dir: string, _options: BoardBuildOptions) => {
            builds.push(dir);
            if (fail) throw new Error('board build failed (exit 1):\nstub\nstub');
            writeFileSync(join(dir, 'index.html'), 'seed', { flag: 'w' });
        });
    };

    test('builds once for the run and hands every caller a private copy', async () => {
        const dir = await seedDir();
        builds.length = 0;
        stubBuild();
        const first = await buildBoardToTemp();
        const second = await buildBoardToTemp();
        try {
            expect(builds).toEqual([`${dir}.staging-${process.pid}`]);
            expect(first).not.toBe(second);
            expect(existsSync(join(first, 'index.html'))).toBe(true);
            expect(existsSync(dir)).toBe(true);
            writeFileSync(join(first, 'index.html'), 'mutated');
            expect(await readFile(join(dir, 'index.html'), 'utf8')).toBe('seed');
        } finally {
            await removeBoardBuild(first);
            await removeBoardBuild(second);
        }
    });

    test('never seeds a test-adapter build', async () => {
        const dir = await seedDir();
        builds.length = 0;
        stubBuild();
        const adapter = await seedDir();
        const build = await buildBoardToTemp({ testAdapterDir: adapter });
        try {
            expect(builds).toHaveLength(1);
            expect(builds[0]).not.toContain('board-seed');
            expect(existsSync(dir)).toBe(false);
        } finally {
            await removeBoardBuild(build);
        }
    });

    test('leaves no seed after a failed build and rebuilds on the next caller', async () => {
        const dir = await seedDir();
        builds.length = 0;
        stubBuild(true);
        await expect(buildBoardToTemp()).rejects.toThrow(/board build failed/);
        expect(existsSync(dir)).toBe(false);
        expect(existsSync(`${dir}.staging-${process.pid}`)).toBe(false);

        stubBuild();
        const build = await buildBoardToTemp();
        try {
            expect(existsSync(dir)).toBe(true);
        } finally {
            await removeBoardBuild(build);
        }
    });

    test('builds per call when the launcher did not set the variable', async () => {
        builds.length = 0;
        stubBuild();
        const first = await buildBoardToTemp();
        const second = await buildBoardToTemp();
        try {
            expect(builds).toHaveLength(2);
            expect(first).not.toBe(second);
        } finally {
            await removeBoardBuild(first);
            await removeBoardBuild(second);
        }
    });
});
