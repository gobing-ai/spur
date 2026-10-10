import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Test-side parity anchor: the plugin standalone contract forbids a VALUE import in
// plugins/sp shipped code, so the comparison imports the app source directly here.
import { TERMINAL_REASONS } from '../../../packages/app/src/workflow/terminal-reason';

/**
 * Task 0937 R2 — the inline driver's `--close` reason contract. Task 1136 moved the close-mode
 * guard (and its terminal-reason vocabulary) into the app service's trace-mode dispatcher, so
 * the script no longer holds a copied literal; this test now pins that the vocabulary has ONE
 * owner (`packages/app/src/workflow/terminal-reason.ts`) and that no plugins/sp source copies it
 * back, while `--close` still refuses a failed close without a declared reason (or with a
 * non-enum one) BEFORE any write.
 */

const SCRIPT = join(import.meta.dir, '..', 'scripts', 'inline-run-setup.ts');

test('no plugins/sp source re-copies the terminal-reason enum (single owner, parity held)', () => {
    const scriptSource = readFileSync(SCRIPT, 'utf8');
    expect(scriptSource).not.toContain('const TERMINAL_REASONS = new Set([');
    // And the script stays standalone: the app package appears only as a type-only namespace
    // import; no runtime value import exists.
    expect(scriptSource).toContain("import type * as spurApp from '@gobing-ai/spur-app'");
    expect(scriptSource).not.toMatch(/(^|\n)import (?!type )[^;\n]*'@gobing-ai\/spur-app'/);
    // The one owner still declares the full closed enum.
    expect([...TERMINAL_REASONS]).toEqual([
        'done',
        'paused-operator',
        'failed-check',
        'failed-agent',
        'failed-timeout',
        'failed-guard',
        'cancelled',
        'interrupted',
        'retry-exhausted',
    ]);
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

// Task 1051 AC1 — the defaults must hold end-to-end through the source script: a done or
// paused close WITHOUT a declared reason stores `done` / `paused-operator` respectively.
const DEFAULTS_WORKFLOW = `name: inline-smoke
initialState: start
terminalStates:
    - end
states:
    - id: start
    - id: end
transitions:
    - from: start
      to: end
      guard:
          kind: always
`;

function makeDefaultsProject(): { workdir: string; cleanup: () => void } {
    const root = mkdtempSync(join(tmpdir(), 'spur-1051-close-defaults-'));
    const workdir = join(root, 'wt');
    mkdirSync(join(workdir, '.spur', 'workflows'), { recursive: true });
    writeFileSync(join(workdir, '.spur', 'workflows', 'inline-smoke.yaml'), DEFAULTS_WORKFLOW);
    return { workdir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function terminalReason(db: Database, runId: string): { status: string; terminal_reason: string | null } {
    return db
        .query<{ status: string; terminal_reason: string | null }, [string]>(
            'SELECT status, terminal_reason FROM runs WHERE id = ?',
        )
        .get(runId) as { status: string; terminal_reason: string | null };
}

// Per-test headroom only (E93 1029 fix hop 2): five sequential spawnSync bun cold starts
// (~1s each) straddle bun's 5s default — gate runs failed at 7187ms and 5079ms; load flake,
// not a regression. Assertions unchanged.
test('1051 AC1: done and paused closes without --reason store done and paused-operator', () => {
    const p = makeDefaultsProject();
    try {
        const setup = spawnSync(
            'bun',
            [SCRIPT, '--run-id', 'run-1051-defaults', '--file', '.spur/workflows/inline-smoke.yaml'],
            {
                cwd: p.workdir,
                stdio: 'pipe',
                encoding: 'utf8',
            },
        );
        expect(setup.status, setup.stderr).toBe(0);

        // A done close needs one action row (0975 R2 reports zero-action closes).
        const action = spawnSync(
            'bun',
            [
                SCRIPT,
                '--action',
                '--run-id',
                'run-1051-defaults',
                '--node',
                'start',
                '--kind',
                'agent.run',
                '--status',
                'done',
                '--ok',
                'true',
                '--duration-ms',
                '10',
            ],
            { cwd: p.workdir, stdio: 'pipe', encoding: 'utf8' },
        );
        expect(action.status, action.stderr).toBe(0);

        const done = spawnSync('bun', [SCRIPT, '--close', '--run-id', 'run-1051-defaults', '--status', 'done'], {
            cwd: p.workdir,
            stdio: 'pipe',
            encoding: 'utf8',
        });
        expect(done.status, done.stderr).toBe(0);

        const paused = spawnSync(
            'bun',
            [SCRIPT, '--run-id', 'run-1051-paused', '--file', '.spur/workflows/inline-smoke.yaml'],
            { cwd: p.workdir, stdio: 'pipe', encoding: 'utf8' },
        );
        expect(paused.status, paused.stderr).toBe(0);
        const pausedClose = spawnSync('bun', [SCRIPT, '--close', '--run-id', 'run-1051-paused', '--status', 'paused'], {
            cwd: p.workdir,
            stdio: 'pipe',
            encoding: 'utf8',
        });
        expect(pausedClose.status, pausedClose.stderr).toBe(0);

        const db = new Database(join(p.workdir, '.spur', 'spur.db'), { readonly: true });
        try {
            expect(terminalReason(db, 'run-1051-defaults')).toEqual({ status: 'done', terminal_reason: 'done' });
            expect(terminalReason(db, 'run-1051-paused')).toEqual({
                status: 'paused',
                terminal_reason: 'paused-operator',
            });
        } finally {
            db.close();
        }
    } finally {
        p.cleanup();
    }
}, 20000);
