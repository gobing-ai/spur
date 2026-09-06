import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { RunArtifactPathError, resolveRunArtifactPath } from '../../../src/workflow/actions/run-path';

// Task 0785 R2: artifact paths are confined to the PHYSICAL .spur/run tree, not just lexically.
// These tests exercise the real filesystem through NodeFileSystem so canonicalization, symlink
// rejection, and dangling-link behavior are observed as the production path sees them.

describe('resolveRunArtifactPath (task 0785 R2)', () => {
    let workdir: string;
    // macOS tmpdirs sit behind /var -> /private/var, so expectations use the canonical root
    // (the same canonicalization the resolver itself applies).
    let canonical: string;

    beforeAll(() => {
        workdir = mkdtempSync(join(tmpdir(), 'run-path-'));
        mkdirSync(join(workdir, '.spur', 'run'), { recursive: true });
        writeFileSync(join(workdir, '.spur', 'run', 'existing.txt'), 'x');
        canonical = realpathSync(workdir);
    });

    afterAll(() => {
        rmSync(workdir, { recursive: true, force: true });
    });

    test('a plain path inside .spur/run resolves to a file under the canonical run root', async () => {
        const resolved = await resolveRunArtifactPath(createNodeFileSystem(workdir), workdir, '.spur/run/existing.txt');
        expect(resolved).toBe(join(canonical, '.spur', 'run', 'existing.txt'));
    });

    test('missing leaf segments are reconstructed when the parent exists', async () => {
        const resolved = await resolveRunArtifactPath(
            createNodeFileSystem(workdir),
            workdir,
            '.spur/run/new-dir/nested/status.json',
        );
        expect(resolved).toBe(join(canonical, '.spur', 'run', 'new-dir', 'nested', 'status.json'));
    });

    test('traversal and absolute paths fail the 0781 lexical gate verbatim', async () => {
        const fs = createNodeFileSystem(workdir);
        for (const bad of ['outside.txt', '../outside.txt', '/etc/passwd', '.spur', '.spur/runx/file']) {
            expect(async () => await resolveRunArtifactPath(fs, workdir, bad)).toThrow(RunArtifactPathError);
        }
    });

    test('the run directory itself is not a valid artifact path (strict descent)', async () => {
        const fs = createNodeFileSystem(workdir);
        expect(async () => await resolveRunArtifactPath(fs, workdir, '.spur/run')).toThrow(RunArtifactPathError);
    });

    test('a symlink escaping .spur/run is rejected before any effect', async () => {
        const outside = mkdtempSync(join(tmpdir(), 'run-path-out-'));
        try {
            symlinkSync(outside, join(workdir, '.spur', 'run', 'escape'));
            const fs = createNodeFileSystem(workdir);
            expect(async () => await resolveRunArtifactPath(fs, workdir, '.spur/run/escape/status.json')).toThrow(
                /escapes the project workdir through a symlink/,
            );
        } finally {
            rmSync(outside, { recursive: true, force: true });
        }
    });

    test('a symlink resolving inside .spur/run is accepted and canonicalized', async () => {
        symlinkSync('existing.txt', join(workdir, '.spur', 'run', 'alias'));
        const resolved = await resolveRunArtifactPath(createNodeFileSystem(workdir), workdir, '.spur/run/alias');
        expect(resolved).toBe(join(canonical, '.spur', 'run', 'existing.txt'));
        rmSync(join(workdir, '.spur', 'run', 'alias'));
    });

    test('a dangling symlink listed by its parent is rejected, not treated as missing', async () => {
        symlinkSync(join(workdir, '.spur', 'run', 'nowhere-target'), join(workdir, '.spur', 'run', 'dangling'));
        expect(readlinkSync(join(workdir, '.spur', 'run', 'dangling'))).toBeTruthy();
        const fs = createNodeFileSystem(workdir);
        expect(async () => await resolveRunArtifactPath(fs, workdir, '.spur/run/dangling')).toThrow(/dangling symlink/);
        rmSync(join(workdir, '.spur', 'run', 'dangling'));
    });

    test('a FileSystem without realPath fails closed (no lexical fallback)', async () => {
        const fs = createNodeFileSystem(workdir);
        const stripped = Object.create(Object.getPrototypeOf(fs), {
            realPath: { value: undefined },
        }) as typeof fs;
        expect(async () => await resolveRunArtifactPath(stripped, workdir, '.spur/run/existing.txt')).toThrow(
            /realPath support/,
        );
    });
});
