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

import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
