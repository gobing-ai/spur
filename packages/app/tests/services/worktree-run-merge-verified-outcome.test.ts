import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCliMigrations, type DbAdapter, transferRunTables } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { deriveVerifiedOutcome } from '../../src/services/verified-outcome';

/**
 * Task 1324 (feature D, AC1/R4): a worktree run's provenance — `runs`,
 * `phase_runs`, `task_run_links`, `history_run_session` — lands in the project
 * DB through the persist-out merge with ids preserved and worktree-origin
 * markers, and `history analyze`'s verifiedOutcome block then counts the task
 * in the denominator (the false `taskDenominator = 0` closed) with a real
 * measured-token figure flowing through the merged run→session mapping.
 */

const TASK_WBS = '0345';

const TASK_BODY = `---
wbs: "${TASK_WBS}"
status: done
---

## History

- 2026-11-10T09:00:00.000Z backlog → todo (system)
- 2026-11-10T09:05:00.000Z todo → wip (system)
- 2026-11-10T10:00:00.000Z testing → done (system)

## Testing

- [x] R1. covered
  - Verdict: PASS (from verdict artifact)
`;

const PASS_REQUIREMENTS = [{ id: 'R1', status: 'MET', evidence: 'worktree run verified' }];

const VERDICT = {
    wbs: TASK_WBS,
    verdict: 'PASS',
    requirements: PASS_REQUIREMENTS,
    proof: { digest: 'sha256:worktree', runId: 'wt_run_0345' },
};

async function setup(): Promise<DbAdapter> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    return adapter;
}

/** Seed one worktree-shaped DB: pipeline run + link + run→session mapping + session usage. */
async function seedWorktreeDb(db: DbAdapter): Promise<void> {
    await db.run(
        `INSERT INTO runs (id, workflow_name, mode, status, agent, external_key, started_at, completed_at, metadata_json)
         VALUES ('wt_run_0345', 'task-pipeline', 'auto', 'done', NULL, NULL,
                 '2026-11-10T09:05:00.000Z', '2026-11-10T10:00:00.000Z', '{}')`,
    );
    await db.run(
        `INSERT INTO phase_runs (id, run_id, phase, status, created_at, updated_at)
         VALUES ('wt_ph_0345', 'wt_run_0345', 'verify', 'done', 1, 1)`,
    );
    await db.run(
        `INSERT INTO task_run_links (id, wbs, run_id, kind, created_at)
         VALUES ('wt_link_0345', ?, 'wt_run_0345', 'pipeline', 1)`,
        TASK_WBS,
    );
    await db.run(
        `INSERT INTO history_run_session (run_id, source, session_id, exactness, mechanism, resolved_at)
         VALUES ('wt_run_0345', 'agy', 'sess_wt_0345', 'exact', 'observed', '2026-11-10T10:00:00.000Z')`,
    );
}

/**
 * The project-side history import (not the R1 merge — R1 carries provenance rows only)
 * owns the session's message rows; this is what it writes for the mapped session. The
 * merged run→session mapping is what connects these rows to the worktree run's cost.
 */
async function seedProjectSessionUsage(db: DbAdapter): Promise<void> {
    await db.run(
        `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq, role,
                                      record_type, disposition, ts, model, input_tokens, output_tokens,
                                      content_text, provenance, imported_at)
         VALUES ('wt_msg_1', 'agy', 'brain/sess_wt_0345.jsonl', 1, 'sess_wt_0345', 1, 'assistant',
                 'PLANNER_RESPONSE', 'keep', '2026-11-10T09:30:00.000Z', 'claude-sonnet-4-5', 4200, 800,
                 'worktree plan step', 'ambient', '2026-11-10T10:05:00.000Z')`,
    );
}

describe('worktree provenance merge → verifiedOutcome denominator (task 1324 AC1/R4)', () => {
    test('merged worktree rows count in the task denominator with measured tokens via the merged mapping', async () => {
        const source = await setup();
        const target = await setup();
        await seedWorktreeDb(source);

        // The WT-4 landing merge: ids preserved, origin marker stamped, mapping re-marked.
        const merged = await transferRunTables(source, target);
        expect(merged.persistedIds).toEqual(['wt_run_0345']);
        const runRow = await target.queryFirst<{ metadata_json: string }>(
            'SELECT metadata_json FROM runs WHERE id = ?',
            'wt_run_0345',
        );
        expect((JSON.parse(runRow?.metadata_json ?? '{}') as Record<string, unknown>).worktree_origin).toBe(true);
        const mapping = await target.queryFirst<{ mechanism: string; exactness: string }>(
            'SELECT mechanism, exactness FROM history_run_session WHERE run_id = ?',
            'wt_run_0345',
        );
        expect(mapping).toEqual({ mechanism: 'worktree-merge', exactness: 'exact' });
        // Project-side import supplies the mapped session's usage rows.
        await seedProjectSessionUsage(target);

        // Project-tree corpus: task file + durable verdict naming the worktree run.
        const cwd = mkdtempSync(join(tmpdir(), 'wt-vo-1324-'));
        mkdirSync(join(cwd, 'tasks'), { recursive: true });
        writeFileSync(join(cwd, 'tasks', `${TASK_WBS}_feature.md`), TASK_BODY);
        mkdirSync(join(cwd, '.spur', 'run'), { recursive: true });
        writeFileSync(join(cwd, '.spur', 'run', `${TASK_WBS}-verdict.json`), JSON.stringify(VERDICT));

        const stat = await deriveVerifiedOutcome(
            {
                fs: {
                    readFile: async (p: string) => (p.endsWith('.md') ? TASK_BODY : JSON.stringify(VERDICT)),
                } as unknown as FileSystem,
                db: target,
                cwd,
                locator: {
                    findByWbs: async (wbs: string) => ({
                        wbs,
                        name: `${wbs}_feature.md`,
                        filePath: join(cwd, 'tasks', `${wbs}_feature.md`),
                    }),
                },
            },
            {},
        );
        expect(stat).not.toBeNull();
        // R4: the worktree run's link counts — never a false 0.
        expect(stat?.taskDenominator).toBe(1);
        expect(stat?.verifiedResults).toBe(1);
        expect(stat?.excludedReasons.certifyingRunFailed).toBe(0);
        // Merged exact run→session mapping drives measured tokens (previously impossible:
        // the worktree's session mapping died with the tree).
        expect(stat?.costCoverage).toEqual({ covered: 1, total: 1 });
        expect(stat?.measuredTokensPerVerifiedResult).toBe(5000);
        source.close();
        target.close();
    });

    test('without the merge the same tree yields a zero denominator (the 1324 regression)', async () => {
        const target = await setup();
        const cwd = mkdtempSync(join(tmpdir(), 'wt-vo-1324-unmerged-'));
        mkdirSync(join(cwd, 'tasks'), { recursive: true });
        writeFileSync(join(cwd, 'tasks', `${TASK_WBS}_feature.md`), TASK_BODY);
        const stat = await deriveVerifiedOutcome(
            {
                fs: { readFile: async () => TASK_BODY } as unknown as FileSystem,
                db: target,
                cwd,
            },
            {},
        );
        expect(stat?.taskDenominator).toBe(0);
        target.close();
    });
});
