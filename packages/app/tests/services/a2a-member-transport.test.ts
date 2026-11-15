import { describe, expect, test } from 'bun:test';
import { CoordinationRunDao, createMigratedDb, type DbAdapter } from '@gobing-ai/spur-domain';
import {
    type A2aCli,
    A2aMemberTransport,
    type A2aTask,
    a2aTaskToReceipt,
} from '../../src/services/a2a-member-transport';
import type { FleetDispatchRequest } from '../../src/services/fleet-dispatcher';
import type { ResolvedFleetMember } from '../../src/services/fleet-service';
import { InboxService } from '../../src/services/inbox-service';

const MEMBER: ResolvedFleetMember = {
    instanceId: 'proj-remote',
    localId: 'remote',
    executor: '',
    enabled: true,
    writeCapable: false,
    capabilityState: 'unavailable',
    a2a: 'http://127.0.0.1:18081',
    authEnv: 'REMOTE_TOKEN',
};

function task(state: string, text = 'answer'): A2aTask {
    return {
        id: 'task-1',
        contextId: 'ctx-1',
        state,
        statusMessage: `remote ${state}`,
        artifactText: state === 'TASK_STATE_COMPLETED' ? text : '',
    };
}

class FakeCli implements A2aCli {
    readonly calls: string[] = [];
    sendCount = 0;
    cardError: Error | undefined;
    states: A2aTask[] = [task('TASK_STATE_COMPLETED')];

    async version(): Promise<string> {
        return 'a2a 0.4.0';
    }
    async card(): Promise<{ protocolVersion: string }> {
        this.calls.push('card');
        if (this.cardError !== undefined) throw this.cardError;
        return { protocolVersion: '1.0' };
    }
    async send(
        _member: ResolvedFleetMember,
        _text: string,
        messageId: string,
    ): Promise<{ taskId: string; contextId: string }> {
        this.calls.push(`send:${messageId}`);
        this.sendCount++;
        return { taskId: 'task-1', contextId: 'ctx-1' };
    }
    async get(): Promise<A2aTask> {
        this.calls.push('get');
        const next = this.states.length > 1 ? this.states.shift() : this.states[0];
        if (next === undefined) throw new Error('no fake task state');
        return next;
    }
    async cancel(): Promise<void> {
        this.calls.push('cancel');
    }
}

async function harness(options: { env?: Record<string, string>; cli?: FakeCli; now?: () => number } = {}) {
    let db: DbAdapter | undefined;
    const getDb = async () => (db ??= await createMigratedDb({ url: ':memory:' }));
    const cli = options.cli ?? new FakeCli();
    const transport = new A2aMemberTransport({
        cwd: '/tmp/a2a-test',
        getDb,
        env: options.env ?? { REMOTE_TOKEN: 'secret-value' },
        cli,
        pollIntervalMs: 1,
        sleep: async () => undefined,
        ...(options.now !== undefined ? { now: options.now } : {}),
    });
    const inbox = new InboxService({ getDb });
    const dispatcher = {
        enqueue: async (req: FleetDispatchRequest) => {
            const sent = await inbox.send({
                from: req.fromId,
                to: req.member,
                body: req.body,
                kind: 'request',
                ...(req.requestKey !== undefined ? { requestKey: req.requestKey } : {}),
                ...(req.taskId !== undefined ? { taskId: req.taskId } : {}),
                ...(req.parentRunId !== undefined ? { parentRunId: req.parentRunId } : {}),
            });
            return { messageId: sent.message.id, replayed: sent.replayed };
        },
    };
    return { transport, inbox, dispatcher, cli, getDb: async () => await getDb() };
}

describe('1334 design §4.2: A2A task states map to the existing receipt vocabulary', () => {
    test('completed carries joined artifact text', () => {
        expect(a2aTaskToReceipt(task('TASK_STATE_COMPLETED', 'one\ntwo'))).toMatchObject({
            status: 'completed',
            output: 'one\ntwo',
        });
    });
    test.each([
        ['TASK_STATE_FAILED', 'failed', 'remote TASK_STATE_FAILED'],
        ['TASK_STATE_REJECTED', 'failed', 'remote TASK_STATE_REJECTED'],
        ['TASK_STATE_CANCELED', 'failed', 'canceled'],
        ['TASK_STATE_INPUT_REQUIRED', 'failed', 'needs-input'],
        ['TASK_STATE_AUTH_REQUIRED', 'failed', 'needs-auth'],
    ])('%s is a definite terminal outcome', (state, status, reason) => {
        expect(a2aTaskToReceipt(task(state))).toMatchObject({ status, reason });
    });
    test('a nonterminal state has no receipt yet', () => {
        expect(a2aTaskToReceipt(task('TASK_STATE_WORKING'))).toBeNull();
    });
});

