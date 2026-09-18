/**
 * Task 0896 — persistent fleet member sessions in the spur agent loop (G66).
 * docs/design/session-pinned-dispatch.md §6: a member keeps ONE coding-agent
 * session for the loop's lifetime, in the warmest mode its agent supports —
 * persistent stdin (one `TeamAgentProcess`), resume-by-id (previous drain's
 * session id), or one-shot (today's behavior + one lifetime warning).
 *
 * These tests stub the agent service run (mock emits the invoke lifecycle and
 * writes the run→session mapping rows) and the persistent process (the
 * `memberProcessFactory` seam) — no real agent CLI is spawned. 0831/0834
 * delivery semantics are asserted alongside: a resumed session never
 * redelivers a settled message.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentCoordinationService } from '@gobing-ai/spur-app';
import { spurConfigSchema } from '@gobing-ai/spur-config';
import {
    createMigratedDb,
    type DbAdapter,
    InboxMessageDao,
    RunSessionDao,
    SystemEventDao,
} from '@gobing-ai/spur-domain';
import { type AgentProcessOptions, saveAgentSpec } from '@gobing-ai/ts-ai-runner';
import { type MemberAgentProcess, runAgentLoop, selectsPersistentStdinDispatch } from '../../src/commands/agent';
import { type CliContext, createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';

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

/** In-memory fake of the runner's `TeamAgentProcess` (G66 R2) — records every interaction. */
export class FakeMemberProcess implements MemberAgentProcess {
    readonly sends: string[] = [];
    started = 0;
    stopped = 0;
    status: 'running' | 'stopped' | 'errored' = 'running';
    constructor(readonly options: AgentProcessOptions) {}
    async start(): Promise<void> {
        this.started++;
    }
    async stop(): Promise<void> {
        this.stopped++;
        this.status = 'stopped';
    }
    async send(message: string): Promise<{ ok: boolean }> {
        this.sends.push(message);
        return { ok: true };
    }
    getStatus(): 'running' | 'stopped' | 'errored' {
        return this.status;
    }
    getExitCode(): number | null {
        return this.status === 'errored' ? 1 : null;
    }
}

interface SessionRig {
    ctx: CliContext;
    customCtx: CliContext;
    db: DbAdapter;
    dao: SystemEventDao;
    inbox: InboxMessageDao;
    runSessions: RunSessionDao;
    tempDir: string;
    output: CommandOutput & { stdout: string[]; stderr: string[] };
    /** Every mock `svc.run` invocation: the prompt it got and the flags it ran with. */
    runs: Array<{ prompt: string | undefined; flags: Record<string, string | boolean> }>;
    /** When set, every mock run exits with this nonzero code (R4/R7 failed drains). */
    failExitCode: number | null;
    /** One-shot hook: resolved when the mock run is ENTERED (let the test enqueue mid-run). */
    notifyRun?: () => void;
    /**
     * Hold the NEXT mock run at its entry (before it emits invoke.exit), so the
     * test can enqueue work and only then let the run finish. Necessary because
     * the exit row wakes the next iteration within milliseconds — faster than
     * the test's own db writes commit.
     */
    holdNextRun: () => void;
    /** Release the run held by {@link holdNextRun}. */
    gateRun: () => void;
    cleanup: () => void;
}

interface RigOptions {
    /** Nonzero exit code for every mock run (failed-drain scenarios). */
    failExitCode?: number;
    /**
     * `executor`: the spec is materialized with `executor: 'writer'` and the
     * context carries a project config mapping writer→omp (G66 R1's real
     * fleet path). Default: a bare spec whose `type` IS the binary.
     */
    specKind?: 'type' | 'executor';
}

