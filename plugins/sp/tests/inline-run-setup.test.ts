import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Task 0804 R7/P2 (SECUA): the inline run setup delegate writes
 * `.spur/run/<run-id>-inline-setup.json`, so `--run-id` must be validated as a single safe
 * filename component BEFORE any outcome write — the same refusal class the task-pipeline
 * route-reason shell action applies to `$__runId` (task 0804 R8): path separators, dot
 * traversal and unresolved interpolation exit nonzero without an artifact.
 */

const SCRIPT = join(import.meta.dir, '..', 'scripts', 'inline-run-setup.ts');

test('an unsafe run id refuses with exit 1 and writes no outcome artifact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inline-run-setup-guard-'));
    try {
        for (const unsafeId of ['../evil', 'a/b', '$(id)', 'run..../../escape', '..']) {
            const proc = spawnSync('bun', [SCRIPT, '--run-id', unsafeId, '--file', 'whatever'], {
                cwd: dir,
                stdio: 'pipe',
                encoding: 'utf8',
            });
            expect(proc.status, `expected refusal for ${unsafeId}`).toBe(1);
            expect(proc.stderr, `expected actionable refusal for ${unsafeId}`).toContain('refusing unsafe run id');

            // The guard fires before any file work: no `.spur` tree (and therefore no
            // `.spur/run/<id>-inline-setup.json`, at the traversal target either).
            expect(existsSync(join(dir, '.spur')), `no artifact for ${unsafeId}`).toBe(false);
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a valid run id passes the guard and reaches the normal fail-closed path (no false refusal)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inline-run-setup-guard-valid-'));
    try {
        const runId = '0804-run-setup-guard-valid';
        const proc = spawnSync('bun', [SCRIPT, '--run-id', runId, '--file', 'no-such-workflow'], {
            cwd: dir,
            stdio: 'pipe',
            encoding: 'utf8',
        });
        // The definition cannot resolve, so the run still fails closed — but through the
        // resolver, not the run-id guard.
        expect(proc.status).toBe(1);
        expect(proc.stderr).not.toContain('refusing unsafe run id');
        expect(proc.stderr).toContain('could not resolve the workflow definition');
        const outcome = JSON.parse(readFileSync(join(dir, '.spur', 'run', `${runId}-inline-setup.json`), 'utf8')) as {
            ok: boolean;
            error?: string;
        };
        expect(outcome.ok).toBe(false);
        expect(outcome.error).toContain('could not resolve the workflow definition');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}, 30_000);
