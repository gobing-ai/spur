import { describe, expect, spyOn, test, vi } from 'bun:test';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectClaimDao, RunDao } from '@gobing-ai/spur-domain';
import { HOST_FLOW, harness, writeArtifact, writeHostReceipt } from '../fixtures/workflow-host';

// Worktree failures: a paused owner loses exclusivity, another run steals it,
// a same-run continue cannot reacquire, or terminal/cancel leaves a stale claim.
describe('engine worktree ownership (D65 1235 R3)', () => {
    test.each(['fenced', 'storage-error'])('lease failure %s aborts the agent before it can write', async (failure) => {
        let enter!: () => void;
        const entered = new Promise<void>((resolve) => {
            enter = resolve;
        });
        let release!: () => void;
        const wait = new Promise<void>((resolve) => {
            release = resolve;
        });
        let captured: AbortSignal | undefined;
        const { svc, db, dir, file } = await harness(async (signal) => {
            captured = signal;
            enter();
            await Promise.race([
                wait,
                new Promise<never>((_resolve, reject) => {
                    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
                }),
            ]);
        });
        writeFileSync(join(dir, '.git'), 'gitdir: fixture\n');
        writeFileSync(file, HOST_FLOW.replace('name: host-executor-flow', 'name: task-pipeline'));
        vi.useFakeTimers();
        let restore = (): void => {};
        const running = svc.run(file, { runId: 'fenced-owner' });
        try {
            await entered;
            expect(captured).toBeDefined();
            const claims = new ProjectClaimDao(db);
            const project = realpathSync(dir);
            const old = await claims.get(project, 'worktree');
            if (failure === 'fenced') {
                await claims.release(project, 'worktree', 'fenced-owner', old?.ownerEpoch ?? 0);
                await claims.claim(project, 'worktree', 'replacement-owner', 30_000);
            } else {
                const broken = spyOn(ProjectClaimDao.prototype, 'heartbeat').mockRejectedValueOnce(
                    new Error('lease storage unavailable'),
                );
                restore = () => {
                    broken.mockRestore();
                };
            }
            vi.advanceTimersByTime(10_000);
            for (let n = 0; n < 30; n++) await Promise.resolve();
            expect((await running).status).toBe('failed');
            expect(existsSync(join(dir, '.spur/run/host-artifact.txt'))).toBe(false);
            expect((await claims.get(project, 'worktree'))?.holderId).toBe(
                failure === 'fenced' ? 'replacement-owner' : undefined,
            );
        } finally {
            release();
            await running;
            restore();
            vi.useRealTimers();
        }
    });
    test('pause retains the run owner; competing runs are refused; continue and terminal release it', async () => {
        const { svc, db, dir, file } = await harness();
        writeFileSync(join(dir, '.git'), 'gitdir: fixture\n');
        writeFileSync(file, HOST_FLOW.replace('name: host-executor-flow', 'name: task-pipeline'));
        const first = await svc.run(file, { runId: 'worktree-owner', vars: { executor: 'host' } });
        expect(first.status).toBe('paused');
        const claims = new ProjectClaimDao(db);
        const claim = await claims.get(realpathSync(dir), 'worktree');
        expect(claim?.holderId).toBe(first.runId);
        await db.run("UPDATE project_claims SET expires_at = ? WHERE slot = 'worktree'", Date.now() - 1);
        await expect(svc.run(file, { runId: 'worktree-intruder', vars: { executor: 'host' } })).rejects.toThrow(
            'worktree-owner',
        );
        await db.run("UPDATE runs SET status = 'running' WHERE id = ?", first.runId);
        await expect(svc.run(file, { runId: 'active-intruder', vars: { executor: 'host' } })).rejects.toThrow(
            'worktree-owner',
        );
        await db.run("UPDATE runs SET status = 'paused' WHERE id = ?", first.runId);
        expect(await new RunDao(db).traceRowById('worktree-intruder')).toBeUndefined();
        writeArtifact(dir, '.spur/run/host-artifact.txt');
        await svc.continuePaused(first.runId, {
            answerText: writeHostReceipt(dir, { runId: first.runId, state: 'work' }),
        });
        writeArtifact(dir, '.spur/run/host-review.txt');
        const done = await svc.continuePaused(first.runId, {
            answerText: writeHostReceipt(dir, {
                runId: first.runId,
                state: 'review',
                files: ['.spur/run/host-review.txt'],
            }),
        });
        expect(done.status).toBe('done');
        expect(await claims.get(realpathSync(dir), 'worktree')).toBeNull();
    });

    test('cancel releases only the cancelled run and an expired owner can be reclaimed', async () => {
        const { svc, db, dir, file } = await harness();
        writeFileSync(join(dir, '.git'), 'gitdir: fixture\n');
        writeFileSync(file, HOST_FLOW.replace('name: host-executor-flow', 'name: task-pipeline'));
        const claims = new ProjectClaimDao(db);
        await claims.claim(realpathSync(dir), 'worktree', 'dead-owner', -1);
        const first = await svc.run(file, { runId: 'new-owner', vars: { executor: 'host' } });
        expect((await claims.get(realpathSync(dir), 'worktree'))?.holderId).toBe(first.runId);
        await svc.cancel('unrelated-run');
        expect((await claims.get(realpathSync(dir), 'worktree'))?.holderId).toBe(first.runId);
        await svc.cancel(first.runId);
        expect(await claims.get(realpathSync(dir), 'worktree')).toBeNull();
    });

    test('a failed task run releases its worktree', async () => {
        const { svc, db, dir, file } = await harness();
        writeFileSync(join(dir, '.git'), 'gitdir: fixture\n');
        writeFileSync(
            file,
            'name: task-pipeline\nkind: state-machine\ninitialState: work\nstates: [{id: work}, {id: failed}]\ntransitions: [{from: work, to: failed, guard: {kind: always}}]\nterminalStates: [failed]\nfailureStates: [failed]\n',
        );
        const result = await svc.run(file);
        expect(result.status).toBe('failed');
        expect(await new ProjectClaimDao(db).get(realpathSync(dir), 'worktree')).toBeNull();
    });
});
