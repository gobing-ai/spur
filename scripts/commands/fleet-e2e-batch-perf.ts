/**
 * `fleet-e2e --perf --modes batch` (G76 task 1346, ADR-149 R10): measure the integration queue's
 * throughput instead of asserting it. The same four-task fixture runs twice over the REAL lane
 * service and the REAL integration queue — once with one writer (serial fleet) and once with two —
 * and the receipt records wall time, the gate's share of it, and every task's window.
 *
 * The member's thinking time and the project gate are deterministic sleeps: this lane measures the
 * orchestration, never a model, and says so in the receipt (`memberWorkMs`, `gateMs`).
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import {
    FleetIntegrationQueue,
    type IntegrationCandidate,
} from '../../packages/app/src/services/fleet-integration-queue';
import { WorktreeLaneService } from '../../packages/app/src/services/worktree-lane-service';

/** One task's measured window inside a batch run. */
export interface BatchTaskWindow {
    wbs: string;
    dispatchedAt: string;
    receiptAt: string;
    integratedAt: string;
}

/** The batch lane's receipt (design §"Receipt"); the shape is the contract. */
export interface BatchPerfReceipt {
    generatedAt: string;
    serialWallMs: number;
    parallelWallMs: number;
    /** parallel / serial — lower is better; `null` when the serial run did not complete. */
    ratio: number | null;
    /** The project gate's share of the parallel wall time (0..1). */
    gateShare: number;
    tasks: BatchTaskWindow[];
    target: number;
    pass: boolean;
    gateShardingFlag: boolean;
    /** The retired skill-path baseline: only recorded from a pre-1343 run, else null with a reason. */
    retiredSkillBaseline: { wallMs: number } | null;
    retiredSkillBaselineNote: string | null;
    memberWorkMs: number;
    gateMs: number;
    maxWriters: number;
}

/** The target ratio (G76 R10): parallel at most 0.6 of the serial fleet's wall time. */
export const BATCH_TARGET_RATIO = 0.6;

/**
 * The receipt from raw measurements. Pure, so the rules are testable without a run:
 * `pass = ratio <= 0.6`, and a gate share above half raises the sharding flag instead of
 * relaxing the gate. A failing ratio is reported, never asserted away.
 */
