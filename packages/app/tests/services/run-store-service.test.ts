import { describe, expect, test } from 'bun:test';
import { applyCliMigrations, createId, type DbAdapter, TaskRunLinkDao } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import {
    clampRunStoreLimit,
    decodeRunListCursor,
    encodeRunListCursor,
    RUN_STORE_LIST_DEFAULT_LIMIT,
    RUN_STORE_LIST_MAX_LIMIT,
    RunStoreBadCursorError,
    RunStoreNotFoundError,
    RunStoreService,
    summarizeActionResult,
} from '../../src/services/run-store-service';

async function setupDb(): Promise<DbAdapter> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    return adapter;
}

async function insertRun(
    db: DbAdapter,
    opts: {
        id: string;
        status?: string;
        agent?: string | null;
        workflow?: string;
        startedAt: string;
        completedAt?: string | null;
    },
): Promise<void> {
    await db.run(
        `INSERT INTO runs (id, workflow_name, mode, status, agent, started_at, completed_at, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 1, 1)`,
        opts.id,
        opts.workflow ?? 'task-pipeline',
        'state-machine',
        opts.status ?? 'done',
        opts.agent ?? null,
        opts.startedAt,
        opts.completedAt ?? null,
    );
}

describe('summarizeActionResult (R6)', () => {
    test('returns null for empty/missing json', () => {
        expect(summarizeActionResult(null)).toBeNull();
        expect(summarizeActionResult('')).toBeNull();
    });

    test('redacts secrets and sensitive keys', () => {
        const summary = summarizeActionResult(
            JSON.stringify({
                ok: true,
                prompt: 'do the thing',
                token: 'api_key=supersecretvalue',
                note: 'Bearer sk-live-abcdef123456',
            }),
        ) as Record<string, unknown>;
        expect(summary.ok).toBe(true);
        expect(summary.prompt).toBe('[redacted]');
        expect(String(summary.token)).toContain('[REDACTED]');
        expect(String(summary.note)).toContain('[REDACTED]');
        expect(JSON.stringify(summary)).not.toContain('supersecretvalue');
        expect(JSON.stringify(summary)).not.toContain('sk-live-abcdef123456');
    });

    test('unparseable json becomes a redacted snippet', () => {
        const summary = summarizeActionResult('not-json Bearer sk-live-xyz') as { summary: string };
        expect(summary.summary).toContain('[REDACTED]');
        expect(summary.summary).not.toContain('sk-live-xyz');
    });

    test('recurses into arrays and preserves primitives', () => {
        const summary = summarizeActionResult(
            JSON.stringify({
                count: 2,
                ok: false,
                nested: null,
                items: ['plain', 'token=secretvalue'],
            }),
        ) as Record<string, unknown>;
        expect(summary.count).toBe(2);
        expect(summary.ok).toBe(false);
        expect(summary.nested).toBeNull();
        const items = summary.items as string[];
        expect(items[0]).toBe('plain');
        expect(items[1]).toContain('[REDACTED]');
    });

    test('bounds long strings after redaction', () => {
        // Secret near the start so length-bound (prefix keep) still shows the redaction.
        const long = `token=supersecretvalue ${'plain-detail '.repeat(40)}`;
        const summary = summarizeActionResult(long) as { summary: string };
        expect(summary.summary.length).toBeLessThanOrEqual(257); // 256 + ellipsis
        expect(summary.summary.endsWith('…')).toBe(true);
        expect(summary.summary).toContain('[REDACTED]');
        expect(summary.summary).not.toContain('supersecretvalue');
    });
});

describe('clampRunStoreLimit', () => {
    test('defaults and clamps to the documented window', () => {
        expect(clampRunStoreLimit(undefined)).toBe(RUN_STORE_LIST_DEFAULT_LIMIT);
        expect(clampRunStoreLimit(0)).toBe(RUN_STORE_LIST_DEFAULT_LIMIT);
        expect(clampRunStoreLimit(Number.NaN)).toBe(RUN_STORE_LIST_DEFAULT_LIMIT);
        expect(clampRunStoreLimit(10)).toBe(10);
        expect(clampRunStoreLimit(9999)).toBe(RUN_STORE_LIST_MAX_LIMIT);
    });
});

