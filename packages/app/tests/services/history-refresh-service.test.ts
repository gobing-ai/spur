import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpurConfig } from '@gobing-ai/spur-config';
import { createMigratedDb, type DbAdapter } from '@gobing-ai/spur-domain';
import type { Job } from '@gobing-ai/ts-infra';
import { NodeProcessExecutor, type ProcessExecutor, type ProcessResult } from '@gobing-ai/ts-runtime';
import {
    enqueueHistoryRefresh,
    HISTORY_REFRESH_CONTEXT_ENV,
    HISTORY_REFRESH_JOB,
    type HistoryRefreshEnqueueResult,
    handleHistoryRefreshJob,
    parseHistoryRefreshContext,
} from '../../src/services/history-refresh-service';

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

/** Full queue job wrapping a payload — the handler's input shape. */
function jobOf(payload: unknown): Job<unknown> {
    return {
        id: 'job-1',
        type: HISTORY_REFRESH_JOB,
        payload,
        status: 'processing',
        attempts: 1,
        maxRetries: 3,
        createdAt: 1,
        updatedAt: 1,
        nextRetryAt: null,
        lastError: null,
        processingAt: 1,
    };
}

/** Process options the fake executor recorded. */
interface RecordedRun {
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
    maxOutput?: number;
}

/** Capturing fake at the ProcessExecutor seam; `result` is merged over a successful default. */
function fakeExecutor(result: Partial<ProcessResult> | Error): { executor: ProcessExecutor; runs: RecordedRun[] } {
    const runs: RecordedRun[] = [];
    const executor = {
        run: async (options: RecordedRun) => {
            runs.push(options);
            if (result instanceof Error) throw result;
            return {
                command: options.command,
                args: options.args ?? [],
                exitCode: 0,
                stdout: '',
                stderr: '',
                durationMs: 1,
                ...result,
            };
        },
    } as unknown as ProcessExecutor;
    return { executor, runs };
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
            let last: HistoryRefreshEnqueueResult | undefined;
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

describe('parseHistoryRefreshContext (task 0717 plan step 1)', () => {
    test('absent or empty env leaves interactive daily unchanged (null)', () => {
        expect(parseHistoryRefreshContext(undefined)).toBeNull();
        expect(parseHistoryRefreshContext('')).toBeNull();
    });

    test('valid context round-trips', () => {
        expect(
            parseHistoryRefreshContext(
                JSON.stringify({
                    trigger: 'manual',
                    triggerId: null,
                    windowStart: 5,
                    windowEnd: 6,
                    importMode: 'full',
                }),
            ),
        ).toEqual({ trigger: 'manual', triggerId: null, windowStart: 5, windowEnd: 6, importMode: 'full' });
    });

    test('malformed JSON fails before any import runs', () => {
        expect(() => parseHistoryRefreshContext('{nope')).toThrow('SPUR_HISTORY_REFRESH_CONTEXT is not valid JSON');
    });

    test('wrong shape fails loudly (bad trigger / non-object / bad window)', () => {
        expect(() => parseHistoryRefreshContext(JSON.stringify({ trigger: 'nope' }))).toThrow('invalid trigger');
        expect(() => parseHistoryRefreshContext(JSON.stringify([1]))).toThrow('must be a JSON object');
        expect(() =>
            parseHistoryRefreshContext(
                JSON.stringify({ trigger: 'manual', triggerId: null, windowStart: 'x', windowEnd: 1 }),
            ),
        ).toThrow('windowStart');
    });
});

describe('handleHistoryRefreshJob (task 0717: isolated child process)', () => {
    const validPayload = { trigger: 'task-done', triggerId: '0549', windowStart: 1, windowEnd: 2 };

    test('R2/R3: splits the invocation, runs history daily --json --json-envelope in cwd, passes payload as child context', async () => {
        const { executor, runs } = fakeExecutor({
            stdout: JSON.stringify({ ok: true, data: { fanOut: { exitCode: 0 } } }),
        });
        await handleHistoryRefreshJob(
            { cwd: '/proj', invocation: 'bun run /x/spur.ts', executor },
            jobOf({ ...validPayload, importMode: 'full' }),
        );
        expect(runs).toHaveLength(1);
        const run = runs[0] as RecordedRun;
        expect(run.command).toBe('bun');
        expect(run.args).toEqual(['run', '/x/spur.ts', 'history', 'daily', '--json', '--json-envelope']);
        expect(run.cwd).toBe('/proj');
        expect(run.maxOutput).toBe(1_000_000); // output bounded before queue completion
        expect(JSON.parse(run.env?.[HISTORY_REFRESH_CONTEXT_ENV] ?? 'null')).toEqual({
            trigger: 'task-done',
            triggerId: '0549',
            windowStart: 1,
            windowEnd: 2,
            importMode: 'full',
        });
    });

    test('R3: queue-envelope drift (whole job as payload) fails the attempt instead of silently defaulting', async () => {
        const { executor, runs } = fakeExecutor({});
        const envelope = jobOf(validPayload);
        await expect(
            handleHistoryRefreshJob({ cwd: '/p', invocation: 'bun', executor }, jobOf(envelope)),
        ).rejects.toThrow('history refresh payload has invalid trigger');
        expect(runs).toHaveLength(0); // nothing spawned
    });

    test('R2: an unusable invocation rejects before spawning', async () => {
        const { executor, runs } = fakeExecutor({});
        await expect(
            handleHistoryRefreshJob({ cwd: '/p', invocation: '  ', executor }, jobOf(validPayload)),
        ).rejects.toThrow('invocation');
        expect(runs).toHaveLength(0);
    });

    test('R4: spawn failure (exitCode null) rejects so the queue records a failed attempt', async () => {
        const { executor } = fakeExecutor({ exitCode: null, stderr: 'spawn ENOENT' });
        await expect(
            handleHistoryRefreshJob({ cwd: '/p', invocation: 'bun', executor }, jobOf(validPayload)),
        ).rejects.toThrow('history refresh child failed to spawn: spawn ENOENT');
    });

    test('R4: non-zero exit rejects with a bounded stderr tail', async () => {
        const { executor } = fakeExecutor({ exitCode: 2, stderr: 'e'.repeat(500) });
        let message = '';
        try {
            await handleHistoryRefreshJob({ cwd: '/p', invocation: 'bun', executor }, jobOf(validPayload));
        } catch (e) {
            message = (e as Error).message;
        }
        expect(message.startsWith('history daily exited 2: ')).toBe(true);
        // 1 ellipsis + at most 400 tail chars after the prefix: bounded detail for queue events.
        expect(message.length).toBeLessThanOrEqual('history daily exited 2: '.length + 401);
    });

    test('R4: unparseable child stdout rejects', async () => {
        const { executor } = fakeExecutor({ exitCode: 0, stdout: '<html>proxy error</html>' });
        await expect(
            handleHistoryRefreshJob({ cwd: '/p', invocation: 'bun', executor }, jobOf(validPayload)),
        ).rejects.toThrow('history daily emitted invalid JSON');
    });

    test('R4: child JSON without {ok:true,data} rejects', async () => {
        const { executor } = fakeExecutor({ exitCode: 0, stdout: JSON.stringify({ ok: false }) });
        await expect(
            handleHistoryRefreshJob({ cwd: '/p', invocation: 'bun', executor }, jobOf(validPayload)),
        ).rejects.toThrow('unexpected JSON shape');
    });

    test('R1: a held-open child leaves the server event loop responsive', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0717-'));
        try {
            const script = join(dir, 'slow-child.js');
            await Bun.write(script, 'await Bun.sleep(400);\nconsole.log(JSON.stringify({ ok: true, data: {} }));\n');
            const executor = new NodeProcessExecutor();
            const pending = handleHistoryRefreshJob(
                { cwd: dir, invocation: `${process.execPath} ${script}`, executor },
                jobOf(validPayload),
            );
            // Deliberate real-clock exception: asserting the shared event loop stays responsive
            // while the child runs requires the actual clock; fake timers would prove nothing.
            // The child sleeps ~400ms; while it runs, timed probes must tick on schedule.
            const probes: number[] = [];
            for (let i = 0; i < 5; i++) {
                const t0 = performance.now();
                await Bun.sleep(10);
                probes.push(performance.now() - t0);
            }
            await expect(pending).resolves.toBeUndefined();
            // If the handler had blocked the loop, 10ms sleeps would overshoot badly.
            expect(Math.max(...probes)).toBeLessThan(150);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
