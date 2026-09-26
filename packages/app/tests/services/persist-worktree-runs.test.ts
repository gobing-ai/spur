import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InvalidWorkflowRunIdError, openInlineRunProjectDb, persistWorktreeRuns } from '../../src';

/**
 * Task 0975 R1 — the app persist-out operation: DB row transfer plus two-file run-record
 * copy from a worktree into an invoking tree, before the worktree is removed. Idempotent
 * on re-persist; fail-closed on an unreadable source DB; never overwrites a divergent
 * invoking-tree record.
 */

const RUN_INSERT = `INSERT INTO runs (id, workflow_name, mode, status, agent, external_key, started_at, completed_at,
                                      metadata_json, created_at, updated_at)
                    VALUES (?, 'wf', 'state-machine', 'done', NULL, NULL, '2026-09-26T00:00:00Z', NULL, '{}', 1, 1)`;

function makeDir(prefix: string): { dir: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function seedWorktree(workdir: string, runId: string): Promise<void> {
    mkdirSync(join(workdir, '.spur', 'run'), { recursive: true });
    const db = await openInlineRunProjectDb(workdir);
    try {
        await db.adapter.run(RUN_INSERT, runId);
        await db.adapter.run(
            `INSERT INTO action_runs (id, run_id, node, kind, status, duration_ms, ok, created_at, updated_at)
             VALUES (?, ?, 'implement', 'agent.run', 'done', 10, 1, 1, 1)`,
            `act_${runId}`,
            runId,
        );
    } finally {
        db.close();
    }
    writeFileSync(join(workdir, '.spur', 'run', `${runId}.md`), `# spur inline run ${runId}\n`);
    writeFileSync(join(workdir, '.spur', 'run', `${runId}.state.json`), `{"runId":"${runId}"}\n`);
}

describe('persistWorktreeRuns (task 0975 R1)', () => {
    test('copies rows and run records into the invoking tree; re-persist is idempotent', async () => {
        const from = makeDir('persist-from-');
        const to = makeDir('persist-to-');
        try {
            await seedWorktree(from.dir, 'run_0975');

            const first = await persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir });
            expect(first).toEqual({ ok: true, persisted: 1, skipped: [] });
            expect(readFileSync(join(to.dir, '.spur', 'run', 'run_0975.md'), 'utf8')).toContain('run_0975');
            expect(JSON.parse(readFileSync(join(to.dir, '.spur', 'run', 'run_0975.state.json'), 'utf8'))).toEqual({
                runId: 'run_0975',
            });

            const db = await openInlineRunProjectDb(to.dir);
            try {
                const run = await db.adapter.queryFirst<{ status: string }>(
                    'SELECT status FROM runs WHERE id = ?',
                    'run_0975',
                );
                expect(run?.status).toBe('done');
                const actions = await db.adapter.queryAll('SELECT id FROM action_runs WHERE run_id = ?', 'run_0975');
                expect(actions).toHaveLength(1);
            } finally {
                db.close();
            }

            const second = await persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir });
            expect(second.persisted).toBe(0);
            expect(second.skipped).toEqual([{ id: 'run_0975', reason: 'id-exists' }]);
            // Row counts unchanged after the second persist.
            const db2 = await openInlineRunProjectDb(to.dir);
            try {
                expect(await db2.adapter.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM runs')).toEqual({
                    n: 1,
                });
                expect(await db2.adapter.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM action_runs')).toEqual({
                    n: 1,
                });
            } finally {
                db2.close();
            }
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('never overwrites a divergent invoking-tree record — reported as skipped', async () => {
        const from = makeDir('persist-conflict-from-');
        const to = makeDir('persist-conflict-to-');
        try {
            await seedWorktree(from.dir, 'run_cf');
            mkdirSync(join(to.dir, '.spur', 'run'), { recursive: true });
            writeFileSync(join(to.dir, '.spur', 'run', 'run_cf.state.json'), '{"runId":"someone-else"}\n');

            const result = await persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir });
            expect(result.ok).toBe(true);
            expect(result.skipped).toContainEqual({ id: 'run_cf', reason: 'record-conflict:run_cf.state.json' });
            // The pre-existing invoking-tree record stands.
            expect(readFileSync(join(to.dir, '.spur', 'run', 'run_cf.state.json'), 'utf8')).toContain('someone-else');
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('a DB-sourced run id that is not a safe filename component rejects before any target write', async () => {
        const from = makeDir('persist-unsafe-from-');
        const to = makeDir('persist-unsafe-to-');
        try {
            // Accept: a sane id persists normally (same happy path as the first test).
            await seedWorktree(from.dir, 'run_ok');
            expect(await persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir })).toEqual({
                ok: true,
                persisted: 1,
                skipped: [],
            });

            // Reject: an id planted in the worktree DB that would traverse out of
            // `.spur/run/` if copied as `<id>.md` throws the named invalid-run-id error
            // (task 0975 R2 hardening) — and the target keeps exactly the rows the accept
            // pass inserted, because validation runs before the target DB is opened.
            await seedWorktree(from.dir, '../escape');
            expect(persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir })).rejects.toBeInstanceOf(
                InvalidWorkflowRunIdError,
            );

            const db = await openInlineRunProjectDb(to.dir);
            try {
                const runs = await db.adapter.queryAll<{ id: string }>('SELECT id FROM runs ORDER BY id');
                expect(runs.map((row) => row.id)).toEqual(['run_ok']);
            } finally {
                db.close();
            }
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('an unreadable worktree DB fails closed', async () => {
        const from = makeDir('persist-bad-from-');
        const to = makeDir('persist-bad-to-');
        try {
            mkdirSync(join(from.dir, '.spur'), { recursive: true });
            writeFileSync(join(from.dir, '.spur', 'spur.db'), 'this is not a sqlite database');
            expect(persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir })).rejects.toThrow();
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });
});