/** Temp project + migrated in-memory db + loop context whose `agentService.run` is a mock. */
export async function makeSessionRig(specType: string, opts: RigOptions = {}): Promise<SessionRig> {
    const tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-session-'));
    const db = await createMigratedDb({ url: ':memory:' });
    const output = captureOutput();
    const ctx = createCliContext({
        cwd: tempDir,
        output,
        db,
        ...(opts.specKind === 'executor'
            ? {
                  // The executor entry names the runner-known binary (G66 R1).
                  spurConfig: spurConfigSchema.parse({
                      agent: { executors: [{ name: 'writer', agent: specType }] },
                  }),
              }
            : {}),
    });
    if (opts.specKind === 'executor') {
        // Executor-carrying specs bypass `AgentSpecInput` (0537's materialized shape).
        await saveAgentSpec(
            {
                id: 'member',
                name: 'member',
                type: specType,
                executor: 'writer',
                workspace: tempDir,
                purpose: `${specType} agent`,
                tags: [],
                config: {},
            },
            join(tempDir, '.spur', 'agents'),
        );
    } else {
        await new AgentCoordinationService(ctx).createAgentSpec({ id: 'member', type: specType });
    }

    const runs: Array<{ prompt: string | undefined; flags: Record<string, string | boolean> }> = [];
    const runSessions = new RunSessionDao(db);
    let invocation = 0;
    const pendingGates: Array<() => void> = [];
    let holdRun: Promise<void> | undefined;
    const rig: SessionRig = {
        ctx,
        customCtx: {
            ...ctx,
            agentService: (serviceOptions?: { events?: { emit: (name: string, payload: unknown) => void } }) =>
                ({
                    run: async (prompt: string | undefined, flags: Record<string, string | boolean>) => {
                        invocation += 1;
                        const n = invocation;
                        runs.push({ prompt, flags });
                        const notified = rig.notifyRun;
                        rig.notifyRun = undefined;
                        notified?.();
                        // Optional test gate: hold here (before the exit event) so
                        // the test can enqueue the next request deterministically.
                        const gate = holdRun;
                        holdRun = undefined;
                        if (gate !== undefined) await gate;
                        // The real runner emits the invoke lifecycle on the loop's
                        // bus; the exit payload carries the run id correlation the
                        // loop reads for session capture (G66 R1).
                        serviceOptions?.events?.emit('agent.invoke.start', {
                            agent: 'member',
                            operation: 'prompt',
                            severity: 'info',
                        });
                        serviceOptions?.events?.emit('agent.invoke.exit', {
                            agent: 'member',
                            operation: 'prompt',
                            exitCode: opts.failExitCode ?? 0,
                            durationMs: 1,
                            correlation: { runId: `run-${n}` },
                            severity: 'info',
                        });
                        // The real observer writes the run→session mapping in
                        // executeRun's finally — before `svc.run` resolves.
                        await runSessions.insert({
                            runId: `run-${n}`,
                            source: specType,
                            sessionId: `sess-${n}`,
                            exactness: 'exact',
                            mechanism: 'observed',
                            resolvedAt: new Date().toISOString(),
                        });
                        return opts.failExitCode ?? 0;
                    },
                }) as unknown as ReturnType<CliContext['agentService']>,
        } as CliContext,
        db,
        dao: new SystemEventDao(db),
        inbox: new InboxMessageDao(db),
        runSessions,
        tempDir,
        output,
        runs,
        failExitCode: opts.failExitCode ?? null,
        holdNextRun: () => {
            holdRun = new Promise<void>((resolve) => {
                pendingGates.push(resolve);
            });
        },
        // FIFO: releases the run currently held; a gate armed for a NOT-YET-ENTERED
        // run stays pending until its own release.
        gateRun: () => {
            pendingGates.shift()?.();
        },
        cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
    };
    return rig;
}

/** Insert a ledger row directly (producer emissions are covered in packages/app tests). */
export async function insertWake(rig: SessionRig, eventName: string, payload: Record<string, unknown>): Promise<void> {
    await rig.dao.insert({
        id: crypto.randomUUID(),
        event_name: eventName,
        occurred_at: new Date().toISOString(),
        actor: 'test',
        payload_json: JSON.stringify(payload),
    });
}

/** All member-session reset rows, parsed, oldest first. */
export async function resetRows(rig: SessionRig): Promise<Array<Record<string, unknown> & { reason?: string }>> {
    const rows = await rig.dao.query({ names: ['fleet.member-session-reset'], limit: 100 });
    return rows.map((row) => JSON.parse(row.payload_json ?? '{}') as Record<string, unknown> & { reason?: string });
}

