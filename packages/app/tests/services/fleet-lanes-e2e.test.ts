/**
 * G76 task 1341 — fleet worktree lanes and concurrent writers, end to end over a REAL git
 * repository, the REAL StrategyRuntime / FleetService / FleetDispatcher and a migrated db.
 *
 * Failure cases written first (Plan step 1):
 * - F1 two independent tasks dispatch concurrently, each into its own lane (AC1, R3)
 * - F2 overlapping declared files serialize with a `file-overlap` hold (AC2, R3)
 * - F3 a crashed orchestrator's restart reuses the lane, never opens a second (AC3, R4)
 * - F10 an orphan lane (no attempt row, no commits) is pruned by reconcile (AC3, R4)
 * plus the writer cap and the 3-tasks/2-coders/maxWriters-2 receipt (Plan step 8).
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar, type SpurConfig, spurConfigSchema } from '@gobing-ai/spur-config';
import { type DbAdapter, ProjectClaimDao, ProjectStrategyDao, SystemEventDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { parse as yamlParse } from 'yaml';
import {
    FLEET_AUTO_TAG,
    FleetDispatcher,
    type FleetReceipt,
    FleetService,
    normalizeProjectPath,
    ProjectRegistry,
    StrategyRuntime,
    type TaskSummary,
} from '../../src/index';
import { InboxService } from '../../src/services/inbox-service';
import { laneBranch, lanePath, WorktreeLaneService } from '../../src/services/worktree-lane-service';
import { createMigratedDb } from '../helpers';

const EXECUTORS_YAML = `agent:
  executors:
    - name: writer
      agent: claude
      executionCapabilities:
        version: 1
        axes:
          fsWrite:
            state: available
            provenance: native-known
`;

function git(cwd: string, ...args: string[]): string {
    const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
    return res.stdout.trim();
}

function taskBody(wbs: string, files: string[]): string {
    return `---\nwbs: "${wbs}"\n---\n\n## ${wbs}. t\n\n### Design\n\nTouches ${files.map((f) => `\`${f}\``).join(', ')}.\n\n### Plan\n\n1. do it\n`;
}

interface Rig {
    project: string;
    db: DbAdapter;
    runtime: StrategyRuntime;
    claims: ProjectClaimDao;
    /** Test-controlled terminal receipts by message id (a member "finishing" its run). */
    settle: (wbs: string, status: FleetReceipt['status']) => Promise<void>;
    restart: () => StrategyRuntime;
    lanes: WorktreeLaneService;
    cleanup: () => Promise<void>;
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const fn of cleanups.splice(0)) await fn();
});

