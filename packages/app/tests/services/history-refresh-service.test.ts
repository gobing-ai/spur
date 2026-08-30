import { describe, expect, test } from 'bun:test';
import type { SpurConfig } from '@gobing-ai/spur-config';
import { createMigratedDb, type DbAdapter } from '@gobing-ai/spur-domain';
import {
    enqueueHistoryRefresh,
    HISTORY_REFRESH_JOB,
    handleHistoryRefreshJob,
} from '../../src/services/history-refresh-service';
import type { DailyOptions, DailyResult, HistoryService } from '../../src/services/history-service';
import type { SystemEventBus } from '../../src/services/system-event-tap';

/** Config fixture — only `history.refresh` matters to the trigger. */
function config(onCompletion: boolean, debounceMs = 60_000, scheduleMinutes: number | null = null): SpurConfig {
    return {
        history: {
            refresh: {
                on_completion: onCompletion,
                debounce_ms: debounceMs,
                ...(scheduleMinutes !== null ? { schedule_minutes: scheduleMinutes } : {}),
            },
        },
    } as unknown as SpurConfig;
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

describe('enqueueHistoryRefresh single-flight producers (task 0716)', () => {
    test('manual trigger bypasses config gating and is due immediately', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const t0 = 1_000_000;
            const result = await enqueueHistoryRefresh(db, {
                config: config(false),
                trigger: 'manual',
                importMode: 'full',
                now: () => t0,
            });
            expect(result.status).toBe('enqueued');
            const rows = await refreshRows(db);
            expect(rows.length).toBe(1);
            expect(rows[0]?.next_retry_at).toBe(t0); // immediate: due now, not t0 + debounce
            expect(JSON.parse(rows[0]?.payload ?? '{}')).toMatchObject({ trigger: 'manual', importMode: 'full' });
        } finally {
            db.close();
        }
    });

    test('schedule trigger is gated on schedule_minutes (R3)', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const t0 = 1_000_000;
            const off = await enqueueHistoryRefresh(db, { config: config(true), trigger: 'schedule', now: () => t0 });
            expect(off).toEqual({ status: 'disabled' });
            expect((await refreshRows(db)).length).toBe(0);
            const on = await enqueueHistoryRefresh(db, {
                config: config(false, 60_000, 30),
                trigger: 'schedule',
                now: () => t0,
            });
            expect(on.status).toBe('enqueued');
            const rows = await refreshRows(db);
            expect(rows.length).toBe(1);
            expect(rows[0]?.next_retry_at).toBe(t0); // scheduled ticks are also immediate
        } finally {
            db.close();
        }
    });

    test('an in-flight import reports already-running instead of stacking a second job (R4)', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const t0 = 1_000_000;
            await db.run(
                `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at, next_retry_at)
                 VALUES ('job-live', '${HISTORY_REFRESH_JOB}', '{"trigger":"manual","triggerId":null,"windowStart":${t0},"windowEnd":${t0}}', 'processing', 1, 0, ${t0}, ${t0}, NULL)`,
            );
            const result = await enqueueHistoryRefresh(db, {
                config: config(false),
                trigger: 'manual',
                now: () => t0 + 5_000,
            });
            expect(result.status).toBe('already-running');
            if (result.status !== 'disabled') {
                expect(result.jobId).toBe('job-live');
                expect(result.payload).toMatchObject({ trigger: 'manual' });
            }
            expect((await refreshRows(db)).length).toBe(1); // nothing stacked behind the live job
        } finally {
            db.close();
        }
    });

    test('manual join merges importMode (full dominates) and never delays an earlier due time', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const t0 = 1_000_000;
            await enqueueHistoryRefresh(db, {
                config: config(true, 600_000),
                trigger: 'task-done',
                triggerId: '0716',
                importMode: 'incremental',
                now: () => t0,
            });
            const manual = await enqueueHistoryRefresh(db, {
                config: config(false),
                trigger: 'manual',
                importMode: 'full',
                now: () => t0 + 30_000,
            });
            expect(manual.status).toBe('coalesced');
            if (manual.status !== 'disabled') {
                expect(manual.payload).toMatchObject({ importMode: 'full', windowStart: t0, windowEnd: t0 + 30_000 });
            }
            const rows = await refreshRows(db);
            expect(rows.length).toBe(1);
            // Debounced pending row sat at t0 + 600k; the immediate manual join pulls due IN to now.
            expect(rows[0]?.next_retry_at).toBe(t0 + 30_000);
            expect(JSON.parse(rows[0]?.payload ?? '{}')).toMatchObject({ importMode: 'full' });
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
        state: { calls: number; options: DailyOptions[] };
    } {
        const state: { calls: number; options: DailyOptions[] } = { calls: 0, options: [] };
        const service = {
            daily: async (options: DailyOptions) => {
                state.calls += 1;
                state.options.push(options);
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
        expect(state.options).toEqual([{ cwd: '/tmp', importMode: 'incremental' }]);
    });

    test('manual refresh forwards the requested full import mode', async () => {
        const { service, state } = stubService(dailyResult(0, ['ok']));
        const { bus } = fakeBus();
        const getDb = async () => createMigratedDb({ url: ':memory:' });

        await handleHistoryRefreshJob(
            { getDb, cwd: '/tmp', bus, service },
            { trigger: 'manual', triggerId: null, windowStart: 1, windowEnd: 1, importMode: 'full' },
        );

        expect(state.options).toEqual([{ cwd: '/tmp', importMode: 'full' }]);
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