export async function waitForCondition(check: () => boolean, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
        if (Date.now() > deadline) throw new Error('condition not met in time');
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

describe('agent loop member sessions (G66, task 0896)', () => {
    test('resume mode: the second drain re-opens the first drain session; settled messages never redeliver (R1/R5)', async () => {
        const rig = await makeSessionRig('codex'); // capability record: resume-by-id only
        try {
            await rig.inbox.enqueue('operator', 'member', 'first request');
            let runEntered = false;
            rig.notifyRun = () => {
                runEntered = true;
            };
            rig.holdNextRun(); // run 1 waits at its entry
            // Backstop-driven iterations (50ms poll): every drain deterministically
            // picks up whatever is queued, with spare iterations absorbing the
            // post-work empty drains.
            const loop = runAgentLoop(rig.customCtx, { spec: 'member', poll: '50' }, { maxIterations: 4 });
            await waitForCondition(() => runEntered); // run 1 held mid-flight (drain 1 done)
            // Deliver request two while run 1 is held: iteration 2's drain sees it.
            await rig.inbox.enqueue('operator', 'member', 'second request');
            rig.gateRun();
            await waitForCondition(() => rig.runs.length === 2); // run 2 completed
            const code = await loop;
            expect(code).toBe(0);
            expect(rig.runs).toHaveLength(2);
            // R1: the first drain runs fresh; the second re-opens the first session.
            expect(rig.runs[0]?.flags['session-id']).toBeUndefined();
            expect(rig.runs[1]?.flags['session-id']).toBe('sess-1');
            // R5: distinct delivery — each body ran exactly once, nothing redelivered.
            expect(rig.runs[0]?.prompt).toContain('first request');
            expect(rig.runs[1]?.prompt).toContain('second request');
            const inboxRows = await rig.inbox.inbox('member');
            expect(inboxRows.every((m) => m.status === 'delivered')).toBe(true);
            // R5: reconcile-before-first-drain (0834) is untouched and still reported.
            expect(rig.output.stdout.join('\n')).toContain('reconcile: scanned=');
        } finally {
            rig.cleanup();
        }
    }, 15000);

    test('one-shot mode: fresh run per drain with exactly ONE member-no-session warning per member lifetime (R3)', async () => {
        const rig = await makeSessionRig('claude-code'); // no capability record → one-shot
        try {
            await rig.inbox.enqueue('operator', 'member', 'first request');
            let runEntered = false;
            rig.notifyRun = () => {
                runEntered = true;
            };
            rig.holdNextRun(); // run 1 waits at its entry
            const loop = runAgentLoop(rig.customCtx, { spec: 'member', poll: '50' }, { maxIterations: 4 });
            await waitForCondition(() => runEntered); // run 1 held mid-flight (drain 1 done)
            await rig.inbox.enqueue('operator', 'member', 'second request');
            rig.gateRun();
            await waitForCondition(() => rig.runs.length === 2); // run 2 completed
            const code = await loop;
            expect(code).toBe(0);
            expect(rig.runs).toHaveLength(2);
            // Two independent runs: neither carries a session id.
            for (const run of rig.runs) expect(run.flags['session-id']).toBeUndefined();
            // R3: the warning fires once for the loop lifetime, not once per drain.
            const warnings = rig.output.stderr.filter((line) => line.includes('member-no-session'));
            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toContain('claude-code');
        } finally {
            rig.cleanup();
        }
    }, 15000);

    test('operator stop ends an active resume session deliberately (reason: operator) (R4)', async () => {
        const rig = await makeSessionRig('codex');
        try {
            await rig.inbox.enqueue('operator', 'member', 'only request');
            const code = await runAgentLoop(rig.customCtx, { spec: 'member', poll: '50' }, { maxIterations: 1 });
            expect(code).toBe(0);
            expect(rig.runs).toHaveLength(1);
            // The loop shutdown reset is recorded with the session mode it ended.
            const resets = await resetRows(rig);
            expect(resets).toHaveLength(1);
            expect(resets[0]).toMatchObject({ reason: 'operator', mode: 'resume' });
        } finally {
            rig.cleanup();
        }
    }, 15000);

    test('three consecutive failed drains reset the poisoned session (reason: failed-drains) (R4/R7)', async () => {
        const rig = await makeSessionRig('codex', { failExitCode: 1 });
        try {
            // One request per drain: a drain claims the WHOLE inbox (one merged
            // prompt), so each next request is enqueued while the previous run is
            // held at its entry — before its exit row wakes the next iteration.
            await rig.inbox.enqueue('operator', 'member', 'fail one');
            let runEntered = false;
            rig.notifyRun = () => {
                runEntered = true;
            };
            rig.holdNextRun();
            const loop = runAgentLoop(rig.customCtx, { spec: 'member', poll: '50' }, { maxIterations: 5 });
            await waitForCondition(() => runEntered); // run 1 held (drain 1 via backstop)
            await rig.inbox.enqueue('operator', 'member', 'fail two');
            rig.holdNextRun(); // run 2 gates too
            rig.gateRun();
            await waitForCondition(() => rig.runs.length === 2); // run 2 entered+held
            await rig.inbox.enqueue('operator', 'member', 'fail three');
            rig.gateRun(); // release run 2; iteration 3 drains fail three
            await waitForCondition(() => rig.runs.length === 3); // run 3 completed
            const code = await loop;
            expect(code).toBe(0);
            expect(rig.runs).toHaveLength(3);
            // R7: the poisoned session keeps being resumed UNTIL the limit hits —
            // drain 2 resumes sess-1, drain 3 resumes sess-2 (the observed failure
            // pattern), and no fourth drain happens.
            expect(rig.runs[0]?.prompt).toContain('fail one');
            expect(rig.runs[1]?.prompt).toContain('fail two');
            expect(rig.runs[2]?.prompt).toContain('fail three');
            expect(rig.runs[1]?.flags['session-id']).toBe('sess-1');
            expect(rig.runs[2]?.flags['session-id']).toBe('sess-2');
            const resets = await resetRows(rig);
            expect(resets).toHaveLength(1);
            expect(resets[0]).toMatchObject({ reason: 'failed-drains', mode: 'resume', failedDrains: 3 });
            // The counter restarted with the fresh session: teardown adds no row
            // (no process, no id) — exactly one reset for the whole run.
        } finally {
            rig.cleanup();
        }
    }, 15000);

    test('real argv gate: the upstream-wired shim engages persistent over the resolved dispatch argv (Review P2/P3)', async () => {
        // omp's capability record declares supportsPersistentStdin and the packed
        // upstream runner now dispatches the rpc argv (`omp --mode rpc`, no print
        // positional). The argv-shape gate must therefore resolve persistent and
        // drive BOTH drains through one long-lived fixture process — no executor
        // run, no degradation warning, and the factory options carry the shim's
        // rpc stdin framer so real TeamAgentProcess.send frames each prompt.
        const rig = await makeSessionRig('omp', { specKind: 'executor' });
        const processes: FakeMemberProcess[] = [];
        try {
            await rig.inbox.enqueue('operator', 'member', 'writer request');
            const loop = runAgentLoop(
                rig.customCtx,
                { spec: 'member', poll: '50' },
                {
                    maxIterations: 2,
                    memberProcessFactory: (options) => {
                        const fake = new FakeMemberProcess(options);
                        processes.push(fake);
                        // The shim's persistentStdinProtocol rides the process options.
                        expect(typeof options.stdinFramer).toBe('function');
                        expect(JSON.parse(options.stdinFramer?.('probe') ?? '')).toEqual({
                            type: 'prompt',
                            message: 'probe',
                        });
                        return fake;
                    },
                },
            );
            await waitForCondition(() => processes[0]?.sends.length === 1);
            await rig.inbox.enqueue('operator', 'member', 'second turn');
            await waitForCondition(() => processes[0]?.sends.length === 2);
            await loop;
            // One long-lived process: a single start, both turns over stdin.
            expect(processes).toHaveLength(1);
            expect(processes[0]?.started).toBe(1);
            expect(processes[0]?.sends[0]).toContain('writer request');
            expect(processes[0]?.sends[1]).toContain('second turn');
            // The member never went through the executor runner.
            expect(rig.runs).toHaveLength(0);
            expect(rig.output.stderr.join('\n')).not.toContain('member-persistent-stdin-unwired');
            // Teardown records the session in the mode it actually ran: persistent.
            const resets = await resetRows(rig);
            expect(resets).toHaveLength(1);
            expect(resets[0]).toMatchObject({ reason: 'operator', mode: 'persistent' });
        } finally {
            rig.cleanup();
        }
    }, 15000);

    test('argv-shape gate: only a stdin-dispatch argv engages persistent (Review P3, fixture argv)', () => {
        // Marker present — the upstream-wired shapes: rpc listener (pi/omp) and
        // claude's stream-json input (which legitimately rides -p: its CLI
        // requires print for --input-format) — the gate opens.
        expect(selectsPersistentStdinDispatch(['omp', '--no-session', '--input-format', 'stream-json'])).toBe(true);
        expect(selectsPersistentStdinDispatch(['pi', '--mode', 'rpc'])).toBe(true);
        expect(
            selectsPersistentStdinDispatch([
                'claude',
                '-p',
                '--input-format',
                'stream-json',
                '--output-format',
                'stream-json',
            ]),
        ).toBe(true);
        // No selector → one-shot print argv — the legacy 0.4.68 shapes — stays shut.
        const ompPrint = ['omp', '--no-session', '-p', '<preamble>', '--mode', 'text'];
        expect(selectsPersistentStdinDispatch(ompPrint)).toBe(false);
        expect(selectsPersistentStdinDispatch(['claude', '-p', '<p>', '--output-format', 'text'])).toBe(false);
    });

    test('restart: persistent process exited between drains resets the session and respawns (G66 R2/R4)', async () => {
        // The long-lived member process died under the unchanged restart policy:
        // the next drain reports the exit as a `restart` reset (run record with
        // the exit code), then spawns a fresh process — never a send into a
        // corpse. The dead process is not stopped again (it already exited).
        const rig = await makeSessionRig('omp', { specKind: 'executor' });
        const processes: FakeMemberProcess[] = [];
        try {
            await rig.inbox.enqueue('operator', 'member', 'first');
            const loop = runAgentLoop(
                rig.customCtx,
                { spec: 'member', poll: '50' },
                {
                    maxIterations: 2,
                    memberProcessFactory: (options) => {
                        const fake = new FakeMemberProcess(options);
                        processes.push(fake);
                        return fake;
                    },
                },
            );
            await waitForCondition(() => processes[0]?.sends.length === 1);
            // The first process dies before drain 2 (exit code 1 per the class
            // contract): the next ensure observes it and resets + respawns.
            if (processes[0]?.status === 'running') processes[0].status = 'errored';
            await rig.inbox.enqueue('operator', 'member', 'second');
            await waitForCondition(() => processes[1]?.sends.length === 1);
            await loop;
            expect(processes).toHaveLength(2);
            expect(processes[0]?.sends[0]).toContain('first');
            expect(processes[1]?.sends[0]).toContain('second');
            expect(processes[0]?.stopped).toBe(0); // already exited — no stop
            expect(processes[1]?.stopped).toBe(1); // teardown stops the live one
            const resets = await resetRows(rig);
            expect(resets).toHaveLength(2); // restart row + the teardown operator row
            const reasons = Object.fromEntries(resets.map((row) => [row.reason, row]));
            expect(reasons.restart).toMatchObject({ mode: 'persistent', exitCode: 1 });
            expect(reasons.operator).toMatchObject({ mode: 'persistent' });
        } finally {
            rig.cleanup();
        }
    }, 15000);

    test('idle member loop records no session churn: no warning, no resets (G66 §6)', async () => {
        // With nothing to drain the session machinery stays untouched: the
        // one-shot warning and reset records only ever follow real state.
        const rig = await makeSessionRig('codex');
        try {
            const code = await runAgentLoop(rig.customCtx, { spec: 'member', poll: '10' }, { maxIterations: 1 });
            expect(code).toBe(0);
            expect(rig.runs).toHaveLength(0);
            expect(rig.output.stderr.join('\n')).not.toContain('member-no-session');
            expect(await resetRows(rig)).toHaveLength(0);
        } finally {
            rig.cleanup();
        }
    }, 15000);
});
