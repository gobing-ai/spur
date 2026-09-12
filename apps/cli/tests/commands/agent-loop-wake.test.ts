/**
 * Task 0839 — event-driven orchestrator wakeup (wake-then-drain).
 *
 * The loop waits on the `system_events` ledger (R4) for one of four wake
 * sources (R1) and drains only after a wake or the `--poll` backstop (R5);
 * an idle wake records an operator-readable hold row, on-change-only (R3).
 * The backstop here is deliberately long (`5000`): a test that passes fast
 * proves the WAKE ended the wait — a regression to unconditional sleeping
 * hangs into the bun test timeout instead of passing slowly.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetAgentServiceShimsForTest, type SystemEventBus, TeamService } from '@gobing-ai/spur-app';
import { createMigratedDb, type DbAdapter, InboxMessageDao, SystemEventDao } from '@gobing-ai/spur-domain';
import { EventBus } from '@gobing-ai/ts-infra';
import { runAgentLoop } from '../../src/commands/agent';
import { type CliContext, createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';
import { attachSystemEventLedger } from '../../src/system-event-ledger';

function captureOutput(): CommandOutput & { stdout: string[]; stderr: string[] } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return {
        stdout,
        stderr,
        write: (msg: string) => {
            stdout.push(msg);
        },
        error: (msg: string) => {
            stderr.push(msg);
        },
    };
}

interface WakeRig {
    ctx: CliContext;
    customCtx: CliContext;
    db: DbAdapter;
    dao: SystemEventDao;
    inbox: InboxMessageDao;
    tempDir: string;
    output: CommandOutput & { stdout: string[]; stderr: string[] };
    run: ReturnType<typeof mock>;
    cleanup: () => void;
}

/** Temp project + migrated in-memory db + loop context whose `run` is a mock. */
async function makeRig(opts?: { corpus?: boolean }): Promise<WakeRig> {
    const tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-wake-'));
    const db = await createMigratedDb({ url: ':memory:' });
    const output = captureOutput();
    const ctx = createCliContext({ cwd: tempDir, output, db });
    const team = new TeamService(ctx);
    await team.createAgentSpec({ id: 'wake-worker', type: 'claude-code' });
    if (opts?.corpus === true) {
        // Minimal planning corpus so `recordIdleHold` can produce REAL holds
        // (the default `rest` strategy holds every ready candidate).
        mkdirSync(join(tempDir, 'docs', 'tasks'), { recursive: true });
        writeFileSync(
            join(tempDir, 'docs', 'tasks', '0840_wake-target.md'),
            [
                '---',
                'schema_version: 1',
                'name: Wake target',
                'status: todo',
                'template: feature-impl',
                'created_at: 2026-09-12T00:00:00.000Z',
                '---',
                '',
                '# Wake target',
                '',
                'Body.',
                '',
            ].join('\n'),
        );
    }
    const run = mock((_prompt: string | undefined) => Promise.resolve(0));
    const customCtx = {
        ...ctx,
        agentService: (serviceOptions?: { events?: { emit: (name: string, payload: unknown) => void } }) =>
            ({
                run: (prompt: string | undefined) => {
                    // The real runner emits the acceptance lifecycle event; the
                    // mock fires it on the loop's bus so claims settle `delivered`.
                    serviceOptions?.events?.emit('agent.invoke.start', {
                        agent: 'wake-worker',
                        operation: 'prompt',
                        severity: 'info',
                    });
                    return run(prompt);
                },
            }) as unknown as ReturnType<CliContext['agentService']>,
    };
    return {
        ctx,
        customCtx,
        db,
        dao: new SystemEventDao(db),
        inbox: new InboxMessageDao(db),
        tempDir,
        output,
        run,
        cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
    };
}

/** Insert a ledger row directly (producer emissions are covered in packages/app tests). */
async function insertWake(rig: WakeRig, eventName: string, payload: Record<string, unknown>): Promise<void> {
    await rig.dao.insert({
        id: crypto.randomUUID(),
        event_name: eventName,
        occurred_at: new Date().toISOString(),
        actor: 'test',
        payload_json: JSON.stringify(payload),
    });
}