async function makeRig(opts: {
    maxWriters: number;
    coders: number;
    tasks: Record<string, string[]>;
    /** Member ids bound as attached occupants (ADR-146), handshook and idle. */
    attached?: string[];
}): Promise<Rig> {
    const base = await mkdtemp(join(tmpdir(), 'spur-lanes-'));
    const repo = join(base, 'repo');
    await mkdir(join(repo, '.spur'), { recursive: true });
    await mkdir(join(repo, 'src'), { recursive: true });
    await mkdir(join(repo, 'tasks'), { recursive: true });
    for (const name of ['a.ts', 'b.ts', 'c.ts', 'shared.ts']) await writeFile(join(repo, 'src', name), '// x\n');
    const candidates: TaskSummary[] = [];
    for (const [wbs, files] of Object.entries(opts.tasks)) {
        const filePath = join(repo, 'tasks', `${wbs}_t.md`);
        await writeFile(filePath, taskBody(wbs, files));
        candidates.push({
            wbs,
            name: `task ${wbs}`,
            status: 'todo',
            filePath,
            dependencies: [],
            feature_id: null,
            frontmatter: { tags: [FLEET_AUTO_TAG], priority: 'P1' },
        } as TaskSummary);
    }
    await writeFile(join(repo, '.gitignore'), '.spur/\n');
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A');
    git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
    const project = normalizeProjectPath(repo);

    const members = [
        { id: 'orch', role: 'planner', purpose: 'orchestrator', executor: 'writer' },
        ...Array.from({ length: opts.coders }, (_, i) => ({ id: `coder${i + 1}`, executor: 'writer' })),
    ];
    const baseCfg = spurConfigSchema.parse(yamlParse(EXECUTORS_YAML));
    const spurConfig: SpurConfig = spurConfigSchema.parse({
        ...baseCfg,
        agent: {
            ...baseCfg.agent,
            fleet: { enabled: true, members, orchestrator: 'orch', maxWriters: opts.maxWriters },
        },
    });
    const db = await createMigratedDb();
    await new ProjectStrategyDao(db).set(project, 'gtd');
    const claims = new ProjectClaimDao(db);

    const settled = new Map<string, FleetReceipt['status']>();
    const inbox = new InboxService({ getDb: async () => db });
    const inner = new FleetDispatcher({
        coordination: {
            sendMessage: async (
                fromId: string | null,
                toId: string,
                body: string,
                _r?: string,
                requestKey?: string,
            ) => {
                const taskId = /^fleet:task:([^:]+):/.exec(requestKey ?? '')?.[1];
                const { message, replayed } = await inbox.send({
                    from: fromId ?? 'operator',
                    to: toId,
                    body,
                    kind: 'request',
                    ...(requestKey !== undefined ? { requestKey } : {}),
                    ...(taskId !== undefined ? { taskId } : {}),
                });
                return { msgId: message.id, toId, status: 'queued' as const, injected: false, replayed, requestKey };
            },
            getMessage: async (msgId: string) => {
                const row = await inbox.get(msgId);
                return row === null
                    ? null
                    : { id: row.id, toId: row.toId, status: row.status, requestKey: row.requestKey };
            },
        },
        runs: { listByMessageId: async () => [] },
    } as unknown as ConstructorParameters<typeof FleetDispatcher>[0]);
    const dispatcher = {
        enqueue: inner.enqueue.bind(inner),
        receipt: async (messageId: string, member: string): Promise<FleetReceipt | null> => {
            const status = settled.get(messageId);
            return status === undefined ? inner.receipt(messageId, member) : { status, messageId };
        },
    } as unknown as FleetDispatcher;
    const fleet = new FleetService({
        spurConfig,
        fs: createNodeFileSystem(project),
        registry: new ProjectRegistry(join(project, '.spur', 'registry.json')),
        openDb: async () => db,
    });
    const build = () =>
        new StrategyRuntime({
            openDb: async () => db,
            tasks: { list: async (q?: { status?: string }) => candidates.filter((c) => c.status === q?.status) },
            ready: async () => true,
            fleet,
            dependencyBlocked: async () => null,
            dispatcher,
            ...(opts.attached !== undefined
                ? {
                      memberAttachments: async (ids: string[]) =>
                          new Map(
                              ids.map((id) => [
                                  id,
                                  opts.attached?.some((a) => id.endsWith(a))
                                      ? { handshake: true, draining: false, stageEligible: true }
                                      : null,
                              ]),
                          ),
                  }
                : {}),
        });
    // The orchestrator claim is held under the binding's resolved instance id.
    const orch = await fleet.resolveOrchestrator(project);
    await claims.claim(project, 'orchestrator', orch.instanceId ?? 'orch', 60_000);
    const cleanup = async () => {
        await rm(base, { recursive: true, force: true });
    };
    cleanups.push(cleanup);
    return {
        project,
        db,
        runtime: build(),
        claims,
        restart: build,
        settle: async (wbs, status) => {
            const latest = (await inbox.attempts(wbs)).latest;
            if (latest === null) throw new Error(`no attempt for ${wbs}`);
            settled.set(latest.id, status);
        },
        lanes: new WorktreeLaneService({ projectPath: project, getDb: async () => db }),
        cleanup,
    };
}

const tickOpts = { ownerEpoch: 1, orchestratorId: 'proj-orch' };

async function laneEvents(db: DbAdapter, name: string): Promise<Array<Record<string, unknown>>> {
    const rows = await new SystemEventDao(db).query({ names: [name], limit: 100 });
    return rows.map((row) => JSON.parse(row.payload_json ?? '{}') as Record<string, unknown>);
}

