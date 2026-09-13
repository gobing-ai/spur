/**
 * G6 strategy prototype trace suite (task 0829) — table-driven event sequences
 * over the test-local fake controller in ../fixtures/g6/strategy-prototype.ts.
 *
 * Asserts the frozen behavioral contract (R2/R3). "Must FAIL on X" guarantees
 * are enforced in both directions: correct behavior produces no violation, and
 * the guard mechanics demonstrably trip when a violation is forced through the
 * `unsafeForceAssignment` hook. Test fixtures only; no production change.
 */
import { describe, expect, test } from 'bun:test';
import {
    type Assignment,
    compactState,
    type FakeInstance,
    G6StrategyPrototypeController,
    restoreController,
    runSequence,
    type SimEvent,
    type SpurRole,
} from '../fixtures/g6/strategy-prototype';

const P1 = '/demo/project-a';
const P2 = '/demo/project-b';
let n = 0;

function T(
    id: string,
    o: Partial<{
        wbs: string;
        priority: number;
        role: SpurRole;
        authorized: boolean;
        ready: boolean;
        dependsOn: string[];
        readOnly: boolean;
        projectPath: string;
    }> = {},
): SimEvent {
    return {
        kind: 'task',
        projectPath: o.projectPath ?? P1,
        task: {
            id,
            wbs: o.wbs ?? `1.${++n}`,
            priority: o.priority ?? 3,
            role: o.role ?? 'coder',
            authorized: o.authorized ?? true,
            ready: o.ready ?? true,
            dependsOn: o.dependsOn ?? [],
            readOnly: o.readOnly ?? false,
        },
    };
}
const req = (id: string, content = 'ship the thing', projectPath = P1): Extract<SimEvent, { kind: 'request' }> => ({
    kind: 'request',
    projectPath,
    requestId: id,
    messageId: `msg-${++n}`,
    content,
});
const I = (
    instanceId: string,
    o: Partial<{
        role: SpurRole;
        executor: string;
        enabled: boolean;
        capabilities: string[];
        purpose: 'orchestrator';
    }> = {},
): FakeInstance => ({
    instanceId,
    role: o.role ?? 'coder',
    executor: o.executor ?? 'claude-code',
    enabled: o.enabled ?? true,
    capabilities: o.capabilities ?? ['write'],
    purpose: o.purpose,
});
const res = (o: {
    attemptId: string;
    runId: string;
    generation: number;
    ownerEpoch: number;
    instanceId: string;
    taskId?: string;
    exitCode?: number;
    verified?: boolean;
    notification?: 'sent' | 'failed';
    projectPath?: string;
}): SimEvent => ({
    kind: 'result',
    projectPath: o.projectPath ?? P1,
    attemptId: o.attemptId,
    runId: o.runId,
    generation: o.generation,
    ownerEpoch: o.ownerEpoch,
    instanceId: o.instanceId,
    taskId: o.taskId,
    exitCode: o.exitCode ?? 0,
    verified: o.verified,
    notification: o.notification,
});
const rest = (): SimEvent => ({ kind: 'strategy', projectPath: P1, action: 'rest' });
const replace = (): SimEvent => ({ kind: 'strategy', projectPath: P1, action: 'replace' });
const tick = (): SimEvent => ({ kind: 'tick', projectPath: P1 });

function firstAssignment(c: G6StrategyPrototypeController, projectPath = P1): Assignment {
    const a = c.assignments(projectPath)[0];
    if (!a) throw new Error('missing assignment');
    return a;
}

function boot(): G6StrategyPrototypeController {
    const c = new G6StrategyPrototypeController();
    c.addInstance(P1, I('coder-1'));
    c.addInstance(P1, I('coder-2'));
    c.addInstance(P1, I('scribe-1', { role: 'scribe', executor: 'codex' }));
    c.addInstance(P1, I('planner-1', { role: 'planner', executor: 'claude-code', purpose: 'orchestrator' }));
    return c;
}

