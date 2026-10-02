import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { InvalidWorkflowRunIdError, openInlineRunProjectDb, persistWorktreeRuns, runStoragePaths } from '../../src';

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
    // 1026: the record pair lives in the durable plane, not scratch.
    const recordsDir = runStoragePaths(workdir).recordsDir;
    mkdirSync(recordsDir, { recursive: true });
    writeFileSync(join(recordsDir, `${runId}.md`), `# spur inline run ${runId}\n`);
    writeFileSync(join(recordsDir, `${runId}.state.json`), `{"runId":"${runId}"}\n`);
}

describe('persistWorktreeRuns (task 0975 R1)', () => {
    test('exports canonical evidence, registered artifacts and session references without scratch', async () => {
        const from = makeDir('persist-durable-from-');
        const to = makeDir('persist-durable-to-');
        try {
            await seedWorktree(from.dir, 'retained');
            const paths = runStoragePaths(from.dir);
            const artifact = join(paths.recordsDir, 'retained/artifacts/result.json');
            const sessionDir = join(paths.recordsDir, 'retained/agent-sessions/omp');
            mkdirSync(dirname(artifact), { recursive: true });
            mkdirSync(sessionDir, { recursive: true });
            writeFileSync(artifact, '{"ok":true}');
            writeFileSync(join(sessionDir, 'session.jsonl'), 'retained session');
            mkdirSync(paths.evidenceDir, { recursive: true });
            writeFileSync(join(paths.evidenceDir, '1026-verdict.json'), '{"wbs":"1026","verdict":"PASS"}');
            const receipt = {
                schemaVersion: 1,
                featureId: 'E71',
                runId: 'retained',
                workdir: from.dir,
                verifier: {
                    name: 'verify',
                    sourcePath: 'verify.yaml',
                    layer: 'project',
                    definitionDigest: `sha256:${'a'.repeat(64)}`,
                },
                verificationCmd: 'bun test',
                inputDigest: `sha256:${'b'.repeat(64)}`,
                status: 'PASS',
                startedAt: '2026-10-01T00:00:00Z',
                completedAt: '2026-10-01T00:01:00Z',
            };
            for (const owner of ['E71', 'retained'])
                writeFileSync(join(paths.evidenceDir, `${owner}-feature-verification.json`), JSON.stringify(receipt));
            const source = await openInlineRunProjectDb(from.dir);
            await source.adapter.run(
                "INSERT INTO artifacts (id,run_id,path,kind,created_at,updated_at) VALUES ('artifact','retained',?,'result',1,1)",
                artifact,
            );
            await source.adapter.run(
                "INSERT INTO task_run_links (id,wbs,run_id,kind,created_at) VALUES ('link','1026','retained','pipeline',1)",
            );
            await source.adapter.run(
                'UPDATE runs SET metadata_json = ? WHERE id = ?',
                JSON.stringify({ sessionDir, proofDigest: 'keep' }),
                'retained',
            );
            source.close();
            rmSync(join(from.dir, '.spur/run'), { recursive: true });
            expect((await persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir })).ok).toBe(true);
            expect((await persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir })).persisted).toBe(0);
            from.cleanup();
            const target = await openInlineRunProjectDb(to.dir);
            try {
                const row = await target.adapter.queryFirst<{ path: string }>(
                    "SELECT path FROM artifacts WHERE id='artifact'",
                );
                expect(readFileSync(row?.path as string, 'utf8')).toBe('{"ok":true}');
                const run = await target.adapter.queryFirst<{ metadata_json: string }>(
                    "SELECT metadata_json FROM runs WHERE id='retained'",
                );
                const metadata = JSON.parse(run?.metadata_json as string);
                expect(readFileSync(join(metadata.sessionDir, 'session.jsonl'), 'utf8')).toBe('retained session');
                expect(metadata.proofDigest).toBe('keep');
                expect(
                    await target.adapter.queryFirst<{ id: string }>("SELECT id FROM task_run_links WHERE id='link'"),
                ).toEqual({
                    id: 'link',
                });
                for (const name of [
                    '1026-verdict.json',
                    'E71-feature-verification.json',
                    'retained-feature-verification.json',
                ]) {
                    expect(
                        JSON.parse(readFileSync(join(runStoragePaths(to.dir).evidenceDir, name), 'utf8')).verdict ??
                            'PASS',
                    ).toBe('PASS');
                }
            } finally {
                target.close();
            }
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('durable evidence conflict and foreign identity reject before target database creation', async () => {
        const from = makeDir('persist-evidence-from-');
        const to = makeDir('persist-evidence-to-');
        try {
            await seedWorktree(from.dir, 'retained');
            const source = join(runStoragePaths(from.dir).evidenceDir, '1026-verdict.json');
            const target = join(runStoragePaths(to.dir).evidenceDir, '1026-verdict.json');
            mkdirSync(dirname(source), { recursive: true });
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(source, '{"wbs":"9999","verdict":"PASS"}');
            await expect(persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir })).rejects.toThrow('identity');
            expect(existsSync(join(to.dir, '.spur/spur.db'))).toBe(false);
            writeFileSync(source, '{"wbs":"1026","verdict":"PASS"}');
            writeFileSync(target, '{"wbs":"1026","verdict":"FAIL"}');
            await expect(persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir })).rejects.toThrow(
                'conflicts',
            );
            expect(existsSync(join(to.dir, '.spur/spur.db'))).toBe(false);
            expect(readFileSync(target, 'utf8')).toContain('FAIL');
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });
    test('copies rows and run records into the invoking tree; re-persist is idempotent', async () => {
        const from = makeDir('persist-from-');
        const to = makeDir('persist-to-');
        try {
            await seedWorktree(from.dir, 'run_0975');

            const first = await persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir });
            expect(first).toEqual({ ok: true, persisted: 1, skipped: [] });
            const toRecords = runStoragePaths(to.dir).recordsDir;
            expect(readFileSync(join(toRecords, 'run_0975.md'), 'utf8')).toContain('run_0975');
            expect(JSON.parse(readFileSync(join(toRecords, 'run_0975.state.json'), 'utf8'))).toEqual({
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
            const toRecordsCf = runStoragePaths(to.dir).recordsDir;
            mkdirSync(toRecordsCf, { recursive: true });
            writeFileSync(join(toRecordsCf, 'run_cf.state.json'), '{"runId":"someone-else"}\n');

            const result = await persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir });
            expect(result.ok).toBe(true);
            expect(result.skipped).toContainEqual({ id: 'run_cf', reason: 'record-conflict:run_cf.state.json' });
            // The pre-existing invoking-tree record stands.
            expect(readFileSync(join(toRecordsCf, 'run_cf.state.json'), 'utf8')).toContain('someone-else');
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
            // 1026: an unsafe run id copied into `.spur/memory/runs/` as `<id>.md` throws the named invalid-run-id error
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

    test('a citation resolving to a symlink is reported as a symlink, never followed or copied (R3)', async () => {
        const from = makeDir('cited-link-from-');
        const to = makeDir('cited-link-to-');
        try {
            await seedWorktree(from.dir, 'run_0984s');
            writeFileSync(join(from.dir, 'outside.json'), '{}');
            symlinkSync(join(from.dir, 'outside.json'), join(from.dir, '.spur', 'run', '0984-link.json'));
            const taskFile = writeTaskFile(to.dir, 'docs/task-0984s.md', ['0984-link.json']);
            const result = await persistWorktreeRuns({
                fromWorkdir: from.dir,
                toWorkdir: to.dir,
                taskFiles: [taskFile],
            });
            expect(result.ok).toBe(true);
            expect(result.skipped).toEqual([{ id: '0984-link.json', reason: 'cited-symlink:0984-link.json' }]);
            expect(existsSync(join(to.dir, '.spur', 'run', '0984-link.json'))).toBe(false);
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
            // The normal run's records still copied (1026: records land in the durable plane).
            expect(existsSync(join(runStoragePaths(to.dir).recordsDir, 'run_0984g.md'))).toBe(true);
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

describe('persistWorktreeRuns owned evidence (task 1012)', () => {
    /** A merged task file that cites no `.spur/run/` path at all — ownership comes from its WBS. */
    function writeUncitingTaskFile(toDir: string): string {
        mkdirSync(join(toDir, 'docs'), { recursive: true });
        writeFileSync(join(toDir, 'docs', '1234_x.md'), '## Testing\n\nno citations here\n');
        return 'docs/1234_x.md';
    }

    function seedOwnedEvidence(fromDir: string): void {
        writeFileSync(join(fromDir, '.spur', 'run', '1234-verdict.json'), '{"verdict":"PASS"}\n');
        writeFileSync(join(fromDir, '.spur', 'run', 'run_1012-route-reason.txt'), 'inline\n');
        writeFileSync(join(fromDir, '.spur', 'run', '9999-verdict.json'), '{"verdict":"FAIL"}\n');
    }

    test('copies <wbs>- and <runId>- prefixed evidence the task file never cites; re-persist is a no-op (R1)', async () => {
        const from = makeDir('owned-from-');
        const to = makeDir('owned-to-');
        try {
            await seedWorktree(from.dir, 'run_1012');
            seedOwnedEvidence(from.dir);
            const taskFile = writeUncitingTaskFile(to.dir);

            const first = await persistWorktreeRuns({
                fromWorkdir: from.dir,
                toWorkdir: to.dir,
                taskFiles: [taskFile],
            });
            expect(first).toEqual({ ok: true, persisted: 1, skipped: [] });
            const toRun = join(to.dir, '.spur', 'run');
            expect(readFileSync(join(toRun, '1234-verdict.json'), 'utf8')).toBe('{"verdict":"PASS"}\n');
            expect(readFileSync(join(toRun, 'run_1012-route-reason.txt'), 'utf8')).toBe('inline\n');
            expect(existsSync(join(toRun, '9999-verdict.json'))).toBe(false);

            const second = await persistWorktreeRuns({
                fromWorkdir: from.dir,
                toWorkdir: to.dir,
                taskFiles: [taskFile],
            });
            expect(second).toEqual({ ok: true, persisted: 0, skipped: [{ id: 'run_1012', reason: 'id-exists' }] });
            expect(readFileSync(join(toRun, '1234-verdict.json'), 'utf8')).toBe('{"verdict":"PASS"}\n');
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('a divergent owned target is never overwritten and fails with zero writes (R1/R2)', async () => {
        const from = makeDir('owned-cf-from-');
        const to = makeDir('owned-cf-to-');
        try {
            await seedWorktree(from.dir, 'run_1012b');
            seedOwnedEvidence(from.dir);
            writeFileSync(join(from.dir, '.spur', 'run', 'run_1012b-route-reason.txt'), 'inline\n');
            const taskFile = writeUncitingTaskFile(to.dir);
            const toRun = join(to.dir, '.spur', 'run');
            mkdirSync(toRun, { recursive: true });
            writeFileSync(join(toRun, '1234-verdict.json'), '{"verdict":"OLD"}\n');

            await expect(
                persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir, taskFiles: [taskFile] }),
            ).rejects.toThrow(/1234-verdict\.json/);
            expect(readFileSync(join(toRun, '1234-verdict.json'), 'utf8')).toBe('{"verdict":"OLD"}\n');
            expect(existsSync(join(toRun, 'run_1012b-route-reason.txt'))).toBe(false);
            expect(existsSync(join(toRun, 'run_1012b.md'))).toBe(false);
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

    test('a dangling owned destination symlink refuses before writes (1012 R2)', async () => {
        const from = makeDir('owned-link-from-');
        const to = makeDir('owned-link-to-');
        try {
            await seedWorktree(from.dir, 'run_1012link');
            seedOwnedEvidence(from.dir);
            const taskFile = writeUncitingTaskFile(to.dir);
            const toRun = join(to.dir, '.spur', 'run');
            mkdirSync(toRun, { recursive: true });
            const outside = join(to.dir, 'outside.json');
            symlinkSync(outside, join(toRun, '1234-verdict.json'));
            await expect(
                persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir, taskFiles: [taskFile] }),
            ).rejects.toThrow(/1234-verdict\.json/);
            expect(existsSync(outside)).toBe(false);
            expect(existsSync(join(toRun, 'run_1012link.md'))).toBe(false);
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

    test('without taskFiles no owned evidence is copied (R2)', async () => {
        const from = makeDir('owned-none-from-');
        const to = makeDir('owned-none-to-');
        try {
            await seedWorktree(from.dir, 'run_1012c');
            seedOwnedEvidence(from.dir);
            writeFileSync(join(from.dir, '.spur', 'run', 'run_1012c-route-reason.txt'), 'inline\n');

            const result = await persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir });
            expect(result).toEqual({ ok: true, persisted: 1, skipped: [] });
            const toRun = join(to.dir, '.spur', 'run');
            expect(existsSync(join(toRun, '1234-verdict.json'))).toBe(false);
            expect(existsSync(join(toRun, 'run_1012c-route-reason.txt'))).toBe(false);
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('owned evidence counts toward the 64-file cap (R1)', async () => {
        const from = makeDir('owned-cap-from-');
        const to = makeDir('owned-cap-to-');
        try {
            await seedWorktree(from.dir, 'run_1012d');
            for (let i = 0; i < 65; i += 1) {
                writeFileSync(join(from.dir, '.spur', 'run', `1234-e${i}.log`), 'x\n');
            }
            const taskFile = writeUncitingTaskFile(to.dir);
            await expect(
                persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir, taskFiles: [taskFile] }),
            ).rejects.toThrow(/more than 64/);
            expect(existsSync(join(to.dir, '.spur', 'run'))).toBe(false);
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('owned budgets are per owner: a cited-only name plus 64 owned names persists; a 65th owned name refuses (1034 R1/R2)', async () => {
        const from = makeDir('owned-union-from-');
        const to = makeDir('owned-union-to-');
        try {
            await seedWorktree(from.dir, 'run_1012e');
            for (let i = 0; i < 64; i += 1) {
                writeFileSync(join(from.dir, '.spur', 'run', `1234-e${i}.log`), 'x\n');
            }
            writeFileSync(join(from.dir, '.spur', 'run', 'extra.log'), 'x\n');
            mkdirSync(join(to.dir, 'docs'), { recursive: true });
            const taskFile = 'docs/1234_x.md';
            writeFileSync(join(to.dir, taskFile), 'Evidence: `.spur/run/extra.log`\n');

            // One owner over its own budget refuses with zero writes, naming the owner.
            writeFileSync(join(from.dir, '.spur', 'run', '1234-e64.log'), 'x\n');
            await expect(
                persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir, taskFiles: [taskFile] }),
            ).rejects.toThrow(/owner 1234- .*more than 64/);
            expect(existsSync(join(to.dir, '.spur'))).toBe(false);

            // At exactly 64 owned files, the cited-only file no longer shares a union cap.
            rmSync(join(from.dir, '.spur', 'run', '1234-e64.log'));
            const ok = await persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir, taskFiles: [taskFile] });
            expect(ok).toEqual({ ok: true, persisted: 1, skipped: [] });
            expect(existsSync(join(to.dir, '.spur', 'run', '1234-e63.log'))).toBe(true);
            expect(existsSync(join(to.dir, '.spur', 'run', 'extra.log'))).toBe(true);
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('a 6-run-row batch owning more than 64 files in total persists mechanically (1034 R1/R4)', async () => {
        const from = makeDir('owned-batch-from-');
        const to = makeDir('owned-batch-to-');
        try {
            const runIds = Array.from({ length: 6 }, (_, i) => `run_batch${i}`);
            for (const runId of runIds) {
                await seedWorktree(from.dir, runId);
                // 12 per row: 72 owned files, over the old union cap of 64.
                for (let i = 0; i < 12; i += 1) {
                    writeFileSync(join(from.dir, '.spur', 'run', `${runId}-step${i}.log`), `${runId}\n`);
                }
            }
            const taskFile = writeUncitingTaskFile(to.dir);

            const result = await persistWorktreeRuns({
                fromWorkdir: from.dir,
                toWorkdir: to.dir,
                taskFiles: [taskFile],
            });
            expect(result).toEqual({ ok: true, persisted: 6, skipped: [] });
            // 1026: records copy into the durable plane; owned scratch evidence stays scratch.
            const toRecords = runStoragePaths(to.dir).recordsDir;
            const toRun = join(to.dir, '.spur', 'run');
            for (const runId of runIds) {
                expect(readFileSync(join(toRecords, `${runId}.md`), 'utf8')).toBe(`# spur inline run ${runId}\n`);
                expect(readFileSync(join(toRun, `${runId}-step11.log`), 'utf8')).toBe(`${runId}\n`);
            }
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('cited owned files still count toward their owner budget (1034 R1/R2)', async () => {
        for (const prefix of ['1234-', 'run_1034-']) {
            const from = makeDir('owned-cited-cap-from-');
            const to = makeDir('owned-cited-cap-to-');
            try {
                await seedWorktree(from.dir, 'run_1034');
                const taskFile = writeUncitingTaskFile(to.dir);
                writeFileSync(join(to.dir, taskFile), `Evidence: .spur/run/${prefix}0.log\n`);
                for (let i = 0; i < 65; i++) {
                    writeFileSync(join(from.dir, '.spur', 'run', `${prefix}${i}.log`), 'owned\n');
                }

                await expect(
                    persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir, taskFiles: [taskFile] }),
                ).rejects.toThrow(`owner ${prefix} owns more than 64`);
                expect(existsSync(join(to.dir, '.spur'))).toBe(false);
            } finally {
                from.cleanup();
                to.cleanup();
            }
        }
    });

    test('an empty taskFiles array keeps the legacy rows/records-only path (R2)', async () => {
        const from = makeDir('owned-empty-from-');
        const to = makeDir('owned-empty-to-');
        try {
            await seedWorktree(from.dir, 'run_1012f');
            seedOwnedEvidence(from.dir);
            writeFileSync(join(from.dir, '.spur', 'run', 'run_1012f-route-reason.txt'), 'inline\n');

            const result = await persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir, taskFiles: [] });
            expect(result).toEqual({ ok: true, persisted: 1, skipped: [] });
            // 1026: the record lands in the durable plane; scratch stays scratch.
            const toRun = join(to.dir, '.spur', 'run');
            expect(existsSync(join(runStoragePaths(to.dir).recordsDir, 'run_1012f.md'))).toBe(true);
            expect(existsSync(join(toRun, '1234-verdict.json'))).toBe(false);
            expect(existsSync(join(toRun, 'run_1012f-route-reason.txt'))).toBe(false);
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('an evidence dir that cannot be listed fails before any target write; an absent one is fine (R4)', async () => {
        const from = makeDir('owned-enotdir-from-');
        const to = makeDir('owned-enotdir-to-');
        try {
            // Migrated source DB with zero run rows; no `.spur/run` yet (ENOENT).
            (await openInlineRunProjectDb(from.dir)).close();
            const taskFile = writeUncitingTaskFile(to.dir);
            expect(existsSync(join(from.dir, '.spur', 'run'))).toBe(false);
            const absent = await persistWorktreeRuns({
                fromWorkdir: from.dir,
                toWorkdir: to.dir,
                taskFiles: [taskFile],
            });
            expect(absent).toEqual({ ok: true, persisted: 0, skipped: [] });

            // `.spur/run` is a regular file: ENOTDIR must not read as "no owned evidence".
            const to2 = makeDir('owned-enotdir-to2-');
            try {
                writeFileSync(join(from.dir, '.spur', 'run'), 'not a directory\n');
                const taskFile2 = writeUncitingTaskFile(to2.dir);
                await expect(
                    persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to2.dir, taskFiles: [taskFile2] }),
                ).rejects.toThrow(/ENOTDIR/);
                expect(existsSync(join(to2.dir, '.spur'))).toBe(false);
            } finally {
                to2.cleanup();
            }
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });
});

describe('persistWorktreeRuns fail-closed + replay repair (task 1043)', () => {
    test('a task-pipeline row with a missing record fails closed before the target DB is opened (R1/AC1)', async () => {
        const from = makeDir('persist-fc-from-');
        const to = makeDir('persist-fc-to-');
        try {
            // A healthy row WOULD insert if the target DB were opened; the broken
            // task-pipeline row must abort the whole pass with zero rows transferred.
            await seedWorktree(from.dir, 'run_1043ok');
            const db = await openInlineRunProjectDb(from.dir);
            try {
                await db.adapter.run(RUN_INSERT, 'run_1043pipe', 'task-pipeline');
            } finally {
                db.close();
            }

            await expect(persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir })).rejects.toThrow(
                /run_1043pipe\.md/,
            );
            const target = await openInlineRunProjectDb(to.dir);
            try {
                expect(await target.adapter.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM runs')).toEqual({
                    n: 0,
                });
                expect(await target.adapter.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM action_runs')).toEqual(
                    { n: 0 },
                );
            } finally {
                target.close();
            }
            // Nothing was written to the invoking tree either (no record dirs created).
            expect(existsSync(runStoragePaths(to.dir).recordsDir)).toBe(false);
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('a replay after torn state (rows without records) repairs the missing records (R2/AC2)', async () => {
        const from = makeDir('persist-rep-from-');
        const to = makeDir('persist-rep-to-');
        try {
            await seedWorktree(from.dir, 'run_1043t');
            // A record-less bookkeeping row replayed beside it must stay a reported skip.
            const db = await openInlineRunProjectDb(from.dir);
            try {
                await db.adapter.run(RUN_INSERT, 'run_1043lc', 'task-lifecycle');
            } finally {
                db.close();
            }
            // Simulate the torn invoking tree from the E71 incident: the rows exist in the
            // target DB but no two-file record ever landed (an earlier persist died mid-pass).
            const torn = await openInlineRunProjectDb(to.dir);
            try {
                await torn.adapter.run(RUN_INSERT, 'run_1043t', 'wf');
                await torn.adapter.run(RUN_INSERT, 'run_1043lc', 'task-lifecycle');
            } finally {
                torn.close();
            }
            expect(existsSync(runStoragePaths(to.dir).recordsDir)).toBe(false);

            const replay = await persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir });
            expect(replay).toEqual({
                ok: true,
                persisted: 0,
                skipped: [
                    { id: 'run_1043t', reason: 'id-exists' },
                    { id: 'run_1043lc', reason: 'id-exists' },
                    { id: 'run_1043lc', reason: 'record-missing:run_1043lc.md' },
                    { id: 'run_1043lc', reason: 'record-missing:run_1043lc.state.json' },
                ],
            });
            const toRecords = runStoragePaths(to.dir).recordsDir;
            expect(readFileSync(join(toRecords, 'run_1043t.md'), 'utf8')).toContain('run_1043t');
            expect(JSON.parse(readFileSync(join(toRecords, 'run_1043t.state.json'), 'utf8'))).toEqual({
                runId: 'run_1043t',
            });
            expect(existsSync(join(toRecords, 'run_1043lc.md'))).toBe(false);
            // The repair is file-plane only: no new or duplicate run rows appeared.
            const target = await openInlineRunProjectDb(to.dir);
            try {
                expect(await target.adapter.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM runs')).toEqual({
                    n: 2,
                });
            } finally {
                target.close();
            }
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('replay-time divergence still refuses overwrite: conflict skip, target record stands (0984 R4)', async () => {
        const from = makeDir('persist-div-from-');
        const to = makeDir('persist-div-to-');
        try {
            await seedWorktree(from.dir, 'run_1043d');
            const torn = await openInlineRunProjectDb(to.dir);
            try {
                await torn.adapter.run(RUN_INSERT, 'run_1043d', 'wf');
            } finally {
                torn.close();
            }
            const toRecords = runStoragePaths(to.dir).recordsDir;
            mkdirSync(toRecords, { recursive: true });
            writeFileSync(join(toRecords, 'run_1043d.state.json'), '{"runId":"someone-else"}\n');

            const replay = await persistWorktreeRuns({ fromWorkdir: from.dir, toWorkdir: to.dir });
            expect(replay.ok).toBe(true);
            expect(replay.persisted).toBe(0);
            // The durable-dir carry (1026 R7) re-reports the same conflict under its composite
            // id, so the pair-pass entries are asserted by containment (same as task 0975).
            expect(replay.skipped).toContainEqual({ id: 'run_1043d', reason: 'id-exists' });
            expect(replay.skipped).toContainEqual({ id: 'run_1043d', reason: 'record-conflict:run_1043d.state.json' });
            // The divergent record stands; the missing sibling record is still repaired.
            expect(readFileSync(join(toRecords, 'run_1043d.state.json'), 'utf8')).toContain('someone-else');
            expect(readFileSync(join(toRecords, 'run_1043d.md'), 'utf8')).toContain('run_1043d');
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });
});