describe('run list cursor helpers', () => {
    test('encode/decode round-trips', () => {
        const encoded = encodeRunListCursor('run_1', '2026-07-01T12:00:00.000Z');
        expect(decodeRunListCursor(encoded)).toEqual({
            id: 'run_1',
            startedAt: '2026-07-01T12:00:00.000Z',
        });
    });

    test('decode rejects garbage', () => {
        expect(() => decodeRunListCursor('!!!')).toThrow(RunStoreBadCursorError);
        expect(() => decodeRunListCursor(btoa('null'))).toThrow(RunStoreBadCursorError);
        expect(() => decodeRunListCursor('')).toThrow(RunStoreBadCursorError);
        expect(() => decodeRunListCursor(btoa(JSON.stringify({ id: 1, startedAt: 'x' })))).toThrow(
            RunStoreBadCursorError,
        );
        expect(() => decodeRunListCursor(btoa(JSON.stringify({ id: 'r', startedAt: '' })))).toThrow(
            RunStoreBadCursorError,
        );
    });
});

describe('RunStoreService', () => {
    test('list returns digest fields with status filter and paging (R1)', async () => {
        const db = await setupDb();
        await insertRun(db, {
            id: 'run_old',
            status: 'done',
            agent: 'omp',
            startedAt: '2026-07-01T10:00:00.000Z',
            completedAt: '2026-07-01T10:05:00.000Z',
        });
        await insertRun(db, {
            id: 'run_new',
            status: 'running',
            agent: 'pi',
            startedAt: '2026-07-01T12:00:00.000Z',
        });
        await insertRun(db, {
            id: 'run_mid',
            status: 'done',
            agent: 'claude',
            startedAt: '2026-07-01T11:00:00.000Z',
            completedAt: '2026-07-01T11:02:00.000Z',
        });

        const service = new RunStoreService({ getDb: async () => db });
        const page1 = await service.list({ limit: 2 });
        expect(page1.runs).toHaveLength(2);
        expect(page1.hasMore).toBe(true);
        expect(page1.nextCursor).toBeTruthy();
        expect(page1.runs[0]).toMatchObject({
            id: 'run_new',
            workflowName: 'task-pipeline',
            status: 'running',
            mode: 'state-machine',
            agent: 'pi',
            startedAt: '2026-07-01T12:00:00.000Z',
            completedAt: null,
        });

        const page2 = await service.list({ limit: 2, cursor: page1.nextCursor ?? undefined });
        expect(page2.runs.map((r) => r.id)).toEqual(['run_old']);
        expect(page2.hasMore).toBe(false);
        expect(page2.nextCursor).toBeNull();

        const filtered = await service.list({ status: 'running' });
        expect(filtered.runs.map((r) => r.id)).toEqual(['run_new']);

        db.close();
    });

    test('getDetail returns phases, transitions, redacted actions (R2)', async () => {
        const db = await setupDb();
        await insertRun(db, {
            id: 'run_detail',
            agent: 'omp',
            startedAt: '2026-07-01T10:00:00.000Z',
            completedAt: '2026-07-01T10:10:00.000Z',
        });
        await db.run(
            `INSERT INTO phase_runs (id, run_id, phase, status, started_at, completed_at, created_at, updated_at)
             VALUES ('ph1', 'run_detail', 'implement', 'done', '2026-07-01T10:00:00.000Z', '2026-07-01T10:05:00.000Z', 1, 1)`,
        );
        await db.run(
            `INSERT INTO transition_runs (id, run_id, from_state, to_state, status, trigger, created_at, updated_at)
             VALUES ('tr1', 'run_detail', 'todo', 'wip', 'done', 'start', 2, 2)`,
        );
        await db.run(
            `INSERT INTO action_runs (id, run_id, node, kind, status, duration_ms, ok, result_json, started_at, completed_at, created_at)
             VALUES ('act1', 'run_detail', 'implement', 'agent.run', 'done', 500, 1,
                     '{"ok":true,"prompt":"secret work","note":"Bearer sk-live-abcdef"}',
                     '2026-07-01T10:01:00.000Z', '2026-07-01T10:02:00.000Z', 3)`,
        );

        const service = new RunStoreService({ getDb: async () => db });
        const detail = await service.getDetail('run_detail');
        expect(detail.run.id).toBe('run_detail');
        expect(detail.phases).toEqual([
            {
                phase: 'implement',
                status: 'done',
                startedAt: '2026-07-01T10:00:00.000Z',
                completedAt: '2026-07-01T10:05:00.000Z',
            },
        ]);
        expect(detail.transitions).toEqual([{ from: 'todo', to: 'wip', trigger: 'start' }]);
        expect(detail.actions).toHaveLength(1);
        const action = detail.actions[0];
        expect(action).toMatchObject({
            id: 'act1',
            node: 'implement',
            kind: 'agent.run',
            status: 'done',
            durationMs: 500,
            ok: true,
        });
        const summary = action?.resultSummary as Record<string, unknown>;
        expect(summary.prompt).toBe('[redacted]');
        expect(JSON.stringify(summary)).not.toContain('sk-live-abcdef');

        db.close();
    });

    test('getDetail throws RunStoreNotFoundError for unknown id (R4)', async () => {
        const db = await setupDb();
        const service = new RunStoreService({ getDb: async () => db });
        try {
            await service.getDetail('run_missing');
            expect.unreachable('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(RunStoreNotFoundError);
            expect((err as RunStoreNotFoundError).code).toBe('RUN_NOT_FOUND');
            expect((err as RunStoreNotFoundError).runId).toBe('run_missing');
        }
        db.close();
    });

    test('listByWbs returns links with kind and empty list for unknown WBS (R3)', async () => {
        const db = await setupDb();
        await insertRun(db, {
            id: 'run_linked',
            agent: 'pi',
            startedAt: '2026-07-01T10:00:00.000Z',
            completedAt: '2026-07-01T10:01:00.000Z',
        });
        await new TaskRunLinkDao(db).insert({
            id: createId('trl'),
            wbs: '0373',
            run_id: 'run_linked',
            kind: 'pipeline',
            created_at: '2026-07-01T10:00:00.000Z',
        });
        // Orphan link: WBS points at a missing run → run digest is null, not an error.
        await new TaskRunLinkDao(db).insert({
            id: createId('trl'),
            wbs: '0373',
            run_id: 'run_gone',
            kind: 'pipeline',
            created_at: '2026-07-01T10:00:01.000Z',
        });

        const service = new RunStoreService({ getDb: async () => db });
        const found = await service.listByWbs('0373');
        expect(found.wbs).toBe('0373');
        expect(found.count).toBe(2);
        const linked = found.links.find((l) => l.runId === 'run_linked');
        const orphan = found.links.find((l) => l.runId === 'run_gone');
        expect(linked).toMatchObject({
            runId: 'run_linked',
            kind: 'pipeline',
            run: {
                id: 'run_linked',
                agent: 'pi',
                status: 'done',
            },
        });
        expect(orphan).toMatchObject({
            runId: 'run_gone',
            run: null,
        });

        const empty = await service.listByWbs('9999');
        expect(empty.links).toEqual([]);
        expect(empty.count).toBe(0);

        db.close();
    });

    test('getDetail maps ok=null and ok=0 action rows', async () => {
        const db = await setupDb();
        await insertRun(db, {
            id: 'run_ok',
            startedAt: '2026-07-01T10:00:00.000Z',
        });
        await db.run(
            `INSERT INTO action_runs (id, run_id, node, kind, status, duration_ms, ok, result_json, started_at, completed_at, created_at)
             VALUES
             ('act_null', 'run_ok', 'n1', 'agent.run', 'running', null, null, null, null, null, 1),
             ('act_fail', 'run_ok', 'n2', 'agent.run', 'failed', 10, 0, '{}', '2026-07-01T10:00:00.000Z', '2026-07-01T10:00:01.000Z', 2)`,
        );
        const service = new RunStoreService({ getDb: async () => db });
        const detail = await service.getDetail('run_ok');
        expect(detail.actions.find((a) => a.id === 'act_null')?.ok).toBeNull();
        expect(detail.actions.find((a) => a.id === 'act_fail')?.ok).toBe(false);
        expect(detail.actions.find((a) => a.id === 'act_null')?.resultSummary).toBeNull();
        db.close();
    });

    test('list rejects malformed cursor', async () => {
        const db = await setupDb();
        const service = new RunStoreService({ getDb: async () => db });
        expect(service.list({ cursor: 'not-valid' })).rejects.toThrow(RunStoreBadCursorError);
        db.close();
    });
});
