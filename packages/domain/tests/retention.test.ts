import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb, type DbAdapter } from '../src';
import { compactDatabase, runRetention } from '../src/retention';

/** Fixed "now" so cutoffs are deterministic. */
const NOW = new Date('2026-08-20T00:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

async function seedQueueJob(db: DbAdapter, type: string, status: string, updatedAgeDays: number): Promise<void> {
    const updatedMs = NOW.getTime() - updatedAgeDays * DAY_MS;
    await db.run(
        `INSERT INTO queue_jobs (type, status, payload, attempts, max_retries, next_retry_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        type,
        status,
        JSON.stringify({}),
        status === 'pending' ? 0 : 1,
        3,
        updatedMs,
        updatedMs,
        updatedMs,
    );
}

async function seedRuleEvalRun(db: DbAdapter, createdAgeDays: number, runId: string): Promise<void> {
    const ts = new Date(NOW.getTime() - createdAgeDays * DAY_MS).toISOString();
    await db.run(
        `INSERT INTO rule_runs (id, source_kind, status, started_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?)`,
        runId,
        'preset',
        'completed',
        ts,
        ts,
        ts,
    );
    await db.run(
        `INSERT INTO rule_eval_runs (id, run_id, rule_id, severity, evaluator, started_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        `${runId}-eval`,
        runId,
        'some-rule',
        'warn',
        'static',
        ts,
        ts,
        ts,
    );
}

async function seedLedger(db: DbAdapter, hash: string, importedAgeDays: number): Promise<void> {
    await db.run(
        `INSERT INTO history_import_ledger (record_hash, source, source_file, source_line, split_index, target_table, imported_at)
         VALUES (?,?,?,?,?,?,?)`,
        hash,
        'claude',
        'a.jsonl',
        1,
        0,
        'history_message',
        new Date(NOW.getTime() - importedAgeDays * DAY_MS).toISOString(),
    );
}

/** Make `.spur/backups/` with one fresh and one stale file. */
function seedBackups(cwd: string, freshAgeDays: number, staleAgeDays: number): { fresh: string; stale: string } {
    const dir = join(cwd, '.spur', 'backups');
    mkdirSync(dir, { recursive: true });
    const fresh = join(dir, 'spur.db.pre-0505-run.20260810-215454');
    const stale = join(dir, 'spur.db.pre-0505-run.20260101-000000');
    writeFileSync(fresh, 'x');
    writeFileSync(stale, 'x');
    const stamp = (path: string, ageDays: number) =>
        utimesSync(path, new Date(NOW.getTime() - ageDays * DAY_MS), new Date(NOW.getTime() - ageDays * DAY_MS));
    stamp(fresh, freshAgeDays);
    stamp(stale, staleAgeDays);
    return { fresh, stale };
}

describe('data retention (0622 R8)', () => {
    test('purges rule_eval_runs and ledger rows past their windows', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        await seedRuleEvalRun(db, 200, 'old'); // beyond 90d → purged
        await seedRuleEvalRun(db, 10, 'new'); // within window → KEPT
        await seedLedger(db, 'h-old', 400); // beyond 180d → purged
        await seedLedger(db, 'h-new', 100); // within window → KEPT

        const result = await runRetention(db, '/nonexistent-cwd', NOW);

        expect(result.ruleEvalRuns).toBe(1);
        expect(result.ledgerRows).toBe(1);
        const runs = await db.queryAll<{ run_id: string }>('SELECT run_id FROM rule_eval_runs');
        expect(runs.map((r) => r.run_id)).toEqual(['new']);
        const ledger = await db.queryAll<{ record_hash: string }>('SELECT record_hash FROM history_import_ledger');
        expect(ledger.map((r) => r.record_hash)).toEqual(['h-new']);
    });

    test('purges stale terminal queue jobs but never pending ones', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        await seedQueueJob(db, 'a', 'completed', 60); // stale + terminal → purged
        await seedQueueJob(db, 'b', 'failed', 60); // stale + terminal → purged
        await seedQueueJob(db, 'c', 'pending', 60); // stale but live work → KEPT
        await seedQueueJob(db, 'd', 'completed', 5); // terminal but fresh → KEPT

        const result = await runRetention(db, '/nonexistent-cwd', NOW);

        expect(result.queueJobs).toBe(2);
        const remaining = await db.queryAll<{ type: string; status: string }>('SELECT type, status FROM queue_jobs');
        expect(remaining.map((r) => r.type).sort()).toEqual(['c', 'd']);
    });

    test('prunes .spur/backups files by mtime, keeps fresh ones', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        const cwd = mkdtempSync(join(tmpdir(), 'spur-retention-'));
        const { fresh, stale } = seedBackups(cwd, 3, 90);

        const result = await runRetention(db, cwd, NOW);

        expect(result.backupFiles).toBe(1);
        expect(existsSync(fresh)).toBe(true);
        expect(existsSync(stale)).toBe(false);
    });

    test('ledger purge does not break re-import idempotence', async () => {
        // The safety property R8 rests on: a purged ledger row re-imports as a no-op
        // because target inserts are ON CONFLICT(record_hash) DO NOTHING. Simulate the
        // sequence purge → re-insert with the same hash.
        const db = await createMigratedDb({ url: ':memory:' });
        await seedLedger(db, 'dup-hash', 400);
        await runRetention(db, '/nonexistent-cwd', NOW);
        const gone = await db.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM history_import_ledger');
        expect(gone?.n).toBe(0);

        // Re-import path: plain INSERT of the same hash must succeed (row was purged)…
        await seedLedger(db, 'dup-hash', 0);
        // …and a defensive ON CONFLICT DO NOTHING insert must not throw either.
        await db.run(
            `INSERT INTO history_import_ledger (record_hash, source, source_file, source_line, split_index, target_table, imported_at)
             VALUES ('dup-hash', 'claude', 'a.jsonl', 2, 0, 'history_message', '2026-08-20T00:00:00Z')
             ON CONFLICT(record_hash) DO NOTHING`,
        );
        const after = await db.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM history_import_ledger');
        expect(after?.n).toBe(1);
    });

    test('a SQL failure is swallowed, not thrown (best-effort contract)', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        await db.exec('DROP TABLE rule_eval_runs');
        const result = await runRetention(db, '/nonexistent-cwd', NOW);
        expect(result.ruleEvalRuns).toBe(0);
        expect(result.queueJobs).toBe(0); // queue_jobs also absent in this bare DB
    });

    test('a fresh database purges nothing and reports zero counts', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        const result = await runRetention(db, '/nonexistent-cwd', NOW);
        // The four backups/rows purges reclaim nothing on a fresh DB.
        expect(result.ruleEvalRuns).toBe(0);
        expect(result.queueJobs).toBe(0);
        expect(result.ledgerRows).toBe(0);
        expect(result.backupFiles).toBe(0);
        // Compaction may run or skip — dbstat availability AND the fresh-db reclaim
        // ratio decide (0836's project_claims table pushed a fresh DB over the
        // COMPACTION_MIN_RECLAIM_RATIO VACUUM threshold, so the skip is no longer
        // guaranteed). The contract: it never crashes the pass and never GROWS the file.
        expect(typeof result.compaction.ran).toBe('boolean');
        expect(result.compaction.bytesAfter).toBeLessThanOrEqual(result.compaction.bytesBefore);
    });
});

