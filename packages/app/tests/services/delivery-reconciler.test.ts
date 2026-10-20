import { beforeEach, describe, expect, test } from 'bun:test';
import { CoordinationRunDao, createMigratedDb, type DbAdapter } from '@gobing-ai/spur-domain';
import { DeliveryReconciler, InboxService, MAX_DELIVERY_ATTEMPTS, type ReconcileReport } from '../../src';

/**
 * 0834 — delivery reconciler: five-step classification precedence, idempotence,
 * and the late-receipt reclassification, over in-memory SQLite.
 */

let db: DbAdapter;
let inbox: InboxService;
let runs: CoordinationRunDao;
let reconciler: DeliveryReconciler;

/**
 * G11 R8: only `kind: 'request'` rows are unresolved work, so the fixtures are requests.
 * A chat row is asserted separately (it must never surface as a held delivery).
 */
async function seedQueued(): Promise<string> {
    const { message } = await inbox.send({ from: 'operator', to: 'worker', body: 'do the work', kind: 'request' });
    return message.id;
}

/** Claim queued rows exactly like a drain does (queued → claimed, attempts charged). */
async function claim(): Promise<void> {
    await inbox.claim('worker', 10);
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
    inbox = new InboxService({ getDb: async () => db });
    runs = new CoordinationRunDao(db);
    reconciler = new DeliveryReconciler({ getDb: async () => db });
});

describe('0834 five-step classification precedence', () => {
    test('delivered run outcomes remain visible; only a verified receipt clears the hold', async () => {
        const id = await seedQueued();
        await claim();
        await inbox.settle([id], 'accepted');
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
        expect((await inbox.get(id))?.status).toBe('delivered');
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
        expect((await inbox.get(id))?.status).toBe('claimed');
    });

    test('step 1: failed row → delivery-failed with its injectError', async () => {
        const id = await seedQueued();
        await claim();
        await inbox.settle([id], 'not-started', 'invocation never started');
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
        expect((await inbox.get(id))?.status).toBe('claimed');
        expect(report.exhausted).toEqual([]);
    });

    test('a queued row is never failed by reconcile — the sweep owns the attempt ceiling (G11 R4)', async () => {
        await seedQueued();
        // Burn the delivery budget through the service itself: claim (queued→claimed, attempts+1)
        // then release (claimed→queued). No raw SQL seam is needed to reach the ceiling.
        for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS; attempt += 1) {
            await inbox.claim('worker', 10);
            await inbox.release((await inbox.list('worker', 'in')).map((row) => row.id));
        }
        const id = (await inbox.list('worker', 'in'))[0]?.id ?? '';
        const report = await reconciler.reconcile('worker');
        // Nothing was claimed, so nothing is reconciled: the row is untouched and unheld.
        expect(report.unresolved).toEqual([]);
        expect(report.exhausted).toEqual([]);
        expect((await inbox.get(id))?.status).toBe('queued');
    });

    test('step 5: queued under budget → omitted from the report', async () => {
        const id = await seedQueued();
        const report = await reconciler.reconcile('worker');
        expect(report.unresolved).toEqual([]);
        expect(report.exhausted).toEqual([]);
        expect(report.scanned).toBe(1);
        expect((await inbox.get(id))?.status).toBe('queued');
    });

    test('delivered rows without a receipt remain outcome-unknown and are never replayed', async () => {
        const id = await seedQueued();
        await claim();
        await inbox.settle([id], 'accepted');
        const report = await reconciler.reconcile('worker');
        expect(report.scanned).toBe(1);
        expect(reasons(report)).toEqual([[id, 'outcome-unknown']]);
        expect((await inbox.get(id))?.status).toBe('delivered');
    });

    test('reconcile() with no agentId scans all recipients', async () => {
        const a = (await inbox.send({ from: 'operator', to: 'agent-a', body: 'a', kind: 'request' })).message.id;
        await inbox.send({ from: 'operator', to: 'agent-b', body: 'b', kind: 'request' });
        await inbox.claim('agent-a', 10); // a: claimed, no receipt; b: queued
        const report = await reconciler.reconcile();
        expect(report.scanned).toBe(2);
        expect(reasons(report)).toEqual([[a, 'outcome-unknown']]);
    });
});

describe('0834 idempotence and late receipts', () => {
    test('double reconcile: identical classification, exhausted empty on pass 2', async () => {
        const noReceipt = await seedQueued();
        await claim(); // claimed, no receipt
        await seedQueued(); // stays queued

        const pass1 = await reconciler.reconcile('worker');
        const pass2 = await reconciler.reconcile('worker');

        expect(pass1.exhausted).toEqual([]);
        expect(pass2.exhausted).toEqual([]);
        expect(pass2.unresolved).toEqual(pass1.unresolved);
        expect(pass2.scanned).toBe(pass1.scanned);
        expect(new Map(reasons(pass2)).get(noReceipt)).toBe('outcome-unknown');
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
        expect((await inbox.get(id))?.status).toBe('claimed');
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
        // Settlement is guarded on `claimed` (G11 R4), so the fixture claims first — exactly
        // what a drain does before a run refuses to start.
        await inbox.claim('worker', 10);
        await inbox.settle([failed], 'not-started', 'inject error');
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
        // Reach the budget boundary through the service: claim + release until the counter is spent.
        for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS; attempt += 1) {
            await inbox.claim('worker', 10);
            await inbox.release((await inbox.list('worker', 'in')).map((row) => row.id));
        }

        const classified = await reconciler.classify();
        expect(classified).toEqual([]);

        // The pure pass never wrote the step-4 marking.
        const row = (
            await db.queryAll<{ status: string }>(`SELECT status FROM inbox_messages WHERE id = ?`, [overBudget])
        )[0];
        expect(row?.status).toBe('queued');

        // G11 R4 moved the attempt ceiling to the sweep, which only touches EXPIRED CLAIMS.
        // reconcile() therefore leaves a queued row alone too — it classifies, it does not
        // condemn undelivered work (the sweeper's own test asserts the failure it does write).
        const report = await reconciler.reconcile();
        expect(report.exhausted).toEqual([]);
        expect(report.unresolved).toEqual([]);
    });
});
