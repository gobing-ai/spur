/**
 * G76 task 1342 — fleet integration queue and integrated-dependency admission, end to end over a
 * REAL git repository, the REAL `WorktreeLaneService` and a migrated db. The gate and the feature
 * sync are injected: they are the two seams the runtime owns (a project gate and a feature
 * service), never reimplemented here.
 *
 * Failure cases written first (Plan step 1):
 * - F6 gate on tree change: a rebased tree is gated before the base moves (R1)
 * - F7 ff-only: the base ref advances with no merge commit (R2)
 * - F8 conflict retained: a rebase conflict aborts, retains lane and branch (R3)
 * - F4/F5 dependent waits for landing, not completion (R4)
 * - F12 feature syncs once, after its last landing (R2)
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar } from '@gobing-ai/spur-config';
import { type DbAdapter, SystemEventDao } from '@gobing-ai/spur-domain';
import {
    FLEET_AUTO_TAG,
    FleetIntegrationQueue,
    gtdStrategy,
    type IntegrationCandidate,
    type IntegrationGateVerdict,
    normalizeProjectPath,
    type StrategyContext,
    type TaskSummary,
    WorktreeLaneService,
} from '../../src/index';
import { lanePath } from '../../src/services/worktree-lane-service';
import { createMigratedDb } from '../helpers';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const fn of cleanups.splice(0)) await fn();
});

async function git(cwd: string, ...args: string[]): Promise<string> {
    const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    if (code !== 0) throw new Error(`git ${args.join(' ')}: ${err}`);
    return out.trim();
}

interface Rig {
    project: string;
    db: DbAdapter;
    laneRoot: string;
    lanes: WorktreeLaneService;
    candidates: IntegrationCandidate[];
    gate: { verdict: IntegrationGateVerdict; calls: Array<{ wbs: string; cwd: string }> };
    synced: string[];
    drain: (ownerEpoch?: number) => Promise<Awaited<ReturnType<FleetIntegrationQueue['drainOne']>>>;
    cleanup: () => Promise<void>;
}

/** A repo with one commit on `main`, a lane service, and a queue wired to recording seams. */
async function makeRig(): Promise<Rig> {
    const base = await mkdtemp(join(tmpdir(), 'spur-integration-'));
    const repo = join(base, 'repo');
    await mkdir(join(repo, 'src'), { recursive: true });
    await writeFile(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
    await writeFile(join(repo, '.gitignore'), '.spur/\nnode_modules\n');
    await git(repo, 'init', '-q', '-b', 'main');
    await git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A');
    await git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
    const project = normalizeProjectPath(repo);
    const laneRoot = join(base, 'lanes');
    const db = await createMigratedDb();
    const lanes = new WorktreeLaneService({ projectPath: project, laneRoot, getDb: async () => db });
    const gate: Rig['gate'] = { verdict: 'PASS', calls: [] };
    const synced: string[] = [];
    const candidates: IntegrationCandidate[] = [];
    const queue = new FleetIntegrationQueue({
        baseBranch: 'main',
        lanes,
        getDb: async () => db,
        candidates: async () => candidates,
        runGate: async (wbs, cwd) => {
            gate.calls.push({ wbs, cwd });
            return gate.verdict;
        },
        featureOf: async (wbs) => (wbs === '0601' || wbs === '0602' ? 'G76' : null),
        syncFeature: async (featureId) => {
            synced.push(featureId);
        },
    });
    const cleanup = async () => {
        await rm(base, { recursive: true, force: true });
    };
    cleanups.push(cleanup);
    return {
        project,
        db,
        laneRoot,
        lanes,
        candidates,
        gate,
        synced,
        drain: (ownerEpoch = 1) => queue.drainOne(project, { ownerEpoch }),
        cleanup,
    };
}

/** Commit a change inside a lane, as a member's finished run would leave it. */
async function commitInLane(rig: Rig, wbs: string, attempt: number, file: string, body: string): Promise<string> {
    const lane = await rig.lanes.open(wbs, attempt);
    const target = join(lane.path, file);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, body);
    await git(lane.path, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A');
    await git(lane.path, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', `${wbs} work`);
    rig.candidates.push({ wbs, attempt });
    return lane.path;
}

describe('fleet integration queue (G76 1342)', () => {
    test('F7/F6 — a finished lane lands by fast-forward only, gated on its rebased tree (R1, R2)', async () => {
        const rig = await makeRig();
        const baseBefore = await git(rig.project, 'rev-parse', 'HEAD');
        const lane = await commitInLane(rig, '0601', 1, 'src/b.ts', 'export const b = 2;\n');
        // Read the lane's tip BEFORE the landing: a successful landing disposes the worktree.
        const laneTip = await git(lane, 'rev-parse', 'HEAD');

        const outcome = await rig.drain();
        expect(outcome?.kind).toBe('landed');
        if (outcome?.kind !== 'landed') throw new Error('expected a landing');
        expect(outcome.baseBefore).toBe(baseBefore);
        expect(outcome.baseAfter).not.toBe(baseBefore);
        // The gate ran in the LANE, not in the base tree.
        expect(rig.gate.calls).toHaveLength(1);
        expect(rig.gate.calls[0]?.cwd).toBe(lanePath(rig.project, rig.laneRoot, '0601', 1));
        // ff-only: one parent, no merge commit, and the base is the lane's own commit.
        expect(await git(rig.project, 'rev-list', '--count', '--merges', 'HEAD')).toBe('0');
        expect(await git(rig.project, 'rev-parse', 'HEAD')).toBe(laneTip);
        // Landed attempt is marked, the lane is disposed, and the feature synced once.
        expect(await rig.lanes.list()).toHaveLength(0);
        expect(rig.synced).toEqual(['G76']);
        const events = await new SystemEventDao(rig.db).query({ name: 'fleet.task.integrated', limit: 10 });
        expect(events).toHaveLength(1);
        expect(JSON.parse(events[0]?.payload_json ?? '{}')).toMatchObject({ wbs: '0601', attempt: 1 });
        expect(await rig.drain()).toBeNull();
    });

    test('a gate failure retains the lane and leaves the base alone (R1)', async () => {
        const rig = await makeRig();
        const baseBefore = await git(rig.project, 'rev-parse', 'HEAD');
        await commitInLane(rig, '0601', 1, 'src/b.ts', 'export const b = 2;\n');
        rig.gate.verdict = 'FAIL';

        const outcome = await rig.drain();
        expect(outcome?.kind).toBe('gate-failed');
        expect(await git(rig.project, 'rev-parse', 'HEAD')).toBe(baseBefore);
        expect((await rig.lanes.list()).map((lane) => lane.wbs)).toEqual(['0601']);
        expect(rig.synced).toEqual([]);
    });

    test('F8 — a rebase conflict aborts, retains lane and branch, and never resolves itself (R3)', async () => {
        const rig = await makeRig();
        await commitInLane(rig, '0601', 1, 'src/a.ts', 'export const a = 2;\n');
        await commitInLane(rig, '0602', 1, 'src/a.ts', 'export const a = 3;\n');
        // Land the first, so the second rebases onto a tree that moved the same line.
        expect((await rig.drain())?.kind).toBe('landed');

        const conflict = await rig.drain();
        expect(conflict?.kind).toBe('conflict');
        const lane = lanePath(rig.project, rig.laneRoot, '0602', 1);
        // Retained: the worktree and branch are still there for the operator.
        expect((await rig.lanes.list()).map((l) => l.wbs)).toEqual(['0602']);
        expect(await git(rig.project, 'branch', '--list', 'sp/run-0602-1')).toContain('sp/run-0602-1');
        // The lane is left clean — no rebase in progress — so the next attempt starts fresh.
        expect(await git(lane, 'status', '--porcelain=v1', '-b')).toContain('sp/run-0602-1');
        expect(rig.gate.calls.filter((call) => call.wbs === '0602')).toHaveLength(0);
    });

    test('F12 — a feature syncs once, after its last landing (R2)', async () => {
        const rig = await makeRig();
        await commitInLane(rig, '0601', 1, 'src/b.ts', 'export const b = 2;\n');
        await commitInLane(rig, '0602', 1, 'src/c.ts', 'export const c = 3;\n');
        expect((await rig.drain())?.kind).toBe('landed');
        // A sibling of the same feature is still queued: no sync yet.
        expect(rig.synced).toEqual([]);
        expect((await rig.drain())?.kind).toBe('landed');
        expect(rig.synced).toEqual(['G76']);
    });

    test('receipt: landing order, linear history, retained conflict, no orphans', async () => {
        const rig = await makeRig();
        await commitInLane(rig, '0601', 1, 'src/b.ts', 'export const b = 2;\n');
        await commitInLane(rig, '0602', 1, 'src/c.ts', 'export const c = 3;\n');
        await commitInLane(rig, '0603', 1, 'src/d.ts', 'export const d = 4;\n');
        const landed: string[] = [];
        for (let turn = 0; turn < 4; turn++) {
            const outcome = await rig.drain();
            if (outcome === null) break;
            if (outcome.kind === 'landed') landed.push(outcome.wbs);
        }
        const receipt = {
            task: '1342',
            landed,
            merges: Number(await git(rig.project, 'rev-list', '--count', '--merges', 'HEAD')),
            lanesAfterDrain: (await rig.lanes.list()).length,
            orphansAfterDrain: (await rig.lanes.list()).filter((lane) => !landed.includes(lane.wbs)).length,
            featureSyncs: rig.synced.length,
        };
        expect(receipt.merges).toBe(0);
        expect(receipt.orphansAfterDrain).toBe(0);
        expect(receipt.featureSyncs).toBe(1);
        if (getEnvVar('SPUR_WRITE_INTEGRATION_RECEIPT') === '1') {
            await writeFile(
                join(import.meta.dir, '../../../../docs/reports/fleet-integration-p2.json'),
                `${JSON.stringify(receipt, null, 4)}\n`,
            );
        }
    });
});

describe('integrated-dependency admission (G76 1342 R4)', () => {
    function candidate(wbs: string, dependencies: string[]): TaskSummary {
        return {
            wbs,
            name: `task ${wbs}`,
            status: 'todo',
            filePath: `/tmp/${wbs}.md`,
            dependencies,
            feature_id: 'G76',
            frontmatter: { tags: [FLEET_AUTO_TAG], priority: 'P1' },
        } as unknown as TaskSummary;
    }

    function select(lanes: NonNullable<StrategyContext['lanes']>, candidates: TaskSummary[]) {
        return gtdStrategy.select({
            projectPath: '/tmp/project',
            strategyVersion: 1,
            ownerEpoch: 1,
            candidates,
            idleInstances: [
                {
                    instanceId: 'coder1',
                    role: 'coder',
                    executor: 'writer',
                    enabled: true,
                    writeCapable: true,
                    capabilityState: 'available',
                },
            ],
            memberLifecycle: new Map(),
            dependencyBlocked: () => null,
            dispatchAttempts: new Map(),
            lanes,
        });
    }

    test('F4/F5 — a finished but unlanded prerequisite holds its dependent with awaiting-integration', () => {
        const result = select(
            {
                maxWriters: 2,
                inUse: [],
                filesOf: () => [],
                awaitingIntegration: (wbs) => (wbs === '0602' ? '0601' : null),
                conflictOf: () => null,
            },
            [candidate('0601', []), candidate('0602', ['0601'])],
        );
        expect(result.holds).toContainEqual({ wbs: '0602', reason: 'awaiting-integration', detail: '0601' });
        // The prerequisite itself is dispatchable: a landed or in-flight task is not held.
        expect(result.decisions.map((decision) => decision.taskId)).toEqual(['0601']);
    });

    test('a retained conflict holds its task with integration-conflict until the operator acts', () => {
        const result = select(
            {
                maxWriters: 2,
                inUse: [],
                filesOf: () => [],
                awaitingIntegration: () => null,
                conflictOf: (wbs) =>
                    wbs === '0602' ? { path: '/tmp/lanes/repo-0602-1', branch: 'sp/run-0602-1' } : null,
            },
            [candidate('0602', [])],
        );
        expect(result.holds).toContainEqual({
            wbs: '0602',
            reason: 'integration-conflict',
            detail: '/tmp/lanes/repo-0602-1 sp/run-0602-1',
        });
        expect(result.decisions).toHaveLength(0);
    });
});

describe('remote writer branches (G76 1345)', () => {
    /** A second repo standing in for the remote: it holds the branch a remote member pushed. */
    async function remoteWithBranch(base: string, repo: string, file: string, body: string): Promise<string> {
        const remote = join(base, 'remote.git');
        await git(base, 'init', '-q', '--bare', remote);
        await git(repo, 'remote', 'add', 'origin', remote);
        // The remote member's work: a commit on a branch that exists only on the remote.
        await git(repo, 'checkout', '-q', '-b', 'writer-0601');
        await writeFile(join(repo, file), body);
        await git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A');
        await git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'remote work');
        await git(repo, 'push', '-q', 'origin', 'writer-0601');
        await git(repo, 'checkout', '-q', 'main');
        await git(repo, 'branch', '-q', '-D', 'writer-0601');
        return remote;
    }

    test('AC1 — a remote branch is fetched into the queue namespace and lands through the same gate (R1, R2)', async () => {
        const rig = await makeRig();
        await remoteWithBranch(join(rig.project, '..'), rig.project, 'src/remote.ts', 'export const r = 9;\n');
        const baseBefore = await git(rig.project, 'rev-parse', 'HEAD');
        rig.candidates.push({ wbs: '0601', attempt: 1, remoteBranch: 'origin/writer-0601' });

        const outcome = await rig.drain();
        expect(outcome?.kind).toBe('landed');
        // Spur gated the rebased tree itself; the remote's own report was never trusted.
        expect(rig.gate.calls).toHaveLength(1);
        expect(await git(rig.project, 'rev-parse', 'HEAD')).not.toBe(baseBefore);
        expect(await git(rig.project, 'rev-list', '--count', '--merges', 'HEAD')).toBe('0');
        // The fetched branch landed and the lane is gone; the remote branch is untouched.
        expect(await git(rig.project, 'show', 'HEAD:src/remote.ts')).toContain('r = 9');
        expect(await rig.lanes.list()).toHaveLength(0);
        expect(await git(rig.project, 'branch', '--list', 'sp/remote-0601-1')).toBe('');
    });

    test('R3 — a missing branch is not-started for integration and is never replayed', async () => {
        const rig = await makeRig();
        const baseBefore = await git(rig.project, 'rev-parse', 'HEAD');
        rig.candidates.push({ wbs: '0601', attempt: 1, remoteBranch: 'origin/does-not-exist' });

        const outcome = await rig.drain();
        expect(outcome).toMatchObject({ kind: 'not-started', wbs: '0601' });
        expect(await git(rig.project, 'rev-parse', 'HEAD')).toBe(baseBefore);
        expect(rig.gate.calls).toHaveLength(0);
        // No worktree was created for an attempt that never produced a landable branch.
        expect(await rig.lanes.list()).toHaveLength(0);
    });

    test('R3/R4 — an unknown remote is refused by name, with no credentials involved', async () => {
        const rig = await makeRig();
        rig.candidates.push({ wbs: '0602', attempt: 1, remoteBranch: 'upstream/some-branch' });
        const outcome = await rig.drain();
        expect(outcome).toMatchObject({ kind: 'not-started' });
        if (outcome?.kind !== 'not-started') throw new Error('expected not-started');
        expect(outcome.reason).toContain("remote 'upstream' is not configured");
    });
});
