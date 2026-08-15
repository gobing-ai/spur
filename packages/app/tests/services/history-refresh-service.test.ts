import { describe, expect, test } from 'bun:test';
import { createMigratedDb, type DbAdapter } from '@gobing-ai/spur-domain';
import {
    createHistoryRefreshService,
    enqueueHistoryRefreshSafe,
    HISTORY_REFRESH_JOB,
    HistoryRefreshService,
} from '../../src/services/history-refresh-service';
import { HistoryService } from '../../src/services/history-service';

async function memoryDb(): Promise<DbAdapter> {
    return createMigratedDb({ url: ':memory:' });
}

describe('HistoryRefreshService.enqueue', () => {
    test('does not enqueue when on_completion is off', async () => {
        const db = await memoryDb();
        const svc = new HistoryRefreshService({
            getDb: async () => db,
            cwd: '/tmp',
            getConfig: async () => ({ on_completion: false, debounce_ms: 60_000 }),
        });
        const result = await svc.enqueue({ trigger: 'task-done', at: '2026-08-14T12:00:00.000Z', wbs: '0548' });
        expect(result).toEqual({ enqueued: false, coalesced: false, reason: 'disabled' });
        const pending = await db.queryFirst<{ n: number }>(
            'SELECT COUNT(*) AS n FROM queue_jobs WHERE type = ?',
            HISTORY_REFRESH_JOB,
        );
        expect(pending?.n).toBe(0);
    });

    test('enqueues one job and coalesces a burst into the same pending row', async () => {
        const db = await memoryDb();
        const svc = new HistoryRefreshService({
            getDb: async () => db,
            cwd: '/tmp',
            getConfig: async () => ({ on_completion: true, debounce_ms: 15_000 }),
        });
        const first = await svc.enqueue({
            trigger: 'task-done',
            at: '2026-08-14T12:00:00.000Z',
            wbs: '0548',
        });
        const second = await svc.enqueue({
            trigger: 'pipeline-done',
            at: '2026-08-14T12:00:05.000Z',
            runId: 'wf:run-1',
        });
        expect(first.reason).toBe('enqueued');
        expect(second.reason).toBe('coalesced');
        expect(second.jobId).toBe(first.jobId);
        const rows = await db.queryAll<{ payload: string }>(
            "SELECT payload FROM queue_jobs WHERE type = ? AND status = 'pending'",
            HISTORY_REFRESH_JOB,
        );
        expect(rows).toHaveLength(1);
        const payload = JSON.parse(rows[0]?.payload ?? '{}') as {
            windowSince: string;
            windowUntil: string;
            events: unknown[];
        };
        expect(payload.windowSince).toBe('2026-08-14T12:00:00.000Z');
        expect(payload.windowUntil).toBe('2026-08-14T12:00:05.000Z');
        expect(payload.events).toHaveLength(2);
    });

    test('enqueueHistoryRefreshSafe swallows enqueue failures', async () => {
        const svc = createHistoryRefreshService({
            getDb: async () => {
                throw new Error('db down');
            },
            cwd: '/tmp',
            getConfig: async () => ({ on_completion: true, debounce_ms: 1 }),
        });
        await enqueueHistoryRefreshSafe(svc, { trigger: 'task-done', at: '2026-08-14T12:00:00.000Z' });
    });
});

describe('HistoryRefreshService.run', () => {
    test('runs daily over full-fidelity sources and reports skipped unsupported ones', async () => {
        const db = await memoryDb();
        const history = new HistoryService({ getDb: async () => db });
        const tmp = await import('node:os').then((os) =>
            import('node:fs').then((fs) => fs.mkdtempSync(`${os.tmpdir()}/e3-refresh-`)),
        );
        const svc = new HistoryRefreshService({
            getDb: async () => db,
            cwd: tmp,
            getConfig: async () => ({ on_completion: true, debounce_ms: 1 }),
        });
        const { refreshCoverage } = await svc.run(
            {
                windowSince: '2026-08-14T12:00:00.000Z',
                windowUntil: '2026-08-14T12:00:10.000Z',
                events: [{ trigger: 'task-done', at: '2026-08-14T12:00:00.000Z' }],
            },
            history,
            { root: tmp },
        );
        expect(refreshCoverage.refreshed).toEqual(['claude', 'codex', 'pi', 'omp', 'agy', 'grok']);
        expect(refreshCoverage.skipped).toEqual(['gemini', 'opencode', 'antigravity-ide', 'openclaw', 'hermes']);
        expect(refreshCoverage.window).toEqual({
            since: '2026-08-14T12:00:00.000Z',
            until: '2026-08-14T12:00:10.000Z',
        });
    });
});