describe('compactDatabase WAL checkpoint mode (task 0803 R2)', () => {
    test('compaction checkpoints PASSIVE — the periodic path never holds an exclusive checkpoint (TRUNCATE is maintain-only)', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        const execSql: string[] = [];
        const originalExec = db.exec.bind(db);
        db.exec = async (sql: string) => {
            execSql.push(sql);
            return originalExec(sql);
        };
        try {
            const result = await compactDatabase(db, {
                dbPath: join(tmpdir(), `spur-0803-passive-${Date.now()}.db`),
                now: NOW,
                estimateReclaim: async () => 10_000_000,
            });
            expect(result.ran).toBe(true);
            expect(execSql).toContain('PRAGMA wal_checkpoint(PASSIVE)');
            expect(execSql.some((sql) => sql.includes('TRUNCATE'))).toBe(false);
        } finally {
            await db.close();
        }
    });
});

/**
 * 1258 — the existing expiry policy executed in bounded batches. One pass used to delete a store's
 * entire expired backlog in a single write transaction; each store now removes at most 1000 rows
 * per invocation and the next daily pass continues from committed state (no cursor to repair).
 */
describe('bounded retention batches (1258)', () => {
    test('a backlog above the cap drains across repeatable passes with accurate per-store counts', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        const expired = 1001;
        for (let i = 0; i < expired; i++) await seedRuleEvalRun(db, 200, `bulk-${i}`);
        await seedRuleEvalRun(db, 10, 'fresh'); // inside the window → never eligible
        await seedQueueJob(db, 'scheduler.custom', 'completed', 90); // eligible
        await seedQueueJob(db, 'scheduler.custom', 'pending', 90); // live → protected
        await seedLedger(db, 'ledger-old', 400);
        await seedLedger(db, 'ledger-fresh', 10); // inside the window → kept
        for (let i = 0; i < expired; i++) await seedLedger(db, `ledger-bulk-${i}`, 400);

        const first = await runRetention(db, '/nonexistent-cwd', NOW);
        expect(first.ruleEvalRuns).toBe(1000);
        expect(first.ledgerRows).toBe(1000);
        expect(first.queueJobs).toBe(1);

        // Committed state carries the progress: the second pass takes the remainder (+ the sentinel).
        const second = await runRetention(db, '/nonexistent-cwd', NOW);
        expect(second.ruleEvalRuns).toBe(1); // the 1001st expired eval run
        expect(second.ledgerRows).toBe(2); // ledger-old + ledger-bulk-1000
        expect(second.queueJobs).toBe(0);

        const third = await runRetention(db, '/nonexistent-cwd', NOW);
        expect(third.ruleEvalRuns).toBe(0);
        expect(third.ledgerRows).toBe(0);

        // Protected rows survive every pass: inside-window rows and the non-terminal job.
        const keptRuns = await db.queryAll<{ run_id: string }>('SELECT run_id FROM rule_eval_runs');
        expect(keptRuns.map((row) => row.run_id)).toEqual(['fresh']);
        const keptLedger = await db.queryAll<{ record_hash: string }>('SELECT record_hash FROM history_import_ledger');
        expect(keptLedger.map((row) => row.record_hash)).toEqual(['ledger-fresh']);
        const keptJobs = await db.queryAll<{ status: string }>('SELECT status FROM queue_jobs');
        expect(keptJobs.map((row) => row.status)).toEqual(['pending']);
    }, 30000);

    test('cutoff rows stay intact while eligible rows satisfy the cap exactly', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        // Boundary: the predicate is `< cutoff`, so a row exactly at the cutoff is NOT eligible.
        await seedRuleEvalRun(db, 90, 'at-cutoff');
        await seedRuleEvalRun(db, 90.5, 'just-past');

        const result = await runRetention(db, '/nonexistent-cwd', NOW);

        expect(result.ruleEvalRuns).toBe(1);
        const kept = await db.queryAll<{ run_id: string }>('SELECT run_id FROM rule_eval_runs');
        expect(kept.map((row) => row.run_id)).toEqual(['at-cutoff']);
    }, 30000);

    test('an empty store reports zero without disturbing the other stores', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        await seedLedger(db, 'only-ledger', 400);
        const result = await runRetention(db, '/nonexistent-cwd', NOW);
        expect(result.ruleEvalRuns).toBe(0);
        expect(result.queueJobs).toBe(0);
        expect(result.ledgerRows).toBe(1);
    }, 30000);

    test('one failing store stays best-effort and does not skip the others', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        await seedRuleEvalRun(db, 200, 'doomed');
        await seedLedger(db, 'ledger-doomed', 400);
        // Break only the queue store's selection: the other two must still run.
        await db.exec('DROP TABLE queue_jobs');

        const result = await runRetention(db, '/nonexistent-cwd', NOW);

        expect(result.queueJobs).toBe(0);
        expect(result.ruleEvalRuns).toBe(1);
        expect(result.ledgerRows).toBe(1);
    }, 30000);
});
