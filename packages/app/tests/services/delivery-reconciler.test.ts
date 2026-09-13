import { beforeEach, describe, expect, test } from 'bun:test';
import { CoordinationRunDao, createMigratedDb, type DbAdapter, InboxMessageDao } from '@gobing-ai/spur-domain';
import { DeliveryReconciler, MAX_INJECT_ATTEMPTS, type ReconcileReport } from '../../src';

/**
 * 0834 — delivery reconciler: five-step classification precedence, idempotence,
 * and the late-receipt reclassification, over in-memory SQLite.
 */

let db: DbAdapter;
let inbox: InboxMessageDao;
let runs: CoordinationRunDao;
let reconciler: DeliveryReconciler;

async function seedQueued(): Promise<string> {
    return inbox.enqueue('operator', 'worker', 'do the work');
}

/** Move queued rows to `injected` exactly like a drain claim does. */
async function claim(): Promise<void> {
    await inbox.drainPending('worker');
}

/** Write a completion receipt for a run that lists `messageIds` (0833 shape). */
async function writeReceipt(
    runId: string,
    messageIds: string[],
    outcome: 'run-exit-only' | 'errored' | 'verified',
    artifactRefs: Array<{ kind: string; path: string }> = [],
    taskId?: string,
): Promise<void> {
    await runs.insertStart({
        specId: 'worker',
        agentKind: 'claude-code',
        processId: null,
        runId,
        generation: 1,
        startedAt: new Date().toISOString(),
    });
    await runs.updateExit(
        runId,
        outcome === 'errored' ? 'errored' : 'exited',
        new Date().toISOString(),
        JSON.stringify(artifactRefs),
        { messageIds, ...(taskId !== undefined ? { taskId } : {}), outcome },
    );
}

function reasons(report: ReconcileReport): Array<[string, string]> {
    return report.unresolved.map((u) => [u.messageId, u.reason] as [string, string]);
}

beforeEach(async () => {
    db = await createMigratedDb({ url: ':memory:' });
    inbox = new InboxMessageDao(db);
    runs = new CoordinationRunDao(db);
    reconciler = new DeliveryReconciler({ getDb: async () => db });
});

