import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Task 0868 (ADR-117) — the inline driver's structured trace emission.
 *
 * The driver reports each action boundary and closes its run row through the shared
 * `WorkflowActionTraceWriter` delegate (`inline-run-setup.ts --action` / `--close`).
 * R4: every executed action lands an `action_runs` row queryable by run id. R12: an
 * action-emission failure is recorded to the run log and the delegate still exits 0, so
 * the run reaches its declared terminal state. `--close` is bookkeeping, not emission:
 * a missing run row or a persistence failure exits 1 (findings #1/#4).
 */

const SCRIPT = join(import.meta.dir, '..', 'scripts', 'inline-run-setup.ts');

const WORKFLOW = `name: inline-smoke
initialState: start
terminalStates:
    - end
states:
    - id: start
      onEnter:
          - kind: shell
            options:
                command: echo smoke
    - id: end
transitions:
    - from: start
      to: end
      guard:
          kind: always
`;

/** Fixture project with a resolvable project-layer definition (mirrors the inline layout). */
function makeProject(): { workdir: string; cleanup: () => void } {
    const root = mkdtempSync(join(tmpdir(), 'spur-0868-trace-script-'));
    const workdir = join(root, 'wt');
    mkdirSync(join(workdir, '.spur', 'workflows'), { recursive: true });
    mkdirSync(join(workdir, '.spur', 'run'), { recursive: true });
    writeFileSync(join(workdir, '.spur', 'workflows', 'inline-smoke.yaml'), WORKFLOW);
    return { workdir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runScript(workdir: string, args: readonly string[]) {
    return spawnSync('bun', [SCRIPT, ...args], { cwd: workdir, stdio: 'pipe', encoding: 'utf8' });
}

interface ActionRow {
    run_id: string;
    node: string;
    kind: string;
    status: string;
    duration_ms: number;
    ok: number;
}

test('R4: setup → --action → --close lands an action_runs row queryable by run id and a terminal run row', () => {
    const p = makeProject();
    const runId = 'run-0868-trace-e2e';
    try {
        const setup = runScript(p.workdir, ['--run-id', runId, '--file', '.spur/workflows/inline-smoke.yaml']);
        expect(setup.status, setup.stderr).toBe(0);

        const action = runScript(p.workdir, [
            '--action',
            '--run-id',
            runId,
            '--node',
            'implement',
            '--kind',
            'agent.run',
            '--status',
            'done',
            '--ok',
            'true',
            '--duration-ms',
            '1234',
        ]);
        expect(action.status, action.stderr).toBe(0);
        expect(JSON.parse(action.stdout)).toMatchObject({ ok: true, runId });

        const close = runScript(p.workdir, ['--close', '--run-id', runId, '--status', 'done']);
        expect(close.status, close.stderr).toBe(0);
        expect(JSON.parse(close.stdout)).toMatchObject({ ok: true, runId });

        // Queryable by run id through the DB — no run-record file read at all (R2).
        const db = new Database(join(p.workdir, '.spur', 'spur.db'), { readonly: true });
        try {
            const rows = db
                .query<ActionRow, [string]>(
                    'SELECT run_id, node, kind, status, duration_ms, ok FROM action_runs WHERE run_id = ?',
                )
                .all(runId);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                run_id: runId,
                node: 'implement',
                kind: 'agent.run',
                status: 'done',
                duration_ms: 1234,
                ok: 1,
            });
            const run = db
                .query<{ status: string; completed_at: string | null }, [string]>(
                    'SELECT status, completed_at FROM runs WHERE id = ?',
                )
                .get(runId);
            expect(run?.status).toBe('done');
            expect(run?.completed_at).not.toBeNull();
        } finally {
            db.close();
        }
    } finally {
        p.cleanup();
    }
}, 60_000);

test('R12: an unresolvable writer fails the emission open — recorded to the run log, exit 0, run unaffected', () => {
    const p = makeProject();
    const runId = 'run-0868-trace-fail';
    try {
        // A spur-bin that resolves to no repo checkout: the shared writer is unreachable.
        const proc = runScript(p.workdir, [
            '--action',
            '--run-id',
            runId,
            '--node',
            'implement',
            '--kind',
            'agent.run',
            '--status',
            'done',
            '--ok',
            'true',
            '--duration-ms',
            '10',
            '--spur-bin',
            'bun /nonexistent/apps/cli/src/index.ts',
        ]);

        // Never wedges the run: exit 0 with a structured failure on stdout.
        expect(proc.status, proc.stderr).toBe(0);
        expect(JSON.parse(proc.stdout)).toMatchObject({ ok: false, runId });

        // And the failure is recorded where the driver can see it — the run-record
        // markdown (task 0927 R1; a fresh run has no legacy `.log` to fall back to).
        const logPath = join(p.workdir, '.spur', 'run', `${runId}.md`);
        expect(existsSync(logPath)).toBe(true);
        const log = readFileSync(logPath, 'utf8');
        expect(log).toContain('trace-emission-failed');
        expect(log).toContain(`run=${runId}`);
        expect(log).toContain('node=implement');
        expect(existsSync(join(p.workdir, '.spur', 'run', `${runId}.log`))).toBe(false);
    } finally {
        p.cleanup();
    }
}, 60_000);

test('--ok false is a valid value (ok=0), only miscased/omitted values are usage errors', () => {
    const p = makeProject();
    const runId = 'run-0868-ok-false';
    try {
        const setup = runScript(p.workdir, ['--run-id', runId, '--file', '.spur/workflows/inline-smoke.yaml']);
        expect(setup.status, setup.stderr).toBe(0);

        const action = runScript(p.workdir, [
            '--action',
            '--run-id',
            runId,
            '--node',
            'start',
            '--kind',
            'shell',
            '--status',
            'failed',
            '--ok',
            'false',
            '--duration-ms',
            '7',
        ]);
        expect(action.status, action.stderr).toBe(0);
        expect(JSON.parse(action.stdout)).toMatchObject({ ok: true, runId });

        const db = new Database(join(p.workdir, '.spur', 'spur.db'), { readonly: true });
        try {
            const row = db.query<{ ok: number }, [string]>('SELECT ok FROM action_runs WHERE run_id = ?').get(runId);
            expect(row?.ok).toBe(0);
        } finally {
            db.close();
        }
    } finally {
        p.cleanup();
    }
}, 60_000);

test('--ok and --duration-ms are required and exact: omitted or malformed values are usage errors (exit 2)', () => {
    const p = makeProject();
    try {
        for (const args of [
            // --ok omitted
            [
                '--action',
                '--run-id',
                'r1',
                '--node',
                'start',
                '--kind',
                'shell',
                '--status',
                'done',
                '--duration-ms',
                '5',
            ],
            // --ok miscased
            [
                '--action',
                '--run-id',
                'r1',
                '--node',
                'start',
                '--kind',
                'shell',
                '--status',
                'done',
                '--ok',
                'True',
                '--duration-ms',
                '5',
            ],
            // --duration-ms omitted
            ['--action', '--run-id', 'r1', '--node', 'start', '--kind', 'shell', '--status', 'done', '--ok', 'true'],
            // --duration-ms malformed
            [
                '--action',
                '--run-id',
                'r1',
                '--node',
                'start',
                '--kind',
                'shell',
                '--status',
                'done',
                '--ok',
                'true',
                '--duration-ms',
                'nope',
            ],
            // --duration-ms negative
            [
                '--action',
                '--run-id',
                'r1',
                '--node',
                'start',
                '--kind',
                'shell',
                '--status',
                'done',
                '--ok',
                'true',
                '--duration-ms',
                '-1',
            ],
        ]) {
            const proc = runScript(p.workdir, args);
            expect(proc.status, `expected usage exit 2 for ${args.join(' ')}`).toBe(2);
        }
    } finally {
        p.cleanup();
    }
});

test('--close for a run id with no row fails loudly with a named error, never {"ok":true} (finding #4)', () => {
    const p = makeProject();
    const runId = 'run-0868-does-not-exist';
    try {
        const proc = runScript(p.workdir, ['--close', '--run-id', runId, '--status', 'done']);
        expect(proc.status, proc.stderr).toBe(1);
        const out = JSON.parse(proc.stdout);
        expect(out.ok).toBe(false);
        expect(out.runId).toBe(runId);
        expect(out.code).toBe('RUN_NOT_FOUND');
        expect(out.error).toContain(runId);
    } finally {
        p.cleanup();
    }
}, 60_000);

test('a malformed invocation is a usage error (exit 2), never a silent emission', () => {
    const p = makeProject();
    try {
        // Missing --kind / --node / --status on the action mode.
        for (const args of [
            [
                '--action',
                '--run-id',
                'r1',
                '--node',
                'implement',
                '--status',
                'done',
                '--ok',
                'true',
                '--duration-ms',
                '1',
            ],
            ['--action', '--run-id', 'r1', '--node', 'implement', '--kind', 'agent.run', '--duration-ms', '1'],
            ['--close', '--run-id', 'r1', '--status', 'sideways'],
            [
                '--action',
                '--run-id',
                '../escape',
                '--node',
                'n',
                '--kind',
                'k',
                '--status',
                'done',
                '--duration-ms',
                '1',
            ],
        ]) {
            const proc = runScript(p.workdir, args);
            expect(proc.status, `expected usage/guard exit for ${args.join(' ')}`).toBeGreaterThanOrEqual(1);
        }
    } finally {
        p.cleanup();
    }
});
