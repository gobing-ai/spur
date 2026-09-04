import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCliMigrations, type DbAdapter } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { deriveVerifiedOutcome } from '../../src/services/verified-outcome';

/**
 * Smoke fixtures for the app-side verified-outcome derivation (0712): a temp
 * corpus (task file + verdict JSON) plus an in-memory DB holding one completed
 * pipeline run-link. The locator is a stub — folder walking is TaskLocator's
 * contract, covered by its own tests.
 */

const TASK_BODY = `---
wbs: "0701"
status: done
---

## History

- 2026-08-29T10:00:00.000Z backlog → todo (system)
- 2026-08-29T10:05:00.000Z todo → wip (system)
- 2026-08-29T11:00:00.000Z testing → done (system)

## Testing

- [x] R1. covered
  - Verdict: PASS (from verdict artifact)
`;

async function makeEnv(): Promise<{ db: DbAdapter; cwd: string }> {
    const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(db);
    const cwd = mkdtempSync(join(tmpdir(), 'vo-smoke-'));
    mkdirSync(join(cwd, 'tasks'));
    writeFileSync(join(cwd, 'tasks', '0701_clean.md'), TASK_BODY);
    mkdirSync(join(cwd, '.spur', 'run'), { recursive: true });
    writeFileSync(
        join(cwd, '.spur', 'run', '0701-verdict.json'),
        JSON.stringify({ wbs: '0701', verdict: 'PASS', proofDigest: 'sha256:abc' }),
    );
    const id = 'run_0701';
    db.run(
        `INSERT INTO runs (id, workflow_name, mode, status, agent, started_at, completed_at, metadata_json)
         VALUES (?, 'task-pipeline', 'auto', 'done', NULL, ?, ?, '{}')`,
        id,
        '2026-08-29T10:00:00.000Z',
        '2026-08-29T11:00:00.000Z',
    );
    db.run(
        `INSERT INTO task_run_links (id, wbs, run_id, kind, created_at) VALUES ('link_1', '0701', ?, 'pipeline', ?)`,
        id,
        '2026-08-29T11:00:00.000Z',
    );
    return { db, cwd };
}

const stubLocator = (cwd: string) => ({
    findByWbs: async (wbs: string) => ({
        wbs,
        name: `${wbs}_clean.md`,
        filePath: join(cwd, 'tasks', `${wbs}_clean.md`),
    }),
});

const stubFs = (): FileSystem =>
    ({
        readFile: async (p: string) =>
            p.endsWith('.md') ? TASK_BODY : JSON.stringify({ wbs: '0701', verdict: 'PASS', proofDigest: 'sha256:abc' }),
    }) as unknown as FileSystem;

describe('deriveVerifiedOutcome (app derivation smoke)', () => {
    test('derives one verified result from corpus + db + verdict artifact', async () => {
        const { db, cwd } = await makeEnv();
        const stat = await deriveVerifiedOutcome({ db, cwd, locator: stubLocator(cwd), fs: stubFs() }, {});
        expect(stat).not.toBeNull();
        expect(stat?.taskDenominator).toBe(1);
        expect(stat?.verifiedResults).toBe(1);
        expect(stat?.verifiedWithoutCorrection).toBe(1);
        expect(stat?.timeToVerified.count).toBe(1);
        expect(stat?.costCoverage).toEqual({ covered: 0, total: 1 });
        // No run→session mapping exists — measured cost is null, never zero (R4).
        expect(stat?.measuredTokensPerVerifiedResult).toBeNull();
        db.close();
    });

    test('returns null (block absent) when task_run_links does not exist yet', async () => {
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const stat = await deriveVerifiedOutcome({ db, cwd: tmpdir(), fs: stubFs() }, {});
        expect(stat).toBeNull();
        db.close();
    });

    test('window outside the run start excludes the task from the denominator (R7)', async () => {
        const { db, cwd } = await makeEnv();
        const stat = await deriveVerifiedOutcome(
            { db, cwd, locator: stubLocator(cwd), fs: stubFs() },
            {
                since: '2027-01-01T00:00:00.000Z',
                until: '2027-02-01T00:00:00.000Z',
            },
        );
        expect(stat?.taskDenominator).toBe(0);
        db.close();
    });
});

