import { describe, expect, test } from 'bun:test';
import type { SpurConfig } from '@gobing-ai/spur-config';
import { createMigratedDb, type DbAdapter } from '@gobing-ai/spur-domain';
import {
    enqueueHistoryRefresh,
    HISTORY_REFRESH_JOB,
    handleHistoryRefreshJob,
} from '../../src/services/history-refresh-service';
import type { DailyResult, HistoryService } from '../../src/services/history-service';
import type { SystemEventBus } from '../../src/services/system-event-tap';

/** Config fixture — only `history.refresh` matters to the trigger. */
function config(onCompletion: boolean, debounceMs = 60_000): SpurConfig {
    return { history: { refresh: { on_completion: onCompletion, debounce_ms: debounceMs } } } as unknown as SpurConfig;
}

interface QueueRow {
    id: string;
    type: string;
    payload: string;
    status: string;
    next_retry_at: number | null;
}

async function refreshRows(db: DbAdapter): Promise<QueueRow[]> {
    return db.queryAll<QueueRow>(
        `SELECT id, type, payload, status, next_retry_at FROM queue_jobs WHERE type = '${HISTORY_REFRESH_JOB}'`,
    );
}

/** Capturing fake for the SystemEventBus seam. */
type Emitted = { name: string; payload: Record<string, unknown> };
function fakeBus(): { bus: SystemEventBus; emitted: Emitted[] } {
    const emitted: Emitted[] = [];
    const bus = {
        emit: async (name: string, payload: Record<string, unknown>) => {
            emitted.push({ name, payload });
        },
    } as unknown as SystemEventBus;
    return { bus, emitted };
}

describe('enqueueHistoryRefresh (task 0549 R1–R4)', () => {
    test('disabled config short-circuits: no job row (R3)', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const result = await enqueueHistoryRefresh(db, { config: config(false), trigger: 'task-done' });
            expect(result).toEqual({ status: 'disabled' });
            expect((await refreshRows(db)).length).toBe(0);
        } finally {
            db.close();
        }
    });

    test('first completion enqueues one delayed job (R1: enqueue, never inline)', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const t0 = 1_000_000;
            const result = await enqueueHistoryRefresh(db, {
                config: config(true, 60_000),
                trigger: 'task-done',
                triggerId: '0549',
                now: () => t0,
            });
            expect(result.status).toBe('enqueued');
            const rows = await refreshRows(db);
            expect(rows.length).toBe(1);
            expect(rows[0]?.status).toBe('pending');
            expect(rows[0]?.next_retry_at).toBe(t0 + 60_000);
            expect(JSON.parse(rows[0]?.payload ?? '{}')).toMatchObject({ trigger: 'task-done', triggerId: '0549' });
        } finally {
            db.close();
        }
    });

    test('a burst of 5 completions coalesces into exactly one job whose window spans all (R2)', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const t0 = 1_000_000;
            const times = [t0, t0 + 10_000, t0 + 20_000, t0 + 30_000, t0 + 40_000];
            let last: Awaited<ReturnType<typeof enqueueHistoryRefresh>> | undefined;
            for (const t of times) {
                last = await enqueueHistoryRefresh(db, {
                    config: config(true, 600_000),
                    trigger: 'pipeline-run',
                    triggerId: `run-${t}`,
                    now: () => t,
                });
            }
            expect(last?.status).toBe('coalesced');
            // P3: the returned payload carries the merged burst window (earliest start,
            // latest end), not just the final completion's [now, now].
            const joined = last !== undefined && last.status !== 'disabled' ? last.payload : undefined;
            expect(joined).toMatchObject({ windowStart: t0, windowEnd: t0 + 40_000 });
            const rows = await refreshRows(db);
            expect(rows.length).toBe(1); // exactly one refresh for the whole burst
            const payload = JSON.parse(rows[0]?.payload ?? '{}') as { windowStart: number; windowEnd: number };
            expect(payload.windowStart).toBe(t0); // earliest completion
            expect(payload.windowEnd).toBe(t0 + 40_000); // latest completion
            expect(rows[0]?.next_retry_at).toBe(t0 + 40_000 + 600_000); // debounce from last join (R4 window)
        } finally {
            db.close();
        }
    });
});

describe('handleHistoryRefreshJob (task 0549 R3/R5)', () => {
    function dailyResult(exitCode: 0 | 1 | 2, statuses: Array<'ok' | 'failed'>): DailyResult {
        return {
            fanOut: {
                entries: statuses.map((status, i) => ({
                    source: `src-${i}`,
                    status,
                    files: status === 'ok' ? 3 : 0,
                    messages: status === 'ok' ? 30 : 0,
                })),
                exitCode,
                warnings: [],
            },
            artifact: { totals: { messages: 30, sessions: 3 } } as unknown as DailyResult['artifact'],
            pruned: [],
        } as unknown as DailyResult;
    }

    /** HistoryService stub via the handler's `service` test seam. */
    function stubService(result: DailyResult | Error): {
        service: Pick<HistoryService, 'daily'>;
        state: { calls: number };
    } {
        const state = { calls: 0 };
        const service = {
            daily: async () => {
                state.calls += 1;
                if (result instanceof Error) throw result;
                return result;
            },
        };
        return { service, state };
    }

    const payload = { trigger: 'task-done' as const, triggerId: '0549', windowStart: 1, windowEnd: 2 };

    test('success reuses daily and emits import/analyze completed with the coalesced window', async () => {
        const { service, state } = stubService(dailyResult(0, ['ok', 'ok']));
        const { bus, emitted } = fakeBus();
        const getDb = async () => createMigratedDb({ url: ':memory:' });
        await handleHistoryRefreshJob({ getDb, cwd: '/tmp', bus, service }, payload);
        expect(state.calls).toBe(1); // R5: reuses svc.daily, per-source fan-out underneath
        const names = emitted.map((e) => e.name);
        expect(names).toContain('history.import.completed');
        expect(names).toContain('history.analyze.completed');
        const importEvent = emitted.find((e) => e.name === 'history.import.completed');
        expect(importEvent?.payload).toMatchObject({ sources: 2, okSources: 2, failedSources: 0, files: 6 });
        expect(importEvent?.payload).toMatchObject({ trigger: 'task-done', windowStart: 1, windowEnd: 2 });
    });

    test('degraded fan-out emits history.daily.failed and does NOT rethrow (per-source isolation, R5)', async () => {
        const { service, state } = stubService(dailyResult(2, ['ok', 'failed']));
        const { bus, emitted } = fakeBus();
        const getDb = async () => createMigratedDb({ url: ':memory:' });
        await expect(handleHistoryRefreshJob({ getDb, cwd: '/tmp', bus, service }, payload)).resolves.toBeUndefined();
        expect(state.calls).toBe(1);
        const failed = emitted.find((e) => e.name === 'history.daily.failed');
        expect(failed?.payload).toMatchObject({ failedSources: 1, okSources: 1, severity: 'error' });
        expect(String(failed?.payload.detail)).toContain('src-1: failed');
    });

    test('daily throwing emits and rethrows so the queue records the failure', async () => {
        const { service } = stubService(new Error('db gone'));
        const { bus, emitted } = fakeBus();
        const getDb = async () => createMigratedDb({ url: ':memory:' });
        await expect(handleHistoryRefreshJob({ getDb, cwd: '/tmp', bus, service }, payload)).rejects.toThrow('db gone');
        expect(emitted.map((e) => e.name)).toEqual(['history.daily.failed']);
    });
});
