import { describe, expect, test } from 'bun:test';
import { CoordinationRunDao, createMigratedDb, type DbAdapter } from '@gobing-ai/spur-domain';
import { type A2aCli, A2aMemberTransport, type A2aTask } from '../../src/services/a2a-member-transport';
import type { ResolvedFleetMember } from '../../src/services/fleet-service';

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

function task(state: string, extra: Partial<A2aTask> = {}): A2aTask {
    return { id: 'task-1', contextId: 'ctx-1', state, statusMessage: `remote ${state}`, artifactText: '', ...extra };
}

/** Records every CLI invocation so "one get, never a send" is provable. */
class CountingCli implements A2aCli {
    readonly calls: string[] = [];
    state: string = 'TASK_STATE_WORKING';
    cardError: Error | undefined;
    getError: Error | undefined;
    remoteBranch: string | undefined;

    async version(): Promise<string> {
        return 'a2a 0.4.0';
    }
    async card() {
        this.calls.push('card');
        if (this.cardError !== undefined) throw this.cardError;
        return { protocolVersion: '1.0', capabilities: { extensions: [{ uri: 'urn:spur:write-fencing:v1' }] } };
    }
    async send(): Promise<{ taskId: string; contextId: string }> {
        this.calls.push('send');
        return { taskId: 'task-1', contextId: 'ctx-1' };
    }
    async get(): Promise<A2aTask> {
        this.calls.push('get');
        if (this.getError !== undefined) throw this.getError;
        return { ...task(this.state), ...(this.remoteBranch === undefined ? {} : { remoteBranch: this.remoteBranch }) };
    }
    async cancel(): Promise<void> {
        this.calls.push('cancel');
    }
}

async function harness(
    options: { cli?: CountingCli; members?: ResolvedFleetMember[]; env?: Record<string, string> } = {},
) {
    let db: DbAdapter | undefined;
    const getDb = async () => (db ??= await createMigratedDb({ url: ':memory:' }));
    const cli = options.cli ?? new CountingCli();
    const transport = new A2aMemberTransport({
        cwd: '/tmp/a2a-refresh',
        getDb,
        env: options.env ?? { REMOTE_TOKEN: 'secret-value' },
        cli,
        pollIntervalMs: 1,
        sleep: async () => undefined,
        members: async () => options.members ?? [MEMBER],
    });
    return { transport, cli, getDb };
}

/** One coordination row carrying a remote task id, exactly as `runMessage` leaves it after a timeout. */
async function seedRow(
    getDb: () => Promise<DbAdapter>,
    overrides: { status?: 'running' | 'exited' | 'errored'; remoteTaskId?: string | null } = {},
): Promise<string> {
    const runs = new CoordinationRunDao(await getDb());
    await runs.insertStart({
        specId: MEMBER.instanceId,
        agentKind: 'a2a',
        processId: null,
        runId: 'run-1',
        generation: 1,
        startedAt: new Date().toISOString(),
        messageIds: ['msg-1'],
        ...(overrides.remoteTaskId === null ? {} : { remoteTaskId: overrides.remoteTaskId ?? 'task-1' }),
        remoteContextId: 'ctx-1',
    });
    if (overrides.status === 'exited' || overrides.status === 'errored') {
        await runs.updateExit('run-1', overrides.status, new Date().toISOString(), '[]', {
            messageIds: ['msg-1'],
            outcome: overrides.status === 'exited' ? 'run-exit-only' : 'errored',
        });
    }
    return 'run-1';
}

/**
 * 1396 R1/R3: read-on-demand refresh for a delegated receipt. The failure modes that matter are the
 * ones a poller would hide — a resend (forbidden), a network call on an already-terminal row, and a
 * refresh error that either loses the last known state or leaks a credential.
 */
describe('1396 R1: refresh applies one task get and never sends', () => {
    test('a working task refreshes to outcome-unknown with no send', async () => {
        const { transport, cli, getDb } = await harness();
        const runId = await seedRow(getDb);
        const refreshed = await transport.refresh(runId);
        expect(refreshed).toMatchObject({ runId, remoteTaskId: 'task-1', member: MEMBER.instanceId });
        expect(refreshed.status).toBe('outcome-unknown');
        expect(cli.calls.filter((call) => call === 'send')).toHaveLength(0);
        expect(cli.calls.filter((call) => call === 'get')).toHaveLength(1);
    });

    test('a completed remote task closes the receipt and records the remote branch', async () => {
        const { transport, cli, getDb } = await harness();
        cli.state = 'TASK_STATE_COMPLETED';
        cli.remoteBranch = 'sp/remote-work';
        const runId = await seedRow(getDb);
        const refreshed = await transport.refresh(runId);
        expect(refreshed).toMatchObject({ status: 'completed', remoteBranch: 'sp/remote-work' });
        const row = await new CoordinationRunDao(await getDb()).getByRunId(runId);
        expect(row?.status).toBe('exited');
        expect(row?.artifact_refs_json).toContain('sp/remote-work');
        expect(cli.calls).not.toContain('send');
    });

    test('a failed remote task closes the receipt as failed with the reason', async () => {
        const { transport, cli, getDb } = await harness();
        cli.state = 'TASK_STATE_FAILED';
        const runId = await seedRow(getDb);
        const refreshed = await transport.refresh(runId);
        expect(refreshed.status).toBe('failed');
        expect(refreshed.reason).toContain('remote TASK_STATE_FAILED');
        expect((await new CoordinationRunDao(await getDb()).getByRunId(runId))?.status).toBe('errored');
    });

    test('a terminal row is returned unchanged and makes no network call', async () => {
        const { transport, cli, getDb } = await harness();
        const runId = await seedRow(getDb, { status: 'exited' });
        const refreshed = await transport.refresh(runId);
        expect(refreshed.status).toBe('completed');
        expect(cli.calls).toEqual([]);
    });

    test('a row without a remote task id is never refreshed', async () => {
        const { transport, cli, getDb } = await harness();
        const runId = await seedRow(getDb, { remoteTaskId: null });
        const refreshed = await transport.refresh(runId);
        expect(refreshed).toMatchObject({ runId });
        expect(refreshed.remoteTaskId).toBeUndefined();
        expect(cli.calls).toEqual([]);
    });

    test('an unknown run id reports it instead of throwing', async () => {
        const { transport } = await harness();
        const refreshed = await transport.refresh('run-missing');
        expect(refreshed).toMatchObject({ runId: 'run-missing' });
        expect(refreshed.refreshError).toContain('no coordination run');
    });
});

describe('1396 R3: a refresh failure keeps the last known receipt and names the cause', () => {
    test('a target that stopped answering leaves the row running and reports the error', async () => {
        const { transport, cli, getDb } = await harness();
        cli.getError = new Error('connection refused');
        const runId = await seedRow(getDb);
        const refreshed = await transport.refresh(runId);
        expect(refreshed.status).toBe('outcome-unknown');
        expect(refreshed.refreshError).toContain('connection refused');
        expect((await new CoordinationRunDao(await getDb()).getByRunId(runId))?.status).toBe('running');
    });

    test('an unset credential is reported without echoing its name value', async () => {
        const { transport, cli, getDb } = await harness({ env: {} });
        const runId = await seedRow(getDb);
        const refreshed = await transport.refresh(runId);
        expect(refreshed.refreshError).toContain('REMOTE_TOKEN');
        expect(cli.calls).toEqual([]);
    });
});
