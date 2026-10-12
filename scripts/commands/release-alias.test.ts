/**
 * release-alias — root release script forwarding contract (task 1173 R4).
 *
 * `bump-ver` / `drop-tags` stay the stable root script names, but their implementation is the public
 * `spur builder` noun; the repo-local forwarder (`scripts/commands/release.ts`) and the `spur-dev`
 * dispatcher cases are gone. These tests pin the forwarding with a **fake command runner** — a `bun`
 * shim that records argv — so verification never bumps a version or deletes a tag.
 */

import { expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..');

function scripts(): Record<string, string> {
    const parsed = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
    };
    return parsed.scripts;
}

/**
 * Substitute the script's leading `bun` with a recording shim and append the operator args. The
 * shim is invoked **by absolute path**, so a broken shim can never fall through to the real `bun`
 * and run a release (the first draft of this test shadowed PATH and did exactly that).
 */
function forwardWithFakeRunner(script: string, operatorArgs: string[]): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'release-alias-'));
    try {
        const record = join(dir, 'argv.json');
        const shim = join(dir, 'bun');
        writeFileSync(shim, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(record)}\n`);
        chmodSync(shim, 0o755);
        writeFileSync(record, '');
        const [head, ...rest] = script.split(' ');
        expect(head).toBe('bun');
        const proc = Bun.spawnSync({
            cmd: ['sh', '-c', [shim, ...rest, ...operatorArgs].join(' ')],
            cwd: REPO_ROOT,
        });
        expect(proc.exitCode).toBe(0);
        const seen = readFileSync(record, 'utf8')
            .split('\n')
            .filter((line) => line !== '');
        rmSync(dir, { recursive: true, force: true });
        return seen;
    } catch (error) {
        rmSync(dir, { recursive: true, force: true });
        throw error;
    }
}

test('root bump-ver forwards argv to the source-local builder command (task 1173 R4)', () => {
    const value = scripts()['bump-ver'];
    expect(value).toBe('bun run apps/cli/src/index.ts builder bump-ver');
    expect(forwardWithFakeRunner(value ?? '', ['spur', '0.1.4', '--push'])).toEqual([
        'run',
        'apps/cli/src/index.ts',
        'builder',
        'bump-ver',
        'spur',
        '0.1.4',
        '--push',
    ]);
});

test('root drop-tags forwards argv to the source-local builder command (task 1173 R4)', () => {
    const value = scripts()['drop-tags'];
    expect(value).toBe('bun run apps/cli/src/index.ts builder drop-tags');
    expect(forwardWithFakeRunner(value ?? '', ['--all', '0.1.4', '--remote'])).toEqual([
        'run',
        'apps/cli/src/index.ts',
        'builder',
        'drop-tags',
        '--all',
        '0.1.4',
        '--remote',
    ]);
});

test('the retired release forwarder and its dispatcher cases are gone (task 1173 R4)', () => {
    expect(existsSync(join(REPO_ROOT, 'scripts', 'commands', 'release.ts'))).toBe(false);
    const dispatcher = readFileSync(join(REPO_ROOT, 'scripts', 'spur-dev.ts'), 'utf8');
    expect(dispatcher).not.toContain('commands/release');
    expect(dispatcher).not.toContain('bumpVer');
    expect(dispatcher).not.toContain('dropTags');
});

test('the builder command still owns the release implementation (task 1173 R4)', () => {
    const builder = readFileSync(join(REPO_ROOT, 'apps', 'cli', 'src', 'commands', 'builder.ts'), 'utf8');
    expect(builder).toContain("from '../release-ops'");
    // The alias must not have invented a second implementation path.
    expect(existsSync(join(REPO_ROOT, 'apps', 'cli', 'src', 'release-ops.ts'))).toBe(true);
});
