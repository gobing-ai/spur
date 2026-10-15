import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { type DbAdapter, RunDao } from '@gobing-ai/spur-domain';
import type { WorkflowPersistenceAdapter } from '@gobing-ai/ts-dual-workflow-engine';
import {
    signalSubprocess,
    withRunIdentityRecording,
    withSelfPidRecording,
} from '../../src/services/workflow-run-recording';

const db = {} as DbAdapter;

function fakeAdapter(): WorkflowPersistenceAdapter & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        createRun: async (record: { id: string }) => {
            calls.push(`createRun:${record.id}`);
        },
        createOrAttachRun: async (record: { id: string }) => {
            calls.push(`createOrAttachRun:${record.id}`);
            return { id: record.id, attached: false };
        },
        claimRunOwnership: async (runId: string) => {
            calls.push(`claim:${runId}`);
            return runId === 'mine' ? { runId } : undefined;
        },
        listRuns: async () => ['r'],
        marker: 'kept',
    } as unknown as WorkflowPersistenceAdapter & { calls: string[] };
}

afterEach(() => {
    mock.restore();
});

describe('signalSubprocess', () => {
    test('refuses invalid pids and its own process tree', () => {
        expect(signalSubprocess(0)).toBe(false);
        expect(signalSubprocess(1)).toBe(false);
        expect(signalSubprocess(1.5)).toBe(false);
        expect(signalSubprocess(process.pid)).toBe(false);
        expect(signalSubprocess(process.ppid)).toBe(false);
    });

    test('a pid that does not exist reports false', () => {
        expect(signalSubprocess(2 ** 30)).toBe(false);
    });

    test('SIGTERMs a live child (falling back from the group kill)', async () => {
        const child = Bun.spawn(['sleep', '30']);
        expect(signalSubprocess(child.pid)).toBe(true);
        await child.exited;
        expect(child.signalCode).toBe('SIGTERM');
    });
});

describe('withSelfPidRecording', () => {
    test('stamps the worker pid after create, attach and a successful claim only', async () => {
        const setPid = spyOn(RunDao.prototype, 'setPid').mockResolvedValue(undefined as never);
        const inner = fakeAdapter();
        const wrapped = withSelfPidRecording(inner, db);
        await wrapped.createRun({ id: 'a' } as never);
        await wrapped.createOrAttachRun({ id: 'b' } as never);
        await wrapped.claimRunOwnership('mine', {} as never, [] as never);
        await wrapped.claimRunOwnership('theirs', {} as never, [] as never);
        expect(setPid.mock.calls).toEqual([
            ['a', process.pid],
            ['b', process.pid],
            ['mine', process.pid],
        ]);
        expect(inner.calls).toEqual(['createRun:a', 'createOrAttachRun:b', 'claim:mine', 'claim:theirs']);
        expect(await (wrapped as unknown as { listRuns: () => Promise<string[]> }).listRuns()).toEqual(['r']);
        expect((wrapped as unknown as { marker: string }).marker).toBe('kept');
    });

    test('a pid stamp failure never fails the persistence call', async () => {
        spyOn(RunDao.prototype, 'setPid').mockRejectedValue(new Error('db locked'));
        const wrapped = withSelfPidRecording(fakeAdapter(), db);
        await expect(wrapped.createRun({ id: 'a' } as never)).resolves.toBeUndefined();
    });
});

describe('withRunIdentityRecording', () => {
    const identity = { definitionDigest: 'sha256:d', workflowVersion: '2', source: 'project' as never };

    test('stamps identity on create and on a fresh attach, not on re-attaching an existing run', async () => {
        const stamp = spyOn(RunDao.prototype, 'stampRunIdentity').mockResolvedValue(undefined as never);
        spyOn(RunDao.prototype, 'traceRowById').mockImplementation(async (id: string) =>
            id === 'old' ? ({ id } as never) : undefined,
        );
        const wrapped = withRunIdentityRecording(fakeAdapter(), db, identity);
        await wrapped.createRun({ id: 'a' } as never);
        await wrapped.createOrAttachRun({ id: 'new' } as never);
        await wrapped.createOrAttachRun({ id: 'old' } as never);
        expect(stamp.mock.calls as unknown[]).toEqual([
            ['a', 'sha256:d', '2', 'project'],
            ['new', 'sha256:d', '2', 'project'],
        ]);
        expect(await (wrapped as unknown as { listRuns: () => Promise<string[]> }).listRuns()).toEqual(['r']);
    });
});
