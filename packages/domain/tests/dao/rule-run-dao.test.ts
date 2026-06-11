import { beforeEach, describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { RULE_ENGINE_SCHEMA_SQL } from '@gobing-ai/ts-rule-engine';
import { RuleEvalRunDao, RuleRunDao } from '../../src/dao/rule-run-dao';

async function freshDb(): Promise<DbAdapter> {
    const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    // Apply schema with split-statements for bun-sqlite adapter
    for (const stmt of RULE_ENGINE_SCHEMA_SQL.split(';')) {
        const trimmed = stmt.trim();
        if (trimmed.length > 0) await db.exec(`${trimmed};`);
    }
    return db;
}

describe('RuleRunDao', () => {
    let db: DbAdapter;
    let dao: RuleRunDao;

    beforeEach(async () => {
        db = await freshDb();
        dao = new RuleRunDao(db);
    });

    test('list returns empty array for fresh DB', async () => {
        const runs = await dao.list({ limit: 20 });
        expect(runs).toEqual([]);
    });

    test('list returns rows sorted by started_at DESC', async () => {
        await db.run(
            `INSERT INTO rule_runs (id, source_kind, status, started_at, created_at, updated_at)
             VALUES (?, 'preset', 'done', ?, datetime('now'), datetime('now'))`,
            'run-1',
            '2026-01-01T00:00:00Z',
        );
        await db.run(
            `INSERT INTO rule_runs (id, source_kind, status, started_at, created_at, updated_at)
             VALUES (?, 'preset', 'done', ?, datetime('now'), datetime('now'))`,
            'run-2',
            '2026-02-01T00:00:00Z',
        );
        const runs = await dao.list({ limit: 20 });
        expect(runs).toHaveLength(2);
        expect(runs[0]?.id).toBe('run-2'); // newest first
    });

    test('list filters by preset', async () => {
        await db.run(
            `INSERT INTO rule_runs (id, preset, source_kind, status, started_at, created_at, updated_at)
             VALUES (?, ?, 'preset', 'done', datetime('now'), datetime('now'), datetime('now'))`,
            'run-a',
            'preset-x',
        );
        await db.run(
            `INSERT INTO rule_runs (id, preset, source_kind, status, started_at, created_at, updated_at)
             VALUES (?, ?, 'preset', 'done', datetime('now'), datetime('now'), datetime('now'))`,
            'run-b',
            'preset-y',
        );
        const runs = await dao.list({ preset: 'preset-x', limit: 20 });
        expect(runs).toHaveLength(1);
        expect(runs[0]?.id).toBe('run-a');
    });

    test('list filters by status', async () => {
        await db.run(
            `INSERT INTO rule_runs (id, source_kind, status, started_at, created_at, updated_at)
             VALUES (?, 'preset', 'done', datetime('now'), datetime('now'), datetime('now'))`,
            'done-run',
        );
        await db.run(
            `INSERT INTO rule_runs (id, source_kind, status, started_at, created_at, updated_at)
             VALUES (?, 'preset', 'failed', datetime('now'), datetime('now'), datetime('now'))`,
            'fail-run',
        );
        const runs = await dao.list({ status: 'failed', limit: 20 });
        expect(runs).toHaveLength(1);
        expect(runs[0]?.id).toBe('fail-run');
    });

    test('list filters by since', async () => {
        await db.run(
            `INSERT INTO rule_runs (id, source_kind, status, started_at, created_at, updated_at)
             VALUES (?, 'preset', 'done', ?, datetime('now'), datetime('now'))`,
            'old',
            '2026-01-01T00:00:00Z',
        );
        await db.run(
            `INSERT INTO rule_runs (id, source_kind, status, started_at, created_at, updated_at)
             VALUES (?, 'preset', 'done', ?, datetime('now'), datetime('now'))`,
            'new',
            '2026-06-01T00:00:00Z',
        );
        const runs = await dao.list({ since: '2026-03-01T00:00:00Z', limit: 20 });
        expect(runs).toHaveLength(1);
        expect(runs[0]?.id).toBe('new');
    });

    test('list respects limit', async () => {
        await db.run(
            `INSERT INTO rule_runs (id, source_kind, status, started_at, created_at, updated_at)
             VALUES (?, 'preset', 'done', datetime('now'), datetime('now'), datetime('now'))`,
            'r1',
        );
        await db.run(
            `INSERT INTO rule_runs (id, source_kind, status, started_at, created_at, updated_at)
             VALUES (?, 'preset', 'done', datetime('now'), datetime('now'), datetime('now'))`,
            'r2',
        );
        const runs = await dao.list({ limit: 1 });
        expect(runs).toHaveLength(1);
    });

    test('byId returns undefined for missing run', async () => {
        const run = await dao.byId('nonexistent');
        expect(run).toBeUndefined();
    });

    test('byId returns run details', async () => {
        await db.run(
            `INSERT INTO rule_runs (id, preset, source_kind, status, rule_count, finding_count, started_at, created_at, updated_at)
             VALUES (?, ?, 'preset', 'done', 5, 3, datetime('now'), datetime('now'), datetime('now'))`,
            'detail-run',
            'my-preset',
        );
        const run = await dao.byId('detail-run');
        expect(run).toBeDefined();
        expect(run?.id).toBe('detail-run');
        expect(run?.preset).toBe('my-preset');
        expect(run?.rule_count).toBe(5);
        expect(run?.finding_count).toBe(3);
    });

    test('gracefully handles missing table', async () => {
        const db2 = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const dao2 = new RuleRunDao(db2);
        const runs = await dao2.list({ limit: 20 });
        expect(runs).toEqual([]);
        const run = await dao2.byId('x');
        expect(run).toBeUndefined();
    });
});

describe('RuleEvalRunDao', () => {
    let db: DbAdapter;
    let dao: RuleEvalRunDao;

    beforeEach(async () => {
        db = await freshDb();
        dao = new RuleEvalRunDao(db);
    });

    test('byRunId returns empty for fresh DB', async () => {
        const evals = await dao.byRunId('no-such-run');
        expect(evals).toEqual([]);
    });

    test('byRunId returns eval rows in started_at order', async () => {
        await db.run(
            `INSERT INTO rule_runs (id, source_kind, status, started_at, created_at, updated_at)
             VALUES ('run-1', 'preset', 'done', datetime('now'), datetime('now'), datetime('now'))`,
        );
        await db.run(
            `INSERT INTO rule_eval_runs (id, run_id, rule_id, severity, evaluator, status, started_at, created_at, updated_at)
             VALUES (?, ?, ?, 'error', 'rg', 'done', ?, datetime('now'), datetime('now'))`,
            'e1',
            'run-1',
            'rule-a',
            '2026-01-01T00:00:00Z',
        );
        await db.run(
            `INSERT INTO rule_eval_runs (id, run_id, rule_id, severity, evaluator, status, started_at, created_at, updated_at)
             VALUES (?, ?, ?, 'error', 'rg', 'done', ?, datetime('now'), datetime('now'))`,
            'e2',
            'run-1',
            'rule-b',
            '2026-01-01T00:00:01Z',
        );
        const evals = await dao.byRunId('run-1');
        expect(evals).toHaveLength(2);
        expect(evals[0]?.rule_id).toBe('rule-a');
        expect(evals[1]?.rule_id).toBe('rule-b');
    });

    test('gracefully handles missing table', async () => {
        const db2 = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const dao2 = new RuleEvalRunDao(db2);
        const evals = await dao2.byRunId('x');
        expect(evals).toEqual([]);
    });
});