describe('0834 five-step classification precedence', () => {
    test('delivered run outcomes remain visible; only a verified receipt clears the hold', async () => {
        const id = await seedQueued();
        await claim();
        await inbox.markDelivered(id);
        await writeReceipt('delivered-run', [id], 'errored', [{ kind: 'log', path: '/tmp/failure.log' }], '0834');
        expect((await reconciler.classify('worker'))[0]).toMatchObject({
            messageId: id,
            reason: 'delivery-failed',
            runId: 'delivered-run',
            taskId: '0834',
            runStatus: 'errored',
        });
        await runs.updateExit('delivered-run', 'exited', new Date().toISOString(), '[]', {
            messageIds: [id],
            outcome: 'run-exit-only',
        });
        expect(reasons(await reconciler.reconcile('worker'))).toEqual([[id, 'run-exit-only']]);
        await runs.updateExit('delivered-run', 'exited', new Date().toISOString(), '[]', {
            messageIds: [id],
            outcome: 'verified',
        });
        expect(await reconciler.classify('worker')).toEqual([]);
        expect((await inbox.getById(id))?.status).toBe('delivered');
    });

    test('an interrupted run carries its durable origin and artifacts without claiming an exit', async () => {
        const id = await seedQueued();
        await claim();
        await runs.insertStart({
            specId: 'worker',
            agentKind: 'codex',
            processId: null,
            runId: 'interrupted',
            generation: 1,
            startedAt: new Date().toISOString(),
            messageIds: [id],
            taskId: '0834',
        });
        await db.run(
            'UPDATE coordination_runs SET artifact_refs_json = ? WHERE run_id = ?',
            JSON.stringify([{ kind: 'log', path: '/tmp/interrupted.log' }]),
            'interrupted',
        );
        const report = await reconciler.reconcile('worker');
        expect(report.unresolved[0]).toMatchObject({
            messageId: id,
            reason: 'outcome-unknown',
            runId: 'interrupted',
            taskId: '0834',
            runStatus: 'running',
            artifacts: [{ kind: 'log', path: '/tmp/interrupted.log' }],
        });
        expect(await reconciler.classify('worker')).toEqual(report.unresolved);
        expect((await inbox.getById(id))?.status).toBe('injected');
    });

    test('step 1: failed row → delivery-failed with its injectError', async () => {
        const id = await seedQueued();
        await claim();
        await inbox.markFailed(id, 'invocation never started');
        const report = await reconciler.reconcile('worker');
        expect(reasons(report)).toEqual([[id, 'delivery-failed']]);
        const held = report.unresolved[0];
        expect(held?.injectError).toBe('invocation never started');
        expect(held?.artifacts).toEqual([]);
        expect(report.exhausted).toEqual([]);
        expect(report.scanned).toBe(1);
    });

    test('step 2: injected with a run-exit-only receipt → run-exit-only with run correlation', async () => {
        const id = await seedQueued();
        await claim();
        await writeReceipt('run-1', [id], 'run-exit-only', [{ kind: 'result', path: '/tmp/r.json' }], 'task-9');
        const report = await reconciler.reconcile('worker');
        expect(reasons(report)).toEqual([[id, 'run-exit-only']]);
        const held = report.unresolved[0];
        expect(held?.runId).toBe('run-1');
        expect(held?.taskId).toBe('task-9');
        expect(held?.artifacts).toEqual([{ kind: 'result', path: '/tmp/r.json' }]);
    });

    test('step 2: injected with an errored receipt → delivery-failed (run correlation carried)', async () => {
        const id = await seedQueued();
        await claim();
        await writeReceipt('run-2', [id], 'errored', [{ kind: 'log', path: '/tmp/err.log' }]);
        const report = await reconciler.reconcile('worker');
        expect(reasons(report)).toEqual([[id, 'delivery-failed']]);
        expect(report.unresolved[0]?.runId).toBe('run-2');
        expect(report.unresolved[0]?.artifacts).toEqual([{ kind: 'log', path: '/tmp/err.log' }]);
    });

    test('step 2: injected with a verified receipt is a finished request — not held', async () => {
        const id = await seedQueued();
        await claim();
        await writeReceipt('run-3', [id], 'verified');
        const report = await reconciler.reconcile('worker');
        expect(report.unresolved).toEqual([]);
    });

    test('step 3: injected with no receipt → outcome-unknown, no artifacts inferred, no requeue', async () => {
        const id = await seedQueued();
        await claim();
        const report = await reconciler.reconcile('worker');
        expect(reasons(report)).toEqual([[id, 'outcome-unknown']]);
        expect(report.unresolved[0]?.artifacts).toEqual([]);
        expect(report.unresolved[0]?.runId).toBeUndefined();
        // Never touched: still injected, never requeued or released.
        expect((await inbox.getById(id))?.status).toBe('injected');
        expect(report.exhausted).toEqual([]);
    });

    test(`step 4: queued at MAX_INJECT_ATTEMPTS (${MAX_INJECT_ATTEMPTS}) → attempts-exhausted and marked failed (the only write)`, async () => {
        const id = await seedQueued();
        await db.run('UPDATE inbox_messages SET inject_attempts = ?1 WHERE id = ?2', MAX_INJECT_ATTEMPTS, id);
        const report = await reconciler.reconcile('worker');
        expect(reasons(report)).toEqual([[id, 'attempts-exhausted']]);
        expect(report.exhausted).toEqual([id]);
        const row = await inbox.getById(id);
        expect(row?.status).toBe('failed');
        expect(row?.injectError).toBe(`attempts exhausted after ${MAX_INJECT_ATTEMPTS} deliveries`);
    });

    test('step 5: queued under budget → omitted from the report', async () => {
        const id = await seedQueued();
        const report = await reconciler.reconcile('worker');
        expect(report.unresolved).toEqual([]);
        expect(report.exhausted).toEqual([]);
        expect(report.scanned).toBe(1);
        expect((await inbox.getById(id))?.status).toBe('queued');
    });

    test('delivered rows without a receipt remain outcome-unknown and are never replayed', async () => {
        const id = await seedQueued();
        await claim();
        await inbox.markDelivered(id);
        const report = await reconciler.reconcile('worker');
        expect(report.scanned).toBe(1);
        expect(reasons(report)).toEqual([[id, 'outcome-unknown']]);
        expect((await inbox.getById(id))?.status).toBe('delivered');
    });

    test('reconcile() with no agentId scans all recipients', async () => {
        const a = await inbox.enqueue('operator', 'agent-a', 'a');
        await inbox.enqueue('operator', 'agent-b', 'b');
        await inbox.drainPending('agent-a'); // a: injected no receipt; b: queued under budget
        const report = await reconciler.reconcile();
        expect(report.scanned).toBe(2);
        // b is queued below budget (step 5) — scanned, but not unresolved.
        expect(reasons(report)).toEqual([[a, 'outcome-unknown']]);
    });
});