/**
 * Run ONE loop iteration against a long backstop, inserting the wake event once
 * the loop is inside its wait. Returns the elapsed ms — a passing wake wait is
 * fast; only a broken wake falls through to the 5s backstop.
 */
async function runOneWokenIteration(
    rig: WakeRig,
    insert: (rig: WakeRig) => Promise<void>,
    flags: Record<string, string | boolean> = {},
): Promise<number> {
    const started = Date.now();
    const loop = runAgentLoop(rig.customCtx, { spec: 'wake-worker', poll: '5000', ...flags }, { maxIterations: 1 });
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the loop reach its wait
    await insert(rig);
    const code = await loop;
    expect(code).toBe(0);
    return Date.now() - started;
}

beforeEach(() => {
    _resetAgentServiceShimsForTest();
});

describe('agent loop wake sources (0839 R1)', () => {
    test('message.sent wakes the loop: the queued request drains and runs once', async () => {
        // The organic human-request path: a ledger-attached TeamService send
        // persists the `message.sent` fact, the wake drains the inbox, and the
        // agent runs with the body — no polling tick in between.
        const rig = await makeRig();
        try {
            const bus = new EventBus() as SystemEventBus;
            await attachSystemEventLedger(bus, rig.ctx);
            const team = new TeamService({ ...rig.ctx, eventBus: bus } as unknown as CliContext);

            const elapsed = await runOneWokenIteration(rig, async () => {
                await team.sendMessage('operator', 'wake-worker', 'wake up and process task #7');
            });
            expect(elapsed).toBeLessThan(2500); // woke on the event, not the backstop
            expect(rig.run).toHaveBeenCalledTimes(1);
            const prompt = rig.run.mock.calls[0]?.[0] as string;
            expect(prompt).toContain('wake up and process task #7');
            // Work ran — no idle hold row accompanies a dispatch.
            expect(await rig.dao.query({ names: ['fleet.idle-hold'], limit: 10 })).toHaveLength(0);
        } finally {
            rig.cleanup();
        }
    });

    test('strategy.changed wakes the loop (R1 strategy change)', async () => {
        const rig = await makeRig();
        try {
            const elapsed = await runOneWokenIteration(rig, (r) =>
                insertWake(r, 'strategy.changed', { projectPath: r.tempDir, strategy: 'gtd', version: 2 }),
            );
            expect(elapsed).toBeLessThan(2500);
            expect(rig.run).toHaveBeenCalledTimes(0); // wake, drain empty — no dispatch
        } finally {
            rig.cleanup();
        }
    });

    test('fleet.capacity.changed wakes the loop (R1 capacity change)', async () => {
        const rig = await makeRig();
        try {
            const elapsed = await runOneWokenIteration(rig, (r) =>
                insertWake(r, 'fleet.capacity.changed', {
                    projectPath: r.tempDir,
                    change: 'release',
                    holderId: 'other-orchestrator',
                }),
            );
            expect(elapsed).toBeLessThan(2500);
            expect(rig.run).toHaveBeenCalledTimes(0);
        } finally {
            rig.cleanup();
        }
    });

    test('agent.invoke.exit wakes the loop (R1 completion receipt)', async () => {
        const rig = await makeRig();
        try {
            const elapsed = await runOneWokenIteration(rig, (r) =>
                insertWake(r, 'agent.invoke.exit', {
                    agent: 'wake-worker',
                    operation: 'drain',
                    exitCode: 0,
                    runId: crypto.randomUUID(),
                }),
            );
            expect(elapsed).toBeLessThan(2500);
            expect(rig.run).toHaveBeenCalledTimes(0);
        } finally {
            rig.cleanup();
        }
    });
});