describe('1334: one keyed inbox request becomes one A2A turn', () => {
    test('AC1/AC2: completed work persists remote identity BEFORE the wait and returns artifact text', async () => {
        const h = await harness();
        const result = await h.transport.dispatch(MEMBER, 'read only question', {
            dispatcher: h.dispatcher,
            fromId: 'operator',
            requestKey: 'run-1/review',
        });
        expect(result).toMatchObject({ status: 'completed', remoteTaskId: 'task-1', output: 'answer' });
        expect(h.cli.calls[0]).toBe('card');
        expect(h.cli.sendCount).toBe(1);
        const rows = await new CoordinationRunDao(await h.getDb()).listByMessageId(result.messageId);
        expect(rows[0]).toMatchObject({ status: 'exited', remote_task_id: 'task-1', remote_context_id: 'ctx-1' });
        expect(await h.transport.outputForRun(rows[0]?.run_id ?? '')).toBe('answer');
        expect(await h.transport.outputForRun('missing-run')).toBeUndefined();
        const message = await h.inbox.get(result.messageId);
        expect(message?.status).toBe('delivered');
    });

    test('AC3: a wait deadline is outcome-unknown and a restart re-attaches without a second send', async () => {
        let clock = 0;
        const cli = new FakeCli();
        cli.states = [task('TASK_STATE_WORKING'), task('TASK_STATE_WORKING'), task('TASK_STATE_COMPLETED')];
        const h = await harness({ cli, now: () => (clock += 10) });
        const first = await h.transport.dispatch(MEMBER, 'read only question', {
            dispatcher: h.dispatcher,
            fromId: 'operator',
            requestKey: 'run-2/review',
            timeoutMs: 15,
        });
        expect(first.status).toBe('outcome-unknown');
        const running = await new CoordinationRunDao(await h.getDb()).getByRunId(first.runId ?? '');
        expect(running).toMatchObject({ status: 'running', remote_task_id: 'task-1' });
        const second = await h.transport.runMessage(MEMBER, first.messageId, { timeoutMs: 100 });
        expect(second.status).toBe('completed');
        expect(cli.sendCount).toBe(1);
        expect((await new CoordinationRunDao(await h.getDb()).getByRunId(first.runId ?? ''))?.status).toBe('exited');
    });

    test('AC4: a transport error after a task id exists is outcome-unknown, never a re-send', async () => {
        const cli = new FakeCli();
        cli.get = async () => {
            throw new Error('connection reset');
        };
        const h = await harness({ cli });
        const first = await h.transport.dispatch(MEMBER, 'read only question', {
            dispatcher: h.dispatcher,
            fromId: 'operator',
            requestKey: 'run-3/review',
        });
        expect(first.status).toBe('outcome-unknown');
        const second = await h.transport.runMessage(MEMBER, first.messageId);
        expect(second.status).toBe('outcome-unknown');
        expect(cli.sendCount).toBe(1);
    });

    test('input-required and auth-required cancel the remote task and end failed', async () => {
        for (const [state, reason] of [
            ['TASK_STATE_INPUT_REQUIRED', 'needs-input'],
            ['TASK_STATE_AUTH_REQUIRED', 'needs-auth'],
        ] as const) {
            const cli = new FakeCli();
            cli.states = [task(state)];
            const h = await harness({ cli });
            const result = await h.transport.dispatch(MEMBER, 'read only question', {
                dispatcher: h.dispatcher,
                fromId: 'operator',
            });
            expect(result).toMatchObject({ status: 'failed', reason });
            expect(cli.calls).toContain('cancel');
        }
    });

    test('R6: unreachable card / missing auth is not-started, names the member and stores no secret', async () => {
        const cli = new FakeCli();
        cli.cardError = new Error('a2a binary not found');
        const h = await harness({ cli });
        const result = await h.transport.dispatch(MEMBER, 'read only question', {
            dispatcher: h.dispatcher,
            fromId: 'operator',
        });
        expect(result.status).toBe('not-started');
        expect(result.reason).toContain(MEMBER.instanceId);
        expect(result.reason).not.toContain('secret-value');
        expect(cli.sendCount).toBe(0);
        expect(await new CoordinationRunDao(await h.getDb()).listByMessageId(result.messageId)).toEqual([]);
        expect((await h.inbox.get(result.messageId))?.status).toBe('failed');
    });

    test('R8: a transport error is redacted with the environment-held credential', async () => {
        const cli = new FakeCli();
        cli.cardError = new Error('server rejected secret-value');
        const h = await harness({ cli });
        const result = await h.transport.dispatch(MEMBER, 'read only question', {
            dispatcher: h.dispatcher,
            fromId: 'operator',
        });
        expect(result.reason).not.toContain('secret-value');
        expect(result.reason).toContain('[redacted]');
    });

    test('AC5: worktree-mutating work is refused before card resolution or send', async () => {
        const h = await harness();
        const result = await h.transport.dispatch(MEMBER, 'write a file', {
            dispatcher: h.dispatcher,
            fromId: 'operator',
            work: { expectFiles: ['answer.txt'], requireDiff: true, ownedSections: ['Solution'] },
        });
        expect(result.status).toBe('not-started');
        expect(result.reason).toContain('read-only');
        expect(h.cli.calls).toEqual([]);
        expect(h.cli.sendCount).toBe(0);
    });

    test('R10: doctor reports binary version, card reachability and protocol version', async () => {
        const h = await harness();
        expect(await h.transport.doctor(MEMBER)).toMatchObject({
            binaryVersion: 'a2a 0.4.0',
            cardReachable: true,
            protocolVersion: '1.0',
        });
        h.cli.cardError = new Error('connection refused');
        expect(await h.transport.doctor(MEMBER)).toMatchObject({ cardReachable: false });
    });

    test('existing terminal receipts and enqueue failures return without another remote call', async () => {
        const h = await harness();
        const completed = await h.transport.dispatch(MEMBER, 'read only', {
            dispatcher: h.dispatcher,
            fromId: 'operator',
            requestKey: 'terminal/one',
        });
        const calls = [...h.cli.calls];
        expect(await h.transport.runMessage(MEMBER, completed.messageId)).toMatchObject({
            status: 'completed',
            runId: completed.runId,
        });
        expect(h.cli.calls).toEqual(calls);
        const failed = await h.transport.dispatch(MEMBER, 'read only', {
            dispatcher: {
                enqueue: async () => {
                    throw new Error('inbox offline');
                },
            },
            fromId: 'operator',
        });
        expect(failed).toMatchObject({ status: 'not-started', messageId: '' });
        expect(failed.reason).toContain('inbox offline');
        expect(await h.transport.runMessage(MEMBER, 'missing-message')).toMatchObject({
            status: 'failed',
            reason: 'inbox request not found',
        });
        expect(await h.transport.runMessage({ ...MEMBER, a2a: undefined }, 'x')).toMatchObject({
            status: 'failed',
            reason: 'member "proj-remote" has no a2a declaration',
        });
    });

    test('a claimed batch and a failed/delivered request with no run keep their distinct outcomes', async () => {
        const h = await harness();
        const first = await h.inbox.send({ from: 'operator', to: MEMBER.instanceId, body: 'one', kind: 'request' });
        const second = await h.inbox.send({ from: 'operator', to: MEMBER.instanceId, body: 'two', kind: 'request' });
        const claims = [first.message.id, second.message.id].map((id) => ({ id, attempts: 1 }));
        const results = await h.transport.runClaimed(MEMBER, claims);
        expect(results.map((result) => result.status)).toEqual(['completed', 'completed']);
        expect(h.cli.sendCount).toBe(2);
        const failed = await h.inbox.send({ from: 'operator', to: MEMBER.instanceId, body: 'failed', kind: 'request' });
        const failedClaim = await h.inbox.claimById(failed.message.id);
        expect(failedClaim).not.toBeNull();
        if (failedClaim !== null) await h.inbox.settle([failedClaim], 'not-started', 'definite refusal');
        expect(await h.transport.runMessage(MEMBER, failed.message.id)).toMatchObject({
            status: 'not-started',
            reason: 'definite refusal',
        });
        const delivered = await h.inbox.send({
            from: 'operator',
            to: MEMBER.instanceId,
            body: 'delivered',
            kind: 'request',
        });
        const deliveredClaim = await h.inbox.claimById(delivered.message.id);
        expect(deliveredClaim).not.toBeNull();
        if (deliveredClaim !== null) await h.inbox.settle([deliveredClaim], 'accepted');
        expect((await h.transport.runMessage(MEMBER, delivered.message.id)).status).toBe('outcome-unknown');
    });

    test("another worker's claimed row is never sent twice; only its owner may drive it", async () => {
        const h = await harness();
        const sent = await h.inbox.send({
            from: 'operator',
            to: MEMBER.instanceId,
            body: 'claimed elsewhere',
            kind: 'request',
        });
        const ownerClaim = await h.inbox.claimById(sent.message.id);
        expect(ownerClaim).not.toBeNull();
        const direct = await h.transport.runMessage(MEMBER, sent.message.id);
        expect(direct.status).toBe('outcome-unknown');
        expect(h.cli.sendCount).toBe(0);
        if (ownerClaim !== null) {
            const [driven] = await h.transport.runClaimed(MEMBER, [ownerClaim]);
            expect(driven?.status).toBe('completed');
            expect(h.cli.sendCount).toBe(1);
        }
    });

    test('an unexpected post-enqueue error is outcome-unknown, never a not-started retry', async () => {
        const h = await harness();
        h.transport.runMessage = async () => {
            throw new Error('database disappeared after send');
        };
        const result = await h.transport.dispatch(MEMBER, 'read only', {
            dispatcher: h.dispatcher,
            fromId: 'operator',
            requestKey: 'post-enqueue/error',
        });
        expect(result.status).toBe('outcome-unknown');
        expect(result.messageId).not.toBe('');
    });

    test('doctor names an unavailable binary and redacts a card failure', async () => {
        const cli = new FakeCli();
        cli.version = async () => {
            throw new Error('missing binary');
        };
        cli.cardError = new Error('secret-value rejected');
        const h = await harness({ cli });
        expect(await h.transport.doctor(MEMBER)).toMatchObject({
            binaryVersion: 'unavailable (missing binary)',
            cardReachable: false,
            reason: '[redacted] rejected',
        });
    });
});
