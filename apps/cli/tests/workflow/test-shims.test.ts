import { describe, expect, test } from 'bun:test';
import { realpathSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Task 0818 R1 — the scripts/test-shims/spur launcher is the executable half of
// tests/setup.ts's PATH prepend. These are real child-process regressions: bare
// `spur` resolved through a crafted PATH, not a function call into resolveSpurBin.

const CHECKOUT_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const SHIM = join(CHECKOUT_ROOT, 'scripts', 'test-shims', 'spur');
const SOURCE_ENTRY = join(CHECKOUT_ROOT, 'apps', 'cli', 'src', 'index.ts');

// A fake "global" spur placed LATER on PATH than the shim dir (mirroring
// tests/setup.ts's prepend): if any resolution ever reaches it, it shouts.
const SENTINEL_BODY = '#!/bin/sh\necho "SENTINEL-GLOBAL-SPUR:$@"\nexit 42\n';

async function makeSentinelDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'spur-sentinel-'));
    const sentinel = join(dir, 'spur');
    await writeFile(sentinel, SENTINEL_BODY);
    await chmod(sentinel, 0o755);
    return dir;
}

// The launcher execs `bun`, so the child PATH must still resolve the runtime.
const BUN_DIR = join(process.execPath, '..');

function childPath(shimDir: string, sentinelDir: string): string {
    return [shimDir, sentinelDir, BUN_DIR, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
}

function runBareSpur(args: string[], cwd: string, path: string) {
    return Bun.spawnSync(['spur', ...args], {
        cwd,
        env: { PATH: path, HOME: tmpdir(), TMPDIR: tmpdir() },
    });
}

describe('scripts/test-shims/spur (task 0818 R1)', () => {
    test('launcher and source entry are on disk; launcher is tracked executable (no bundle needed)', async () => {
        await expect(Bun.file(SHIM).exists()).resolves.toBe(true);
        await expect(Bun.file(SOURCE_ENTRY).exists()).resolves.toBe(true);
        const tracked = Bun.spawnSync(['git', 'ls-files', '-s', 'scripts/test-shims/spur'], {
            cwd: CHECKOUT_ROOT,
        });
        expect(tracked.exitCode).toBe(0);
        // Index mode must carry the executable bit (100755), not 100644.
        expect(tracked.stdout.toString().trim()).toMatch(/^100755 /);
    });

    test('bare spur under the preload-style PATH runs the checkout source entry, never the sentinel', async () => {
        const sentinelDir = await makeSentinelDir();
        const foreignCwd = await mkdtemp(join(tmpdir(), 'spur-shims-cwd-'));
        const proc = runBareSpur(
            ['--help'],
            foreignCwd,
            childPath(join(CHECKOUT_ROOT, 'scripts', 'test-shims'), sentinelDir),
        );
        expect(proc.exitCode).toBe(0); // sentinel exits 42 — a 42 here means it ran
        const stdout = proc.stdout.toString();
        expect(stdout).not.toContain('SENTINEL-GLOBAL-SPUR');
        expect(stdout).toContain('Usage: spur [options] [command]');
    });

    test('fixture checkout whose path contains spaces: entry resolved relative to the launcher; cwd, spaced args and exit status survive', async () => {
        const sentinelDir = await makeSentinelDir();
        // Deliberate spaces at every level of the fake checkout path.
        const fakeCheckout = join(await mkdtemp(join(tmpdir(), 'spur shims base-')), 'spur check out');
        const shimDir = join(fakeCheckout, 'scripts', 'test-shims');
        await mkdir(shimDir, { recursive: true });
        await mkdir(join(fakeCheckout, 'apps', 'cli', 'src'), { recursive: true });
        await copyFile(SHIM, join(shimDir, 'spur'));
        // Fake source entry: echoes cwd+argv as JSON; first arg selects the exit status.
        await writeFile(
            join(fakeCheckout, 'apps', 'cli', 'src', 'index.ts'),
            'console.log(JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2) }));\n' +
                'process.exit(Number(process.argv[2] ?? 0) || 0);\n',
        );

        const callerCwd = await mkdtemp(join(tmpdir(), 'spur-shims-caller-'));
        const args = ['7', 'spaced argument with spaces', '--flag=value with space'];
        const proc = runBareSpur(args, callerCwd, childPath(shimDir, sentinelDir));

        expect(proc.exitCode).toBe(7); // exec preserved the child's nonzero status
        expect(proc.stdout.toString()).not.toContain('SENTINEL-GLOBAL-SPUR');
        const echoed = JSON.parse(proc.stdout.toString()) as { cwd: string; argv: string[] };
        // macOS /var→/private/var: `pwd -P` in the launcher reports the physical cwd.
        expect(echoed.cwd).toBe(realpathSync(callerCwd)); // launcher never cd'd away from the caller
        expect(echoed.argv).toEqual(args); // spaced args passed through unsplit, unquoted
    });
});
