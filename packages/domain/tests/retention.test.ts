import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb, type DbAdapter } from '../src';
import { runRetention } from '../src/retention';

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
        expect(result).toEqual({ ruleEvalRuns: 0, queueJobs: 0, ledgerRows: 0, backupFiles: 0 });
    });
});