describe('0834 idempotence and late receipts', () => {
    test('double reconcile: identical classification, exhausted empty on pass 2', async () => {
        const noReceipt = await seedQueued();
        await inbox.drainPending('worker'); // claims only this row → injected, no receipt
        const overBudget = await seedQueued(); // stays queued
        await db.run('UPDATE inbox_messages SET inject_attempts = ?1 WHERE id = ?2', MAX_INJECT_ATTEMPTS, overBudget);

        const pass1 = await reconciler.reconcile('worker');
        const pass2 = await reconciler.reconcile('worker');

        expect(pass1.exhausted).toEqual([overBudget]);
        expect(pass2.exhausted).toEqual([]);
        expect(pass2.unresolved).toEqual(pass1.unresolved);
        expect(new Set(pass2.unresolved.map((u) => u.messageId))).toEqual(
            new Set(pass1.unresolved.map((u) => u.messageId)),
        );
        expect(pass2.scanned).toBe(pass1.scanned);
        const pass2Reasons = new Map(reasons(pass2));
        expect(pass2Reasons.get(overBudget)).toBe('attempts-exhausted');
        expect(pass2Reasons.get(noReceipt)).toBe('outcome-unknown');
    });

    test('late receipt after a pass: outcome-unknown → run-exit-only, still never requeued', async () => {
        const id = await seedQueued();
        await claim();
        const pass1 = await reconciler.reconcile('worker');
        expect(reasons(pass1)).toEqual([[id, 'outcome-unknown']]);

        // The sink finally reports — the next pass reclassifies from the receipt.
        await writeReceipt('run-late', [id], 'run-exit-only');
        const pass2 = await reconciler.reconcile('worker');
        expect(reasons(pass2)).toEqual([[id, 'run-exit-only']]);
        expect(pass2.unresolved[0]?.runId).toBe('run-late');
        expect((await inbox.getById(id))?.status).toBe('injected');
    });
});

// ── 0838 carried advisory (0834 P3): multi-receipt tie-break — newest evidence wins ──
// A redelivered/consumed-twice message can be listed by >1 coordination_runs row;
// the reconciler takes [0] of listByMessageId (newest-start first). These tests pin
// that deterministic tie-break from the reconcile caller side.

describe('0838 advisory: multi-receipt tie-break (newest receipt decides)', () => {
    async function receiptAt(
        runId: string,
        messageIds: string[],
        outcome: 'run-exit-only' | 'errored' | 'verified',
        startedAt: string,
    ): Promise<void> {
        await runs.insertStart({
            specId: 'worker',
            agentKind: 'claude-code',
            processId: null,
            runId,
            generation: 1,
            startedAt,
        });
        await runs.updateExit(runId, outcome === 'errored' ? 'errored' : 'exited', startedAt, '[]', {
            messageIds,
            outcome,
        });
    }

    test('older errored receipt superseded by a newer verified one → finished, omitted (no hold)', async () => {
        const id = await seedQueued();
        await claim();
        await receiptAt('run-old', [id], 'errored', '2026-09-12T10:00:00.000Z');
        await receiptAt('run-new', [id], 'verified', '2026-09-12T11:00:00.000Z');
        const report = await reconciler.reconcile('worker');
        expect(report.unresolved).toEqual([]);
    });

    test('older verified receipt superseded by a newer errored one → delivery-failed (newest wins)', async () => {
        const id = await seedQueued();
        await claim();
        await receiptAt('run-old', [id], 'verified', '2026-09-12T10:00:00.000Z');
        await receiptAt('run-new', [id], 'errored', '2026-09-12T11:00:00.000Z');
        const report = await reconciler.reconcile('worker');
        expect(reasons(report)).toEqual([[id, 'delivery-failed']]);
        expect(report.unresolved[0]?.runId).toBe('run-new');
    });
});

// ── 0844: classify() — the pure pass ──

describe('0844 classify(): steps 1/2/3/5 without the step-4 write', () => {
    test('every terminal/injected case classifies identically to reconcile()', async () => {
        const failed = await seedQueued();
        await inbox.markFailed(failed, 'inject error');
        const exitOnly = await seedQueued();
        await writeReceipt('r-exit', [exitOnly], 'run-exit-only', [], 'T-1');
        const errored = await seedQueued();
        await writeReceipt('r-err', [errored], 'errored');
        const unknown = await seedQueued();
        await claim(); // consumed, no receipt
        const verified = await seedQueued();
        await writeReceipt('r-ver', [verified], 'verified');

        const classified = await reconciler.classify();
        const byId = new Map(classified.map((u) => [u.messageId, u.reason]));

        expect(byId.get(failed)).toBe('delivery-failed');
        expect(byId.get(exitOnly)).toBe('run-exit-only');
        expect(byId.get(errored)).toBe('delivery-failed');
        expect(byId.get(unknown)).toBe('outcome-unknown');
        expect(byId.has(verified)).toBe(false); // finished request — not held
    });

    test('queued rows are omitted entirely — even at/over budget — and nothing is written', async () => {
        await seedQueued(); // under budget — steps 4/5's business either way
        const overBudget = await seedQueued();
        // Push one row to the budget boundary without the DAO's own drain:
        // reconcile() would mark it failed; classify() must not.
        await db.run(`UPDATE inbox_messages SET inject_attempts = ? WHERE id = ?`, [MAX_INJECT_ATTEMPTS, overBudget]);

        const classified = await reconciler.classify();
        expect(classified).toEqual([]);

        // The pure pass never wrote the step-4 marking.
        const row = (
            await db.queryAll<{ status: string }>(`SELECT status FROM inbox_messages WHERE id = ?`, [overBudget])
        )[0];
        expect(row?.status).toBe('queued');

        // The report path, by contrast, marks it.
        const report = await reconciler.reconcile();
        expect(report.exhausted).toContain(overBudget);
    });
});