/**
 * 0730 §B binding regression. Both halves were silently open: the pipeline
 * writes the proof as `proof: {digest, runId, …}` (task-pipeline.yaml verify
 * hop) while the reader looked only at a flat `proofDigest` nothing writes, so
 * every pipeline-shaped verdict fell into `excluded.proofAbsent` and the
 * verified population was permanently empty (§B.1); and with no run binding the
 * fold accepted ANY completed linked run as certifying, so a dry-run probe
 * linked to the same wbs read as proof of completion (§B.2).
 */
async function makeBindingEnv(
    verdict: Record<string, unknown>,
    runs: readonly { id: string; status: string }[],
): Promise<{ db: DbAdapter; cwd: string; fs: FileSystem }> {
    const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(db);
    const cwd = mkdtempSync(join(tmpdir(), 'vo-bind-'));
    let n = 0;
    for (const run of runs) {
        db.run(
            `INSERT INTO runs (id, workflow_name, mode, status, agent, started_at, completed_at, metadata_json)
             VALUES (?, 'task-pipeline', 'auto', ?, NULL, ?, ?, '{}')`,
            run.id,
            run.status,
            '2026-08-29T10:00:00.000Z',
            '2026-08-29T11:00:00.000Z',
        );
        n += 1;
        db.run(
            `INSERT INTO task_run_links (id, wbs, run_id, kind, created_at) VALUES (?, '0701', ?, 'pipeline', ?)`,
            `link_${n}`,
            run.id,
            '2026-08-29T11:00:00.000Z',
        );
    }
    const fs = {
        readFile: async (p: string) => (p.endsWith('.md') ? TASK_BODY : JSON.stringify(verdict)),
    } as unknown as FileSystem;
    return { db, cwd, fs };
}

describe('verdict proof binding (0730 §B)', () => {
    test('B.1: a pipeline-shaped nested proof.digest counts as present', async () => {
        const { db, cwd, fs } = await makeBindingEnv(
            { wbs: '0701', verdict: 'PASS', proof: { digest: 'sha256:abc', capturePoint: 'quality-gate-entry' } },
            [{ id: 'run_0701', status: 'done' }],
        );
        const stat = await deriveVerifiedOutcome({ db, cwd, locator: stubLocator(cwd), fs }, {});
        expect(stat?.excludedReasons.proofAbsent).toBe(0);
        expect(stat?.verifiedResults).toBe(1);
        db.close();
    });

    test('B.2: a verdict bound to a run that never completed is not verified', async () => {
        const { db, cwd, fs } = await makeBindingEnv(
            { wbs: '0701', verdict: 'PASS', proof: { digest: 'sha256:abc', runId: 'run_probe' } },
            [
                { id: 'run_probe', status: 'running' },
                { id: 'run_other', status: 'done' },
            ],
        );
        const stat = await deriveVerifiedOutcome({ db, cwd, locator: stubLocator(cwd), fs }, {});
        expect(stat?.verifiedResults).toBe(0);
        expect(stat?.excludedReasons.certifyingRunFailed).toBe(1);
        db.close();
    });

    test('B.2: an unbound verdict keeps the permissive any-completed-run reading', async () => {
        const { db, cwd, fs } = await makeBindingEnv({ wbs: '0701', verdict: 'PASS', proofDigest: 'sha256:abc' }, [
            { id: 'run_probe', status: 'running' },
            { id: 'run_other', status: 'done' },
        ]);
        const stat = await deriveVerifiedOutcome({ db, cwd, locator: stubLocator(cwd), fs }, {});
        expect(stat?.verifiedResults).toBe(1);
        db.close();
    });
});
