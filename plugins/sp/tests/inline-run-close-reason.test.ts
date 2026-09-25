import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Test-side parity anchor: the plugin standalone contract forbids a VALUE import in
// plugins/sp shipped code, so the comparison imports the app source directly here.
import { TERMINAL_REASONS } from '../../../packages/app/src/workflow/terminal-reason';

/**
 * Task 0937 R2 — the inline driver's `--close` reason contract. The script holds a COPIED
 * literal of the closed terminal-reason enum (the plugin standalone contract forbids a
 * value import of app code), so this test is the drift alarm: the copy must equal
 * `TERMINAL_REASONS` from @gobing-ai/spur-app, and `--close` must refuse a failed close
 * without a declared reason (or with a non-enum one) BEFORE any write.
 */

const SCRIPT = join(import.meta.dir, '..', 'scripts', 'inline-run-setup.ts');

test('the script copies TERMINAL_REASONS exactly (no value import, parity held)', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    const match = source.match(/const TERMINAL_REASONS = new Set\(\[([^\]]+)\]\)/);
    expect(match, 'copied TERMINAL_REASONS literal found in the script').not.toBeNull();
    const copied = (match?.[1] ?? '')
        .split(',')
        .map((entry) => entry.trim().replace(/^'|'$/g, ''))
        .filter((entry) => entry !== '');
    expect(copied).toEqual([...TERMINAL_REASONS]);
    // And the script stays standalone: the app package appears only as a type import.
    expect(source).toContain("import type { WorkflowActionTraceWriter } from '@gobing-ai/spur-app'");
    // And the script stays standalone: no runtime value import of the app package.
    expect(source).toMatch(/import type \{ WorkflowActionTraceWriter \} from '@gobing-ai\/spur-app'/);
});

test('R2: --close --status failed without --reason exits nonzero before any write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inline-run-close-reason-'));
    try {
        const proc = spawnSync('bun', [SCRIPT, '--close', '--run-id', '0937-reason-missing', '--status', 'failed'], {
            cwd: dir,
            stdio: 'pipe',
            encoding: 'utf8',
        });
        expect(proc.status, 'a failed close without a reason is a usage error').not.toBe(0);
        expect(proc.stderr).toContain('Usage');
        // The failure is pre-write: no run-row JSON ever reached stdout.
        expect(proc.stdout).not.toContain('"ok"');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('R2: an unknown --reason value exits nonzero before any write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inline-run-close-reason-bad-'));
    try {
        const proc = spawnSync(
            'bun',
            [SCRIPT, '--close', '--run-id', '0937-reason-bad', '--status', 'failed', '--reason', 'terminal:failed'],
            { cwd: dir, stdio: 'pipe', encoding: 'utf8' },
        );
        expect(proc.status, 'a non-enum reason is a usage error, never a silent mapping').not.toBe(0);
        expect(proc.stdout).not.toContain('"ok"');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