describe('agent loop backstop and idle holds (0839 R3/R5)', () => {
    test('backstop still drains a pre-queued message when no wake event arrives (R5)', async () => {
        const rig = await makeRig();
        try {
            // Inbox row only — no ledger event, so the drain is backstop-driven.
            await rig.inbox.enqueue('operator', 'wake-worker', 'queued before the loop started');
            const code = await runAgentLoop(rig.customCtx, { spec: 'wake-worker', poll: '100' }, { maxIterations: 1 });
            expect(code).toBe(0);
            expect(rig.run).toHaveBeenCalledTimes(1);
            expect(rig.run.mock.calls[0]?.[0]).toContain('queued before the loop started');
        } finally {
            rig.cleanup();
        }
    });

    test('steady idle writes exactly ONE hold row across three wakes (on-change-only, R3)', async () => {
        const rig = await makeRig({ corpus: true });
        try {
            const code = await runAgentLoop(rig.customCtx, { spec: 'wake-worker', poll: '50' }, { maxIterations: 3 });
            expect(code).toBe(0);
            expect(rig.run).toHaveBeenCalledTimes(0); // idle wakes dispatch nothing (R2)
            const rows = await rig.dao.query({ names: ['fleet.idle-hold'], limit: 10 });
            expect(rows).toHaveLength(1);
            const payload = JSON.parse(rows[0]?.payload_json ?? '{}') as {
                projectPath: string;
                source: string;
                holdKey: string;
                holds: Array<{ wbs: string; reason: string }>;
            };
            expect(payload.projectPath).toBe(realpathSync(rig.tempDir));
            expect(payload.source).toBe('backstop-timeout');
            expect(payload.holds).toEqual([{ wbs: '0840', reason: 'rest-after-drain' }]);
            expect(payload.holdKey).toBe('0840:rest-after-drain');
            expect(rows[0]?.actor).toBe('wake-worker');
        } finally {
            rig.cleanup();
        }
    });

    test('a run resets the hold: the next idle stretch writes a fresh row (R3)', async () => {
        const rig = await makeRig({ corpus: true });
        try {
            // it1: backstop → empty drain → hold row 1. Then a request arrives:
            // the event wakes the loop, work runs, the hold key resets. it3:
            // backstop → empty drain → a fresh hold row despite the same reason.
            const loop = runAgentLoop(rig.customCtx, { spec: 'wake-worker', poll: '100' }, { maxIterations: 3 });
            // Wait for iteration 1's hold row, then deliver the request.
            const deadline = Date.now() + 5000;
            while ((await rig.dao.query({ names: ['fleet.idle-hold'], limit: 10 })).length === 0) {
                if (Date.now() > deadline) throw new Error('no hold row after first idle wake');
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
            await rig.inbox.enqueue('operator', 'wake-worker', 'resetting work');
            await insertWake(rig, 'message.sent', { msgId: 'm1', fromId: 'operator', toId: 'wake-worker' });
            const code = await loop;
            expect(code).toBe(0);
            expect(rig.run).toHaveBeenCalledTimes(1);
            const rows = await rig.dao.query({ names: ['fleet.idle-hold'], limit: 10 });
            expect(rows).toHaveLength(2);
            const secondPayload = JSON.parse(rows[1]?.payload_json ?? '{}') as { holdKey: string };
            expect(secondPayload.holdKey).toBe('0840:rest-after-drain'); // same reason, fresh row
        } finally {
            rig.cleanup();
        }
    });

    test('the cursor never replays: an idle iteration after a run does not re-run (R4)', async () => {
        const rig = await makeRig();
        try {
            // it1: backstop → drains and runs the pre-queued message.
            // it2: the consumed event is behind the cursor and the message is
            // settled → no re-run, no replay.
            await rig.inbox.enqueue('operator', 'wake-worker', 'run exactly once');
            const code = await runAgentLoop(rig.customCtx, { spec: 'wake-worker', poll: '100' }, { maxIterations: 2 });
            expect(code).toBe(0);
            expect(rig.run).toHaveBeenCalledTimes(1);
        } finally {
            rig.cleanup();
        }
    });
});