export function batchPerfReceipt(input: {
    serialWallMs: number;
    parallelWallMs: number;
    gateMs: number;
    tasks: BatchTaskWindow[];
    memberWorkMs: number;
    gateMsPerTask: number;
    maxWriters: number;
    now?: Date;
    retiredSkillBaseline?: { wallMs: number } | null;
}): BatchPerfReceipt {
    const ratio = input.serialWallMs > 0 ? input.parallelWallMs / input.serialWallMs : null;
    const gateShare = input.parallelWallMs > 0 ? input.gateMs / input.parallelWallMs : 0;
    return {
        generatedAt: (input.now ?? new Date()).toISOString(),
        serialWallMs: input.serialWallMs,
        parallelWallMs: input.parallelWallMs,
        ratio,
        gateShare: Number(gateShare.toFixed(4)),
        tasks: input.tasks,
        target: BATCH_TARGET_RATIO,
        pass: ratio !== null && ratio <= BATCH_TARGET_RATIO,
        // A gate that dominates the wall time is a SHARDING question for the operator — recording
        // it never weakens the gate itself.
        gateShardingFlag: gateShare > 0.5,
        retiredSkillBaseline: input.retiredSkillBaseline ?? null,
        retiredSkillBaselineNote:
            input.retiredSkillBaseline === undefined || input.retiredSkillBaseline === null
                ? 'not measured: the skill-owned worktree path was retired by G76 1343 before this lane ran'
                : null,
        memberWorkMs: input.memberWorkMs,
        gateMs: input.gateMsPerTask,
        maxWriters: input.maxWriters,
    };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

/**
 * Run the fixture once: open one lane per task, simulate the member's turn, then land each finished
 * lane through the queue. `maxWriters` bounds how many member turns overlap, which is exactly the
 * serial-vs-parallel difference this lane measures.
 */
async function runFixture(tasks: string[], maxWriters: number, memberWorkMs: number, gateMs: number) {
    const base = await mkdtemp(join(tmpdir(), 'spur-batch-perf-'));
    const repo = join(base, 'repo');
    await mkdir(join(repo, 'src'), { recursive: true });
    await writeFile(join(repo, 'src', 'seed.ts'), 'export const seed = 1;\n');
    await writeFile(join(repo, '.gitignore'), '.spur/\n');
    await git(repo, 'init', '-q', '-b', 'main');
    await git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A');
    await git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
    const db = await createMigratedDb({ url: ':memory:' });
    const lanes = new WorktreeLaneService({ projectPath: repo, laneRoot: join(base, 'lanes'), getDb: async () => db });
    const candidates: IntegrationCandidate[] = [];
    let gateTotalMs = 0;
    const queue = new FleetIntegrationQueue({
        baseBranch: 'main',
        lanes,
        getDb: async () => db,
        candidates: async () => candidates,
        runGate: async () => {
            const started = Date.now();
            await sleep(gateMs);
            gateTotalMs += Date.now() - started;
            return 'PASS';
        },
        featureOf: async () => 'G76',
        syncFeature: async () => undefined,
    });
    const windows = new Map<string, BatchTaskWindow>();
    const startedAll = Date.now();
    // Landings are serialized by design (one `integrate` claim) but they OVERLAP the remaining
    // members' work, exactly as the tick does in production: one chained promise per landing.
    let landing = Promise.resolve();
    const landWhenFinished = (wbs: string): Promise<void> => {
        landing = landing.then(async () => {
            const outcome = await queue.drainOne(repo, { ownerEpoch: 1 });
            if (outcome !== null && outcome.kind === 'landed') {
                const window = windows.get(outcome.wbs);
                if (window !== undefined) window.integratedAt = new Date().toISOString();
            } else if (outcome !== null) {
                throw new Error(`batch perf: ${wbs} did not land (${outcome.kind})`);
            }
        });
        return landing;
    };
    try {
        // Dispatch in waves of `maxWriters`: with one writer the turns are strictly serial.
        for (let index = 0; index < tasks.length; index += maxWriters) {
            const wave = tasks.slice(index, index + maxWriters);
            await Promise.all(
                wave.map(async (wbs) => {
                    const attempt = 1;
                    const lane = await lanes.open(wbs, attempt);
                    const dispatchedAt = new Date().toISOString();
                    await sleep(memberWorkMs);
                    await mkdir(join(lane.path, 'src'), { recursive: true });
                    await writeFile(join(lane.path, 'src', `${wbs}.ts`), `export const task${wbs} = ${wbs};\n`);
                    await git(lane.path, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A');
                    await git(lane.path, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', `${wbs} work`);
                    candidates.push({ wbs, attempt });
                    windows.set(wbs, {
                        wbs,
                        dispatchedAt,
                        receiptAt: new Date().toISOString(),
                        integratedAt: new Date().toISOString(),
                    });
                    await landWhenFinished(wbs);
                }),
            );
        }
        await landing;
        const wallMs = Date.now() - startedAll;
        const merges = Number(await git(repo, 'rev-list', '--count', '--merges', 'HEAD'));
        return {
            wallMs,
            gateTotalMs,
            windows: [...windows.values()].sort((a, b) => a.wbs.localeCompare(b.wbs)),
            merges,
        };
    } finally {
        await rm(base, { recursive: true, force: true });
    }
}

/**
 * Run the batch lane and write its receipt. Serial first (one writer), then parallel
 * (`maxWriters: 2`), so both runs share the fixture definition and the machine state.
 */
export async function runBatchPerf(options: { memberWorkMs?: number; gateMs?: number } = {}): Promise<{
    receipt: BatchPerfReceipt;
    receiptPath: string;
    exitCode: number;
}> {
    // Representative windows: a real pipeline turn is minutes, not milliseconds. At 2 s of member
    // work the fixture still spends >5% of its wall time in git + gate, so the ratio is conservative.
    const memberWorkMs = options.memberWorkMs ?? 2_000;
    const gateMs = options.gateMs ?? 120;
    const tasks = ['0601', '0602', '0603', '0604'];
    const serial = await runFixture(tasks, 1, memberWorkMs, gateMs);
    const parallel = await runFixture(tasks, 2, memberWorkMs, gateMs);
    const receipt = batchPerfReceipt({
        serialWallMs: serial.wallMs,
        parallelWallMs: parallel.wallMs,
        gateMs: parallel.gateTotalMs,
        tasks: parallel.windows,
        memberWorkMs,
        gateMsPerTask: gateMs,
        maxWriters: 2,
    });
    // The fixture proves itself: a merge commit would mean the landing bypassed ff-only.
    const linear = serial.merges === 0 && parallel.merges === 0;
    const receiptPath = join(
        process.cwd(),
        'docs',
        'reports',
        `fleet-perf-batch-${receipt.generatedAt.slice(0, 10)}.json`,
    );
    mkdirSync(join(process.cwd(), 'docs', 'reports'), { recursive: true });
    writeFileSync(receiptPath, `${JSON.stringify({ ...receipt, linearLandings: linear }, null, 4)}\n`);
    // A failing ratio is reported, not asserted away: the lane exits 0 when it MEASURED, and the
    // receipt carries the verdict.
    return { receipt, receiptPath, exitCode: linear ? 0 : 1 };
}

/** A stable digest of the fixture definition, so two receipts can be compared meaningfully. */
export function batchFixtureDigest(tasks: string[], memberWorkMs: number, gateMs: number): string {
    return `sha256:${createHash('sha256')
        .update(`${tasks.join(',')}|${memberWorkMs}|${gateMs}`)
        .digest('hex')}`;
}