describe('fleet lanes (G76 1341)', () => {
    test('F1: two independent tasks dispatch concurrently into isolated lanes', async () => {
        const rig = await makeRig({ maxWriters: 2, coders: 2, tasks: { '0101': ['src/a.ts'], '0102': ['src/b.ts'] } });
        const report = await rig.runtime.tick(rig.project, tickOpts);
        expect(report.dispatched.map((d) => d.taskId).sort()).toEqual(['0101', '0102']);
        const listed = await rig.lanes.list();
        expect(listed.map((lane) => lane.branch).sort()).toEqual([laneBranch('0101', 1), laneBranch('0102', 1)]);
        for (const lane of listed) expect(existsSync(join(lane.path, '.spur', 'run'))).toBe(true);
        // Two lane-keyed write claims in the BASE db, one per lane realpath.
        const writes = await rig.claims.listBySlot('write');
        expect(writes.map((w) => w.projectPath).sort()).toEqual(listed.map((l) => l.path).sort());
        expect(new Set(writes.map((w) => w.holderId)).size).toBe(2);
        expect((await laneEvents(rig.db, 'fleet.lane.opened')).length).toBe(2);
        rig.runtime.stop();
    });

    test('F2: overlapping declared files serialize with a file-overlap hold', async () => {
        const rig = await makeRig({
            maxWriters: 2,
            coders: 2,
            tasks: { '0201': ['src/shared.ts', 'src/a.ts'], '0202': ['src/shared.ts'] },
        });
        const first = await rig.runtime.tick(rig.project, tickOpts);
        expect(first.dispatched.map((d) => d.taskId)).toEqual(['0201']);
        expect(first.holds).toContainEqual({ wbs: '0202', reason: 'file-overlap', detail: '0201 src/shared.ts' });
        // The first lands a terminal receipt → its claim releases → the overlap clears.
        await rig.settle('0201', 'completed');
        expect((await rig.runtime.observe(rig.project, { ownerEpoch: 1 })).released.length).toBe(1);
        const second = await rig.runtime.tick(rig.project, tickOpts);
        expect(second.dispatched.map((d) => d.taskId)).toEqual(['0202']);
        rig.runtime.stop();
    });

    test('writer cap holds the third candidate at maxWriters', async () => {
        const rig = await makeRig({
            maxWriters: 2,
            coders: 3,
            tasks: { '0301': ['src/a.ts'], '0302': ['src/b.ts'], '0303': ['src/c.ts'] },
        });
        const report = await rig.runtime.tick(rig.project, tickOpts);
        expect(report.dispatched.length).toBe(2);
        expect(report.holds).toContainEqual({ wbs: '0303', reason: 'writer-cap', detail: '2/2' });
        rig.runtime.stop();
    });

    test('R5: an attached occupant takes no lane write dispatch', async () => {
        const rig = await makeRig({ maxWriters: 2, coders: 1, tasks: { '0351': ['src/a.ts'] }, attached: ['coder1'] });
        const report = await rig.runtime.tick(rig.project, tickOpts);
        expect(report.dispatched).toEqual([]);
        expect(report.holds[0]?.reason).toBe('member-busy');
        expect(report.holds[0]?.detail).toContain('lane mode: attached occupants take read/review turns only');
        expect(await rig.lanes.list()).toEqual([]);
        rig.runtime.stop();
    });

    test('F3: an orchestrator restart mid-dispatch reuses the lane and never opens a second', async () => {
        const rig = await makeRig({ maxWriters: 2, coders: 2, tasks: { '0401': ['src/a.ts'] } });
        expect((await rig.runtime.tick(rig.project, tickOpts)).dispatched.length).toBe(1);
        rig.runtime.stop();
        // "Crash": a fresh runtime with no in-memory state re-ticks the same project.
        const restarted = rig.restart();
        const report = await restarted.tick(rig.project, tickOpts);
        expect(report.dispatched).toEqual([]);
        expect(report.holds).toContainEqual(
            expect.objectContaining({ wbs: '0401', reason: 'dispatch-in-flight' }) as never,
        );
        const listed = await rig.lanes.list();
        expect(listed.map((l) => l.branch)).toEqual([laneBranch('0401', 1)]);
        const reopened = (await laneEvents(rig.db, 'fleet.lane.opened')).filter((e) => e.reused === true);
        expect(reopened.length).toBeGreaterThan(0);
        // open() itself is idempotent per (wbs, attempt).
        const again = await rig.lanes.open('0401', 1);
        expect(again.reused).toBe(true);
        expect((await rig.lanes.list()).length).toBe(1);
        restarted.stop();
    });

    test('a failed receipt releases the claim and retains the lane', async () => {
        const rig = await makeRig({ maxWriters: 1, coders: 1, tasks: { '0501': ['src/a.ts'] } });
        await rig.runtime.tick(rig.project, tickOpts);
        await rig.settle('0501', 'failed');
        await rig.runtime.observe(rig.project, { ownerEpoch: 1 });
        expect(await rig.claims.listBySlot('write')).toEqual([]);
        expect((await rig.lanes.list()).length).toBe(1);
        expect(await laneEvents(rig.db, 'fleet.lane.retained')).toContainEqual(
            expect.objectContaining({ wbs: '0501', attempt: 1, reason: 'failed' }) as never,
        );
        rig.runtime.stop();
    });

    test('F10: reconcile prunes an orphan lane with no attempt row and no commits', async () => {
        const rig = await makeRig({ maxWriters: 2, coders: 1, tasks: {} });
        const orphan = await rig.lanes.open('0999', 1);
        expect(existsSync(orphan.path)).toBe(true);
        await rig.runtime.tick(rig.project, tickOpts); // write-side resume reconciles
        expect(existsSync(orphan.path)).toBe(false);
        expect(await rig.lanes.list()).toEqual([]);
        expect(git(rig.project, 'branch', '--list', laneBranch('0999', 1))).toBe('');
        expect(lanePath(rig.project, undefined, '0999', 1)).toBe(orphan.path);
        rig.runtime.stop();
    });

    test('receipt: 3 independent tasks on 2 coders with maxWriters 2 → peak 2 lanes, zero orphans', async () => {
        const rig = await makeRig({
            maxWriters: 2,
            coders: 2,
            tasks: { '0601': ['src/a.ts'], '0602': ['src/b.ts'], '0603': ['src/c.ts'] },
        });
        let peak = 0;
        const order: string[] = [];
        for (let turn = 0; turn < 6 && order.length < 3; turn++) {
            const report = await rig.runtime.tick(rig.project, tickOpts);
            order.push(...report.dispatched.map((d) => d.taskId ?? ''));
            peak = Math.max(peak, (await rig.claims.listBySlot('write')).length);
            for (const wbs of report.dispatched.map((d) => d.taskId ?? '')) await rig.settle(wbs, 'completed');
            await rig.runtime.observe(rig.project, { ownerEpoch: 1 });
        }
        // Success leaves the lanes for the 1342 queue; reconcile must not count them orphans.
        await rig.restart().resume(rig.project);
        const lanes = await rig.lanes.list();
        const receipt = {
            task: '1341',
            maxWriters: 2,
            coders: 2,
            tasks: 3,
            dispatchOrder: order,
            peakConcurrentLanes: peak,
            lanesAfterReconcile: lanes.length,
            orphansAfterReconcile: lanes.filter((lane) => !order.includes(lane.wbs)).length,
        };
        expect(receipt.orphansAfterReconcile).toBe(0);
        expect(order.sort()).toEqual(['0601', '0602', '0603']);
        expect(peak).toBe(2);
        expect(lanes.length).toBe(3);
        if (getEnvVar('SPUR_WRITE_LANES_RECEIPT') === '1') {
            await writeFile(
                join(import.meta.dir, '../../../../docs/reports/fleet-lanes-p1.json'),
                `${JSON.stringify(receipt, null, 4)}\n`,
            );
        }
        rig.runtime.stop();
    });
});
