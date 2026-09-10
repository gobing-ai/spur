/**
 * Task 0818 R1 — the source-local `spur` launcher that `tests/setup.ts` puts on PATH.
 *
 * The launcher was referenced by the preload but absent from disk and from tracked files, so the
 * documented protection against a stale global `spur` was inert. These are real child-process
 * checks at the launcher boundary: a sentinel `spur` sits LATER on PATH, the child runs from a cwd
 * outside the checkout, and the launcher is exercised from a copy whose path contains a space.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const SHIM_DIR = join(REPO_ROOT, 'scripts', 'test-shims');
const SHIM = join(SHIM_DIR, 'spur');

interface RunResult {
    stdout: string;
    stderr: string;
    code: number;
}

/** Spawn bare `spur` (no shell) so PATH resolution itself is what is under test. */
function runBareSpur(args: string[], options: { cwd: string; path: string }): Promise<RunResult> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn('spur', args, {
            cwd: options.cwd,
            env: { ...process.env, PATH: options.path },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += String(chunk);
        });
        child.stderr.on('data', (chunk) => {
            stderr += String(chunk);
        });
        child.on('error', rejectPromise);
        child.on('close', (code) => resolvePromise({ stdout, stderr, code: code ?? -1 }));
    });
}

let sentinelDir: string;
let sentinelMarker: string;
/** PATH with the real shim first and a sentinel `spur` later — the shadowing case 0817 hit. */
let pathWithSentinel: string;

beforeAll(async () => {
    sentinelDir = await mkdtemp(join(tmpdir(), 'spur-0818-sentinel-'));
    sentinelMarker = join(sentinelDir, 'sentinel-was-run');
    const sentinel = join(sentinelDir, 'spur');
    // A stand-in for a stale global install: if it ever runs it leaves a file behind.
    writeFileSync(sentinel, `#!/bin/sh\necho GLOBAL-SENTINEL > "${sentinelMarker}"\nexit 0\n`);
    chmodSync(sentinel, 0o755);
    pathWithSentinel = `${SHIM_DIR}:${sentinelDir}:${process.env.PATH ?? ''}`;
});

afterAll(async () => {
    await rm(sentinelDir, { recursive: true, force: true });
});

describe('0818 R1 — source-local spur launcher', () => {
    test('is tracked executable and runs the checkout source entry without a bundle', () => {
        const source = readFileSync(SHIM, 'utf8');
        // Anchored on the source entry, never a built bundle or a global binary.
        expect(source).toContain('apps/cli/src/index.ts');
        expect(source).not.toContain('dist/');
        // Mode is asserted through git so the committed bit — not just the working tree — is proven.
        const indexed = Bun.spawnSync(['git', 'ls-files', '-s', 'scripts/test-shims/spur'], { cwd: REPO_ROOT });
        expect(new TextDecoder().decode(indexed.stdout).trim()).toStartWith('100755 ');
    });

    test('bare spur from a cwd outside the checkout runs the local entry, not the sentinel', async () => {
        const foreignCwd = await mkdtemp(join(tmpdir(), 'spur-0818-cwd-'));
        try {
            const result = await runBareSpur(['--version'], { cwd: foreignCwd, path: pathWithSentinel });
            expect(result.code).toBe(0);
            // The local CLI prints a semver line; the sentinel would have printed its own marker.
            expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
            expect(result.stdout).not.toContain('GLOBAL-SENTINEL');
            expect(await Bun.file(sentinelMarker).exists()).toBe(false);
        } finally {
            await rm(foreignCwd, { recursive: true, force: true });
        }
    });

    test('caller cwd, a spaced argument and a nonzero exit status all survive the launcher', async () => {
        // A stub entry proves the launcher's own contract (self-relative resolution, quoting, cwd,
        // status) deterministically, without paying for a full checkout copy per assertion.
        // realpath: macOS resolves /tmp through a symlink, so a raw mkdtemp path would not
        // match the cwd the child reports even when cwd is preserved correctly.
        const spacedRoot = realpathSync(await mkdtemp(join(tmpdir(), 'spur-0818-spaced ')));
        try {
            const checkout = join(spacedRoot, 'my checkout');
            mkdirSync(join(checkout, 'apps', 'cli', 'src'), { recursive: true });
            mkdirSync(join(checkout, 'scripts', 'test-shims'), { recursive: true });
            cpSync(SHIM, join(checkout, 'scripts', 'test-shims', 'spur'));
            chmodSync(join(checkout, 'scripts', 'test-shims', 'spur'), 0o755);
            writeFileSync(
                join(checkout, 'apps', 'cli', 'src', 'index.ts'),
                [
                    `console.log(\`CWD=\${process.cwd()}\`);`,
                    `console.log(\`ARGS=\${JSON.stringify(process.argv.slice(2))}\`);`,
                    'process.exit(7);',
                ].join('\n'),
            );

            const callerCwd = join(spacedRoot, 'caller dir');
            mkdirSync(callerCwd, { recursive: true });
            const result = await runBareSpur(['task', 'show', 'a b c'], {
                cwd: callerCwd,
                // Spaced checkout first, sentinel later: the spaced path must still win.
                path: `${join(checkout, 'scripts', 'test-shims')}:${sentinelDir}:${process.env.PATH ?? ''}`,
            });

            expect(result.code).toBe(7); // underlying exit status propagated, not collapsed to 0/1
            expect(result.stdout).toContain(`CWD=${callerCwd}`); // caller cwd preserved
            expect(result.stdout).toContain('ARGS=["task","show","a b c"]'); // spaced arg stayed one argv entry
            expect(await Bun.file(sentinelMarker).exists()).toBe(false);
        } finally {
            await rm(spacedRoot, { recursive: true, force: true });
        }
    });

    test('the preload prepends a directory that actually exists for a spaced checkout path', () => {
        const setup = readFileSync(join(REPO_ROOT, 'tests', 'setup.ts'), 'utf8');
        // `URL.pathname` percent-encodes a space, prepending a directory that cannot exist.
        expect(setup).toContain("fileURLToPath(new URL('../scripts/test-shims'");
        expect(setup).not.toContain("new URL('../scripts/test-shims', import.meta.url).pathname");
    });

    test('the launcher inherits config-skip precedence instead of setting it', () => {
        const source = readFileSync(SHIM, 'utf8');
        // Env is passed through untouched; the preload stays the only writer of these.
        expect(source).not.toMatch(/^\s*(export\s+)?SPUR_SKIP_(PROJECT|GLOBAL)_CONFIG=/m);
    });
});