describe('G6 strategy prototype — frozen contract traces (0829)', () => {
    test('R1: plain dispatch carries full correlation; answers vs holds vs assignments', () => {
        const c = boot();
        runSequence(c, [T('t1'), T('t2', { priority: 2 }), req('r1')]);
        expect(c.assignments(P1)).toHaveLength(1);
        const a = firstAssignment(c);
        expect(a.instanceId).toBe('coder-1'); // priority 2 beats 3; stable tie-break → coder-1
        expect(a.taskId).toBe('t2');
        expect(a.requestId).toBe('r1');
        expect(a.runId).toBeTruthy();
        expect(a.attemptId).toBeTruthy();
        expect(a.generation).toBe(1);
        expect(a.ownerEpoch).toBe(1);
        expect(a.strategyVersion).toBe(1);
        expect(c.getProject(P1).writeSlot?.heldBy).toBe(a.attemptId);
        runSequence(c, [
            res({
                attemptId: a.attemptId,
                runId: a.runId,
                generation: 1,
                ownerEpoch: 1,
                instanceId: a.instanceId,
                taskId: 't2',
                verified: true,
            }),
        ]);
        expect(c.tasks(P1).get('t2')?.completed).toBe(true);
        expect(c.tasks(P1).get('t1')?.completed).toBe(false);
        expect(firstAssignment(c).taskId).toBe('t1'); // freed slot re-dispatches
    });

    test('R2/R3 duplicate input: idempotent replay, no second dispatch; changed content errors', () => {
        const c = boot();
        runSequence(c, [T('t1'), req('r1')]);
        const d0 = c.dispatchCount;
        runSequence(c, [req('r1')]);
        expect(c.dispatchCount).toBe(d0);
        expect(c.getProject(P1).requests.size).toBe(1);
        expect(() => runSequence(c, [{ ...req('r1'), content: 'different payload' }])).toThrow(
            /reused with different content/,
        );
        // per-project scope: same requestId in another project is independent
        runSequence(c, [req('r1', 'ship it', P2)]);
        expect(c.getProject(P2).requests.size).toBe(1);
    });

    test('R3: exact-instance assignment among duplicate roles; GTD order priority then WBS', () => {
        const c = boot();
        c.addInstance(P1, I('coder-0'));
        runSequence(c, [T('b', { wbs: '1.2' }), T('a', { wbs: '1.1' }), req('r1')]);
        expect(firstAssignment(c).taskId).toBe('a'); // same priority → WBS order
        expect(firstAssignment(c).instanceId).toBe('coder-0'); // stable tie-break
        const a = firstAssignment(c);
        runSequence(c, [
            res({
                attemptId: a.attemptId,
                runId: a.runId,
                generation: a.generation,
                ownerEpoch: a.ownerEpoch,
                instanceId: 'coder-0',
                taskId: 'a',
                verified: true,
            }),
        ]);
        expect(firstAssignment(c).taskId).toBe('b');
        expect(firstAssignment(c).instanceId).toBe('coder-0'); // stable instanceId tie-break reuses coder-0
    });

    test('R2: unmet dependency holds with actionable reason; verified completion unblocks it', () => {
        const c = boot();
        runSequence(c, [T('t1'), T('t2', { dependsOn: ['t1'], priority: 1 }), req('r1')]);
        expect(firstAssignment(c).taskId).toBe('t1'); // urgent-but-blocked t2 not picked
        const a = firstAssignment(c);
        runSequence(c, [
            res({
                attemptId: a.attemptId,
                runId: a.runId,
                generation: a.generation,
                ownerEpoch: a.ownerEpoch,
                instanceId: a.instanceId,
                taskId: 't1',
                verified: true,
            }),
        ]);
        expect(firstAssignment(c).taskId).toBe('t2');
        const c2 = boot();
        runSequence(c2, [T('solo', { dependsOn: ['never-added'] }), req('r2')]);
        expect(c2.assignments(P1)).toHaveLength(0);
        expect(c2.holds(P1).some((h) => h.reason === 'unmet-dependency' && h.detail === 'task solo')).toBe(true);
    });

    test('R2: authorization/readiness gates hold (never dispatch unauthorized or unready work)', () => {
        const c = boot();
        runSequence(c, [
            T('a', { authorized: false, priority: 1 }),
            T('b', { ready: false, priority: 2 }),
            T('c', { priority: 3 }),
            req('r1'),
        ]);
        expect(firstAssignment(c).taskId).toBe('c');
        expect(c.holds(P1).some((h) => h.reason === 'unauthorized')).toBe(true);
        expect(c.holds(P1).some((h) => h.reason === 'not-ready')).toBe(true);
        const c2 = boot();
        runSequence(c2, [T('a', { authorized: false, priority: 1 }), req('r1')]);
        expect(c2.assignments(P1)).toHaveLength(0);
    });

    test('R2: read-only requires explicit capability evidence, not a role-name assumption', () => {
        const c = new G6StrategyPrototypeController();
        c.addInstance(P1, I('coder-ro', { capabilities: ['write'] }));
        runSequence(c, [T('t-ro', { readOnly: true }), req('r1')]);
        expect(c.assignments(P1)).toHaveLength(0);
        expect(c.holds(P1).some((h) => h.reason === 'no-capable-idle-instance')).toBe(true);
        const c2 = new G6StrategyPrototypeController();
        c2.addInstance(P1, I('coder-ro', { capabilities: ['write', 'read-only'] }));
        runSequence(c2, [T('t-ro', { readOnly: true }), req('r1')]);
        expect(firstAssignment(c2).instanceId).toBe('coder-ro');
    });

    test('R2: disabled/unavailable executors are skipped; exhausted capacity holds', () => {
        const c = boot();
        c.process({ kind: 'capacity', projectPath: P1, instanceId: 'coder-1', enabled: false });
        c.process({ kind: 'capacity', projectPath: P1, instanceId: 'coder-2', enabled: false });
        runSequence(c, [T('t1', { role: 'coder' }), T('t2', { role: 'scribe' }), req('r1')]);
        expect(firstAssignment(c).taskId).toBe('t2'); // coder capacity exhausted → hold; scribe dispatches
        expect(c.holds(P1).some((h) => h.reason === 'no-idle-instance' && h.detail === 'role coder')).toBe(true);
        const scribe = firstAssignment(c);
        runSequence(c, [
            res({
                attemptId: scribe.attemptId,
                runId: scribe.runId,
                generation: scribe.generation,
                ownerEpoch: scribe.ownerEpoch,
                instanceId: 'scribe-1',
                taskId: 't2',
                verified: true,
            }),
        ]);
        runSequence(c, [{ kind: 'capacity', projectPath: P1, instanceId: 'coder-1', enabled: true }]);
        expect(firstAssignment(c).taskId).toBe('t1'); // capacity restore re-wakes
    });

    test('R3: idle ticks produce zero model calls and zero dispatches', () => {
        const c = boot();
        runSequence(c, [req('r1')]);
        const model0 = c.modelCalls;
        const d0 = c.dispatchCount;
        for (let i = 0; i < 5; i++) c.process(tick());
        expect(c.modelCalls).toBe(model0);
        expect(c.dispatchCount).toBe(d0);
        expect(c.assignments(P1)).toHaveLength(0);
        expect(c.holds(P1).some((h) => h.reason === 'idle')).toBe(true);
    });

    test('R2/R3: rest drains queued starts; the running assignment finishes and holds its slot to reconciliation', () => {
        const c = boot();
        runSequence(c, [T('t1'), T('t2'), T('t3'), req('r1')]);
        expect(c.assignments(P1).filter((a) => a.state === 'running')).toHaveLength(1);
        c.process(rest());
        expect(c.getProject(P1).strategyVersion).toBe(2);
        expect(c.assignments(P1)).toHaveLength(1); // running kept
        const dDuringRest = c.dispatchCount;
        runSequence(c, [T('t4'), req('r2')]); // wake during rest → zero future starts
        expect(c.dispatchCount).toBe(dDuringRest);
        const a = firstAssignment(c);
        runSequence(c, [
            res({
                attemptId: a.attemptId,
                runId: a.runId,
                generation: a.generation,
                ownerEpoch: a.ownerEpoch,
                instanceId: a.instanceId,
                taskId: a.taskId,
                verified: true,
            }),
        ]);
        expect(c.assignments(P1).filter((a) => a.state === 'running')).toHaveLength(0);
        expect(c.assignments(P1).filter((a) => a.state === 'queued')).toHaveLength(0);
        expect(c.getProject(P1).writeSlot).toBeNull();
        expect(c.holds(P1).some((h) => h.reason === 'rest-after-drain')).toBe(true);
    });

    test('R2: rest-vs-dispatch race — rest between select and claim voids the decision', () => {
        let rested = false;
        const c = new G6StrategyPrototypeController({
            interceptBetweenSelectAndClaim() {
                if (!rested) {
                    rested = true;
                    c.process(rest());
                }
            },
        });
        c.addInstance(P1, I('coder-1'));
        runSequence(c, [T('t1'), req('r1')]);
        expect(rested).toBe(true);
        expect(c.assignments(P1)).toHaveLength(0); // stale decision re-evaluated → no dispatch
        expect(c.getProject(P1).writeSlot).toBeNull();
        expect(c.getProject(P1).strategyVersion).toBe(2);
    });

    test('R2: restart with persisted strategy — snapshot reload recovers state and unfinished work', () => {
        const c = boot();
        runSequence(c, [T('t1'), T('t2', { priority: 4 }), req('r1')]);
        c.process(rest());
        const snap = c.snapshot();
        const c2 = restoreController(snap);
        expect(compactState(c2.getProject(P1))).toBe(compactState(c.getProject(P1)));
        expect(c2.getProject(P1).resting).toBe(true);
        expect(c2.assignments(P1).filter((a) => a.state === 'running')).toHaveLength(1);
        expect(c2.getProject(P1).writeSlot?.heldBy).toBe(c.getProject(P1).writeSlot?.heldBy);
        expect(c2.getProject(P1).dispatchedCount).toBe(1); // durable dispatch count survives restart
        const a = firstAssignment(c2);
        runSequence(c2, [
            res({
                attemptId: a.attemptId,
                runId: a.runId,
                generation: a.generation,
                ownerEpoch: a.ownerEpoch,
                instanceId: a.instanceId,
                taskId: a.taskId,
                verified: true,
            }),
        ]);
        expect(c2.assignments(P1).filter((x) => x.state === 'running')).toHaveLength(0);
        expect(c2.holds(P1).some((h) => h.reason === 'rest-after-drain')).toBe(true);
        expect(c2.tasks(P1).get(a.taskId ?? '')?.completed).toBe(true);
    });

    test('R2/R3: stale-owner rejection — replacement bumps epoch, old result downgraded to diagnostic', () => {
        const c = boot();
        runSequence(c, [T('t1'), req('r1')]);
        const a = firstAssignment(c);
        c.process(replace());
        expect(c.getProject(P1).ownerEpoch).toBe(2);
        runSequence(c, [
            res({
                attemptId: a.attemptId,
                runId: a.runId,
                generation: a.generation,
                ownerEpoch: 1,
                instanceId: a.instanceId,
                taskId: 't1',
                verified: true,
            }),
        ]);
        expect(c.diagnostics(P1).some((d) => d.kind === 'stale-owner-rejected')).toBe(true);
        expect(c.tasks(P1).get('t1')?.completed).toBe(false); // NOT advanced by stale owner
        expect(c.unsafeForceAssignment.bind(c, P1, 'scribe-1', 't1')).toThrow(/single-writer/);
        expect(c.assignments(P1).some((x) => x.ownerEpoch === 2)).toBe(false);
        expect(c.dispatchCount).toBe(1);
        expect(c.getProject(P1).writeSlot?.heldBy).toBe(a.attemptId);
    });

    test('R2/R3: duplicate results dedupe by attemptId', () => {
        const c = boot();
        runSequence(c, [T('t1'), req('r1')]);
        const a = firstAssignment(c);
        const r = res({
            attemptId: a.attemptId,
            runId: a.runId,
            generation: a.generation,
            ownerEpoch: a.ownerEpoch,
            instanceId: a.instanceId,
            taskId: 't1',
            verified: true,
        });
        c.process(r);
        c.process(r);
        expect(c.getProject(P1).finishedResults.size).toBe(1);
        expect(c.getProject(P1).tasks.get('t1')?.completed).toBe(true);
        expect(c.dispatchCount).toBe(1);
    });

    test('R2/R3: exit-only zero exit finishes the RUN — the task is NOT completed', () => {
        const c = boot();
        runSequence(c, [T('t1'), req('r1')]);
        const a = firstAssignment(c);
        runSequence(c, [
            res({
                attemptId: a.attemptId,
                runId: a.runId,
                generation: a.generation,
                ownerEpoch: a.ownerEpoch,
                instanceId: a.instanceId,
                taskId: 't1',
                exitCode: 0,
                verified: false,
            }),
        ]);
        expect(c.getProject(P1).finishedResults.get(a.attemptId)?.taskOutcome).toBe('exit-only');
        expect(c.tasks(P1).get('t1')?.completed).toBe(false);
        expect(c.dispatchCount).toBe(1);
        expect(firstAssignment(c).state).toBe('outcome-unknown');
        expect(c.getProject(P1).writeSlot?.heldBy).toBe(a.attemptId);
    });

    test('R2: notification failure leaves the result discoverable in durable model state', () => {
        const c = boot();
        runSequence(c, [T('t1'), req('r1')]);
        const a = firstAssignment(c);
        c.process(
            res({
                attemptId: a.attemptId,
                runId: a.runId,
                generation: a.generation,
                ownerEpoch: a.ownerEpoch,
                instanceId: a.instanceId,
                taskId: 't1',
                verified: true,
                notification: 'failed',
            }),
        );
        expect(c.getProject(P1).diagnostics.some((d) => d.kind === 'notification-failed')).toBe(true);
        const c2 = restoreController(c.snapshot());
        const retained = [...c2.getProject(P1).finishedResults.values()].filter((r) => r.notification === 'failed');
        expect(retained).toHaveLength(1);
        expect(c2.reconcileNotifications(P1)).toHaveLength(1);
    });

    test('R2/R3: cross-project delivery cannot advance another project; duplicate-assignment guard trips', () => {
        const c = boot();
        c.addInstance(P2, I('other-coder'));
        runSequence(c, [T('t1'), req('r1')]);
        const a = firstAssignment(c);
        c.process(
            res({
                attemptId: a.attemptId,
                runId: a.runId,
                generation: a.generation,
                ownerEpoch: a.ownerEpoch,
                instanceId: a.instanceId,
                taskId: 't1',
                verified: true,
                projectPath: P2,
            }),
        );
        expect(c.diagnostics(P2).some((d) => d.kind === 'orphan-result')).toBe(true);
        expect(c.getProject(P1).assignments.some((x) => x.taskId === 't1' && x.state === 'running')).toBe(true);
        expect(c.tasks(P1).get('t1')?.completed).toBe(false);
        expect(() => c.unsafeForceAssignment(P1, 'coder-2', 't1')).toThrow(/single-writer/);
    });

    test('Tripwire: guards stay dormant on the happy path and throw exactly when forced', () => {
        const c = boot();
        runSequence(c, [req('r1'), T('t1'), T('t2')]);
        expect(c.getProject(P1).writeSlot).not.toBeNull(); // compliant controller: slot held by one writer
        expect(() => c.unsafeForceAssignment(P1, 'coder-1', 't1')).toThrow(/duplicate-assignment/);
        const c2 = new G6StrategyPrototypeController();
        c2.addInstance(P1, I('coder-1'));
        runSequence(c2, [T('t1'), req('r1')]);
        const a = firstAssignment(c2);
        runSequence(c2, [
            res({
                attemptId: a.attemptId,
                runId: a.runId,
                generation: a.generation,
                ownerEpoch: a.ownerEpoch,
                instanceId: a.instanceId,
                taskId: 't1',
                verified: true,
            }),
        ]);
        expect(c2.getProject(P1).writeSlot).toBeNull(); // after reconciliation no ghost slot
    });
    test('R2/R3: replacement retains ambiguous writer reservation instead of replaying it', () => {
        const c = boot();
        runSequence(c, [T('t1'), req('r1')]);
        const a = firstAssignment(c);
        const slot = c.getProject(P1).writeSlot;
        c.process(replace());
        expect(c.dispatchCount).toBe(1);
        expect(c.getProject(P1).writeSlot).toEqual(slot);
        expect(firstAssignment(c).attemptId).toBe(a.attemptId);
        expect(c.holds(P1).some((h) => h.reason === 'outcome-unknown')).toBe(true);
    });

    test.each(['task', 'epoch'] as const)('R3: rejects a result with forged %s correlation', (field) => {
        const c = boot();
        runSequence(c, [T('t1', { priority: 1 }), T('t2'), req('r1')]);
        const a = firstAssignment(c);
        c.process(
            res({
                ...a,
                taskId: field === 'task' ? 't2' : a.taskId,
                ownerEpoch: field === 'epoch' ? a.ownerEpoch + 1 : a.ownerEpoch,
                verified: true,
            }),
        );
        expect(c.getProject(P1).finishedResults.size).toBe(0);
        expect(c.tasks(P1).get('t1')?.completed).toBe(false);
        expect(c.tasks(P1).get('t2')?.completed).toBe(false);
        expect(c.dispatchCount).toBe(1);
    });

    test('R2: restart preserves ID and generation counters across later dispatches', () => {
        const c = boot();
        runSequence(c, [T('t1', { priority: 1 }), T('t2'), req('r1')]);
        const first = firstAssignment(c);
        c.process(res({ ...first, verified: true }));
        const second = firstAssignment(c);
        const restored = restoreController(c.snapshot());
        runSequence(restored, [T('t3'), res({ ...second, verified: true })]);
        const third = firstAssignment(restored);
        expect(third.attemptId).not.toBe(first.attemptId);
        expect(third.attemptId).not.toBe(second.attemptId);
        expect(third.runId).not.toBe(second.runId);
        expect(third.generation).toBeGreaterThan(second.generation);
        expect(restored.dispatchCount).toBe(3);
    });

    test('R1/R4: questions answer without dispatch; trace retains event state and counters', () => {
        const c = boot();
        runSequence(c, [T('t1'), { ...req('question'), intent: 'question' }]);
        expect(c.dispatchCount).toBe(0);
        const question = [...c.getProject(P1).requests.values()][0];
        expect(question?.answer).toContain('SIMULATED answer from planner-1');
        expect(JSON.parse(c.trace.at(-1) ?? '').event.requestId).toBe('question');
        const trace = JSON.parse(c.trace.at(-1) ?? '');
        expect(JSON.parse(trace.before.state).projects[0].requests).toHaveLength(0);
        expect(JSON.parse(trace.after).projects[0].requests).toHaveLength(1);
        runSequence(c, [req('request::with::separators')]);
        expect(firstAssignment(c).requestId).toBe('request::with::separators');
    });

    test('R3: write tasks require write capability and WBS ordering is numeric', () => {
        const c = new G6StrategyPrototypeController();
        c.addInstance(P1, I('coder-0', { capabilities: ['read-only'] }));
        c.addInstance(P1, I('coder-1'));
        runSequence(c, [T('late', { wbs: '1.10' }), T('early', { wbs: '1.2' }), req('r1')]);
        expect(firstAssignment(c).instanceId).toBe('coder-1');
        expect(firstAssignment(c).taskId).toBe('early');
    });
});
