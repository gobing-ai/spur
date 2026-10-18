import { join, resolve } from 'node:path';
import { CLAIM_TTL_MS, type DbAdapter, ProjectClaimDao, RunDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';

/** Release a task run's worktree claim without disturbing another owner or its generation. */
export async function releaseWorktreeRunLease(db: DbAdapter, cwd: string, runId: string): Promise<void> {
    const claims = new ProjectClaimDao(db);
    const fs = createNodeFileSystem(cwd);
    const project = (await fs.exists(cwd)) ? (fs.realPath?.(cwd) ?? resolve(cwd)) : resolve(cwd);
    const claim = await claims.get(project, 'worktree');
    if (claim?.holderId === runId) await claims.release(project, 'worktree', runId, claim.ownerEpoch);
}

/** Keep the existing per-task worktree exclusive across engine execution and host pauses. */
export async function withWorktreeRunLease<T extends { status: string }>(
    db: DbAdapter,
    cwd: string,
    workflowName: string,
    runId: string,
    execute: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
    const fs = createNodeFileSystem(cwd);
    if (workflowName !== 'task-pipeline' || !(await fs.stat(join(cwd, '.git')))?.isFile()) return execute();
    const project = fs.realPath?.(cwd) ?? resolve(cwd);
    const claims = new ProjectClaimDao(db);
    let claim = await claims.get(project, 'worktree');
    if (claim !== null && claim.holderId !== runId) {
        const owner = await new RunDao(db).traceRowById(claim.holderId);
        if (owner !== undefined && ['done', 'failed', 'cancelled'].includes(owner.status)) {
            await claims.release(project, 'worktree', claim.holderId, claim.ownerEpoch);
        } else if (claim.expiresAt > Date.now() || owner !== undefined) {
            throw new Error(
                `Worktree ${project} is leased by run ${claim.holderId}; continue or cancel that run first`,
            );
        }
    }
    if (claim?.holderId === runId && claim.expiresAt > Date.now()) {
        if (!(await claims.heartbeat(project, 'worktree', runId, CLAIM_TTL_MS, claim.ownerEpoch))) claim = null;
    } else {
        claim = await claims.claim(project, 'worktree', runId, CLAIM_TTL_MS);
    }
    if (claim === null) {
        const owner = await claims.get(project, 'worktree');
        throw new Error(`Worktree ${project} is leased by run ${owner?.holderId ?? 'another claimant'}`);
    }
    const epoch = claim.ownerEpoch;
    const abort = new AbortController();
    let heartbeat = Promise.resolve();
    const timer = setInterval(() => {
        heartbeat = heartbeat
            .then(async () => {
                if (!(await claims.heartbeat(project, 'worktree', runId, CLAIM_TTL_MS, epoch))) {
                    abort.abort(new Error(`Run ${runId} lost its worktree lease`));
                }
            })
            .catch((error: unknown) => {
                abort.abort(error);
            });
    }, CLAIM_TTL_MS / 3);
    timer.unref();
    let result!: T;
    let lostPausedLease = false;
    try {
        result = await execute(abort.signal);
    } finally {
        clearInterval(timer);
        await heartbeat;
        const status = result?.status ?? (await new RunDao(db).traceRowById(runId))?.status;
        if (status === 'paused' || status === 'interrupted') {
            // A host pause outlives its CLI process; only that run's continue/cancel may release it.
            lostPausedLease = !(await claims.heartbeat(
                project,
                'worktree',
                runId,
                Number.MAX_SAFE_INTEGER - Date.now(),
                epoch,
            ));
        } else if (status !== 'running' && status !== 'pending') {
            await claims.release(project, 'worktree', runId, epoch);
        }
    }
    if (lostPausedLease) throw new Error(`Run ${runId} lost its worktree lease before pausing`);
    return result;
}
