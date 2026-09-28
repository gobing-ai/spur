import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { InvalidWorkflowRunIdError, openInlineRunProjectDb, persistWorktreeRuns } from '../../src';

/**
 * Task 0975 R1 — the app persist-out operation: DB row transfer plus two-file run-record
 * copy from a worktree into an invoking tree, before the worktree is removed. Idempotent
 * on re-persist; fail-closed on an unreadable source DB; never overwrites a divergent
 * invoking-tree record.
 */

const RUN_INSERT = `INSERT INTO runs (id, workflow_name, mode, status, agent, external_key, started_at, completed_at,
                                      metadata_json, created_at, updated_at)
                    VALUES (?, ?, 'state-machine', 'done', NULL, NULL, '2026-09-26T00:00:00Z', NULL, '{}', 1, 1)`;

function makeDir(prefix: string): { dir: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function seedWorktree(workdir: string, runId: string, workflowName = 'wf'): Promise<void> {
    mkdirSync(join(workdir, '.spur', 'run'), { recursive: true });
    const db = await openInlineRunProjectDb(workdir);
    try {
        await db.adapter.run(RUN_INSERT, runId, workflowName);
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

describe('persistWorktreeRuns cited evidence + record tolerance (task 0984)', () => {
    /** Write a merged task file into the invoking tree citing the given `.spur/run/` paths. */
    function writeTaskFile(toDir: string, name: string, citations: string[]): string {
        const taskPath = join(toDir, name);
        mkdirSync(dirname(taskPath), { recursive: true });
        writeFileSync(taskPath, `## Testing\n\nEvidence: ${citations.map((c) => `\`.spur/run/${c}\``).join(', ')}\n`);
        return name;
    }

    test('copies the evidence a merged task file cites into the invoking tree; re-persist is idempotent (R1–R4)', async () => {
        const from = makeDir('cited-from-');
        const to = makeDir('cited-to-');
        try {
            await seedWorktree(from.dir, 'run_0984');
            writeFileSync(join(from.dir, '.spur', 'run', '0984-check-receipt.json'), '{"ok":true}\n');
            writeFileSync(join(from.dir, '.spur', 'run', '0984-test-gate.log'), 'gate ok\n');
            const taskFile = writeTaskFile(to.dir, 'docs/task-0984.md', [
                'run_0984.md',
                '0984-check-receipt.json',
                '0984-test-gate.log',
            ]);

            const first = await persistWorktreeRuns({
                fromWorkdir: from.dir,
                toWorkdir: to.dir,
                taskFiles: [taskFile],
            });
            expect(first).toEqual({ ok: true, persisted: 1, skipped: [] });
            expect(readFileSync(join(to.dir, '.spur', 'run', '0984-check-receipt.json'), 'utf8')).toContain('ok');
            expect(readFileSync(join(to.dir, '.spur', 'run', '0984-test-gate.log'), 'utf8')).toContain('gate');

            // Byte-identical re-persist: rows skip id-exists, cited files are idempotent no-ops.
            const second = await persistWorktreeRuns({
                fromWorkdir: from.dir,
                toWorkdir: to.dir,
                taskFiles: [taskFile],
            });
            expect(second.persisted).toBe(0);
            expect(second.skipped).toEqual([{ id: 'run_0984', reason: 'id-exists' }]);
            expect(readFileSync(join(to.dir, '.spur', 'run', '0984-check-receipt.json'), 'utf8')).toBe('{"ok":true}\n');
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('a citation missing in both trees fails with zero writes (R1)', async () => {
        const from = makeDir('cited-missing-from-');
        const to = makeDir('cited-missing-to-');
        try {
            await seedWorktree(from.dir, 'run_0984b');
            const taskFile = writeTaskFile(to.dir, 'docs/task-0984b.md', ['0984-vanished.json']);
            await expect(
                persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir, taskFiles: [taskFile] }),
            ).rejects.toThrow(/0984-vanished\.json/);
            // Validation runs before the DB is even opened: no rows, no records, no evidence.
            const db = await openInlineRunProjectDb(to.dir);
            try {
                expect(await db.adapter.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM runs')).toEqual({ n: 0 });
            } finally {
                db.close();
            }
            expect(existsSync(join(to.dir, '.spur', 'run'))).toBe(false);
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('a divergent cited file is never overwritten and blocks the pass (R4)', async () => {
        const from = makeDir('cited-cf-from-');
        const to = makeDir('cited-cf-to-');
        try {
            await seedWorktree(from.dir, 'run_0984c');
            writeFileSync(join(from.dir, '.spur', 'run', '0984-verdict.json'), '{"v":2}\n');
            const taskFile = writeTaskFile(to.dir, 'docs/task-0984c.md', ['0984-verdict.json']);
            mkdirSync(join(to.dir, '.spur', 'run'), { recursive: true });
            writeFileSync(join(to.dir, '.spur', 'run', '0984-verdict.json'), '{"v":1}\n');

            await expect(
                persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir, taskFiles: [taskFile] }),
            ).rejects.toThrow(/0984-verdict\.json/);
            expect(readFileSync(join(to.dir, '.spur', 'run', '0984-verdict.json'), 'utf8')).toBe('{"v":1}\n');
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('abbreviated/glob references are not literal citations — neither fail nor copy (R3)', async () => {
        const from = makeDir('cited-tmpl-from-');
        const to = makeDir('cited-tmpl-to-');
        try {
            await seedWorktree(from.dir, 'run_0984d');
            writeFileSync(join(from.dir, '.spur', 'run', '0984-real.json'), '{}\n');
            const taskFile = writeTaskFile(to.dir, 'docs/task-0984d.md', [
                'fadca099-…-wrapup-learnings.md',
                'run-*-ac87.log',
                '{batch-report.md,verdicts/}',
                'a..b-escape.json',
                '0984-real.json',
            ]);
            const result = await persistWorktreeRuns({
                fromWorkdir: from.dir,
                toWorkdir: to.dir,
                taskFiles: [taskFile],
            });
            expect(result.ok).toBe(true);
            expect(existsSync(join(to.dir, '.spur', 'run', '0984-real.json'))).toBe(true);
            for (const absent of ['fadca099-…-wrapup-learnings.md', 'run-*-ac87.log', 'a..b-escape.json']) {
                expect(existsSync(join(to.dir, '.spur', 'run', absent))).toBe(false);
            }
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('unquoted prose citations drop trailing sentence punctuation (R1/R3)', async () => {
        const from = makeDir('cited-prose-from-');
        const to = makeDir('cited-prose-to-');
        try {
            await seedWorktree(from.dir, 'run_0984p');
            writeFileSync(join(from.dir, '.spur', 'run', '0984-a.json'), '{}\n');
            writeFileSync(join(from.dir, '.spur', 'run', '0984-b.json'), '{}\n');
            mkdirSync(join(to.dir, 'docs'), { recursive: true });
            writeFileSync(
                join(to.dir, 'docs', 'task-0984p.md'),
                'See .spur/run/0984-a.json, then .spur/run/0984-b.json.\n',
            );
            const result = await persistWorktreeRuns({
                fromWorkdir: from.dir,
                toWorkdir: to.dir,
                taskFiles: ['docs/task-0984p.md'],
            });
            expect(result.ok).toBe(true);
            expect(existsSync(join(to.dir, '.spur', 'run', '0984-a.json'))).toBe(true);
            expect(existsSync(join(to.dir, '.spur', 'run', '0984-b.json'))).toBe(true);
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('root-qualified citations are foreign evidence: no copy, no missing-in-both refusal (R1/R3)', async () => {
        const from = makeDir('cited-foreign-from-');
        const to = makeDir('cited-foreign-to-');
        try {
            await seedWorktree(from.dir, 'run_0984f');
            writeFileSync(join(from.dir, '.spur', 'run', '0984-local.json'), '{}\n');
            mkdirSync(join(to.dir, 'docs'), { recursive: true });
            writeFileSync(
                join(to.dir, 'docs', 'task-0984f.md'),
                [
                    'Local: `.spur/run/0984-local.json`.',
                    'Foreign: `knowledge-kit/.spur/run/runall-d6-4440-batch-report.md`,',
                    '`/abs/proj/.spur/run/abs.json`, `~/.spur/run/home.json`, `../kk/.spur/run/rel.json`.',
                ].join('\n'),
            );
            const result = await persistWorktreeRuns({
                fromWorkdir: from.dir,
                toWorkdir: to.dir,
                taskFiles: ['docs/task-0984f.md'],
            });
            expect(result.ok).toBe(true);
            expect(existsSync(join(to.dir, '.spur', 'run', '0984-local.json'))).toBe(true);

            // The same file name cited bare (repo-relative) is still local and still fatal when missing.
            writeFileSync(join(to.dir, 'docs', 'task-0984f.md'), 'Bare: `.spur/run/runall-d6-4440-batch-report.md`\n');
            await expect(
                persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir, taskFiles: ['docs/task-0984f.md'] }),
            ).rejects.toThrow('missing in both');
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('a citation resolving to a directory is reported, not copied or fatal (R3)', async () => {
        const from = makeDir('cited-dir-from-');
        const to = makeDir('cited-dir-to-');
        try {
            await seedWorktree(from.dir, 'run_0984e');
            mkdirSync(join(from.dir, '.spur', 'run', '0984-verdicts'), { recursive: true });
            const taskFile = writeTaskFile(to.dir, 'docs/task-0984e.md', ['0984-verdicts']);
            const result = await persistWorktreeRuns({
                fromWorkdir: from.dir,
                toWorkdir: to.dir,
                taskFiles: [taskFile],
            });
            expect(result.ok).toBe(true);
            expect(result.skipped).toEqual([{ id: '0984-verdicts', reason: 'cited-directory:0984-verdicts' }]);
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('more than 64 distinct cited files refuses with zero writes (R3)', async () => {
        const from = makeDir('cited-cap-from-');
        const to = makeDir('cited-cap-to-');
        try {
            await seedWorktree(from.dir, 'run_0984f');
            const citations = Array.from({ length: 65 }, (_, i) => `cap-${i}.json`);
            const taskFile = writeTaskFile(to.dir, 'docs/task-0984f.md', citations);
            await expect(
                persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir, taskFiles: [taskFile] }),
            ).rejects.toThrow(/citation cap/);
            const db = await openInlineRunProjectDb(to.dir);
            try {
                expect(await db.adapter.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM runs')).toEqual({ n: 0 });
            } finally {
                db.close();
            }
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('a record-less task-lifecycle row is reported and still counts in persisted, beside a normal run (R5)', async () => {
        const from = makeDir('cited-lc-from-');
        const to = makeDir('cited-lc-to-');
        try {
            await seedWorktree(from.dir, 'run_0984g');
            const db = await openInlineRunProjectDb(from.dir);
            try {
                await db.adapter.run(RUN_INSERT, 'run_lc', 'task-lifecycle');
            } finally {
                db.close();
            }

            const result = await persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir });
            expect(result.persisted).toBe(2);
            expect(result.skipped).toEqual([
                { id: 'run_lc', reason: 'record-missing:run_lc.md' },
                { id: 'run_lc', reason: 'record-missing:run_lc.state.json' },
            ]);
            const target = await openInlineRunProjectDb(to.dir);
            try {
                const names = await target.adapter.queryAll<{ workflow_name: string }>(
                    'SELECT workflow_name FROM runs ORDER BY rowid',
                );
                expect(names.map((row) => row.workflow_name)).toEqual(['wf', 'task-lifecycle']);
            } finally {
                target.close();
            }
            // The normal run's records still copied.
            expect(existsSync(join(to.dir, '.spur', 'run', 'run_0984g.md'))).toBe(true);
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('a missing task-pipeline record stays fatal (R5)', async () => {
        const from = makeDir('cited-fatal-from-');
        const to = makeDir('cited-fatal-to-');
        try {
            const db = await openInlineRunProjectDb(from.dir);
            try {
                await db.adapter.run(RUN_INSERT, 'run_pipe', 'task-pipeline');
            } finally {
                db.close();
            }
            await expect(persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir })).rejects.toThrow(
                /run_pipe\.md/,
            );
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('an unreadable merged task file fails closed', async () => {
        const from = makeDir('cited-tf-from-');
        const to = makeDir('cited-tf-to-');
        try {
            await seedWorktree(from.dir, 'run_0984h');
            await expect(
                persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir, taskFiles: ['docs/absent.md'] }),
            ).rejects.toThrow(/absent\.md/);
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });
});
