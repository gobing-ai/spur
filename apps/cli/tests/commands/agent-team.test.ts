import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentCoordinationService, DeliveryReconciler, FleetService, ProjectRegistry } from '@gobing-ai/spur-app';
import { loadSpurConfig } from '@gobing-ai/spur-config/loader';
import type { AgentProcessOptions, DoctorResult } from '@gobing-ai/ts-ai-runner';
import { RequestKeyConflictError } from '@gobing-ai/ts-db';
import { EventBus } from '@gobing-ai/ts-infra';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { main } from '../../src';
import { type AgentRunDeps, type MemberAgentProcess, runAgentLoop, runAgentRun } from '../../src/commands/agent';
import { type CliContext, createCliContext } from '../../src/context';
import { createCapturedOutput } from '../helpers';

async function makeCtx(env: Record<string, string | undefined> = {}): Promise<{
    ctx: CliContext;
    cwd: string;
    out: ReturnType<typeof createCapturedOutput>;
    cleanup: () => Promise<void>;
}> {
    const cwd = await mkdtemp(join(tmpdir(), 'spur-agent-team-'));
    const out = createCapturedOutput();
    const ctx = createCliContext({ cwd, output: out, env, dbUrl: ':memory:' });
    return { ctx, cwd, out, cleanup: async () => rm(cwd, { recursive: true, force: true }) };
}

/**
 * In-memory fake of the runner's `TeamAgentProcess` (0896 R2 test seam) —
 * records every interaction without spawning a real agent CLI. `sendOk`
 * models a member whose stdin send never reaches the agent (0831
 * not-started).
 */
class FakeMemberProcess implements MemberAgentProcess {
    readonly sends: string[] = [];
    started = 0;
    stopped = 0;
    status: 'running' | 'stopped' | 'errored' = 'running';
    constructor(
        readonly options: AgentProcessOptions,
        private readonly sendOk = true,
    ) {}
    async start(): Promise<void> {
        this.started++;
    }
    async stop(): Promise<void> {
        this.stopped++;
        this.status = 'stopped';
    }
    async send(message: string): Promise<{ ok: boolean }> {
        this.sends.push(message);
        return { ok: this.sendOk };
    }
    getStatus(): 'running' | 'stopped' | 'errored' {
        return this.status;
    }
    getExitCode(): number | null {
        return this.status === 'errored' ? 1 : null;
    }
}

describe('spur agent list --specs', () => {
    test('lists created specs', async () => {
        const { ctx, cwd, out, cleanup } = await makeCtx();
        try {
            await new AgentCoordinationService(ctx).createAgentSpec({ id: 'coder', type: 'codex', purpose: 'code' });
            const code = await main(['agent', 'list', '--specs'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toContain('coder');
        } finally {
            await cleanup();
        }
    });

    test('--json includes spec paths', async () => {
        const { ctx, cwd, out, cleanup } = await makeCtx();
        try {
            await new AgentCoordinationService(ctx).createAgentSpec({ id: 'coder', type: 'codex' });
            const code = await main(['agent', 'list', '--specs', '--json'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            const payload = JSON.parse(out.messages.at(-1) ?? '{}');
            expect(payload.specs[0].id).toBe('coder');
            expect(payload.specs[0].path).toBe('.spur/agents/coder.yaml');
        } finally {
            await cleanup();
        }
    });

    test('0544 R2/R4: --specs shows role and executor as distinct fields, unset when undeclared', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await mkdir(join(cwd, '.spur'), { recursive: true });
            await writeFile(
                join(cwd, '.spur', 'config.yaml'),
                [
                    'agent:',
                    '  executors:',
                    '    - name: cheap-exec',
                    '      agent: pi',
                    '      tier: cheap',
                    '    - name: capable-exec',
                    '      agent: claude',
                    '      tier: capable-1',
                    // 0858: the roster is declared under the project's `agent.fleet`
                    // section (the retired `.spur/fleet.json` now fails the load).
                    '  fleet:',
                    '    enabled: true',
                    '    members:',
                    '      - role: reviewer',
                    '      - executor: cheap-exec',
                    '',
                ].join('\n'),
                'utf8',
            );
            const fresh = createCliContext({ cwd, output: out, dbUrl: ':memory:' });
            // The instance id derives from the project's registry display name, so the
            // fixture registers one explicitly (a temp-dir basename is not a valid
            // agent-id prefix). FleetService.materialize also asserts launch ground
            // truth: the process cwd must BE the project it materializes (0835 R6).
            const registry = new ProjectRegistry(join(cwd, '.spur', 'registry.json'));
            await registry.upsert({ name: 'alpha', path: cwd });
            const previousCwd = process.cwd();
            process.chdir(cwd);
            try {
                await new FleetService({
                    ...fresh,
                    roles: fresh.agentRoles,
                    registry,
                    reloadAgentConfig: () => loadSpurConfig(cwd),
                }).materialize(cwd);
            } finally {
                process.chdir(previousCwd);
            }

            // Human: distinct role and executor columns; undeclared role renders `unset`.
            out.messages.length = 0;
            const code = await main(['agent', 'list', '--specs'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            const human = out.messages.join('\n');
            expect(human).toContain('reviewer');
            expect(human).toContain('capable-exec');
            expect(human).toContain('unset');

            // JSON: role and executor are distinct fields; role omitted when undeclared.
            out.messages.length = 0;
            await main(['agent', 'list', '--specs', '--json'], { cwd, output: out, dbUrl: ':memory:' });
            const payload = JSON.parse(out.messages.at(-1) ?? '{}');
            const reviewer = payload.specs.find((s: { id: string }) => s.id === 'alpha-reviewer-1');
            expect(reviewer?.role).toBe('reviewer');
            expect(reviewer?.executor).toBe('capable-exec');
            const plain = payload.specs.find((s: { id: string }) => s.id === 'alpha-cheap-exec');
            expect(plain?.role).toBeUndefined();
            expect(plain?.executor).toBe('cheap-exec');
        } finally {
            await cleanup();
        }
    });

    test('reports no specs on an empty project', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['agent', 'list', '--specs'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toMatch(/No agent specs found/);
        } finally {
            await cleanup();
        }
    });
});

describe('spur agent run --drain', () => {
    type MockRunner = {
        runPromptCommand(
            _agent: unknown,
            opts: { input?: string },
        ): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }>;
    };
    type MockDetector = {
        detectOne(_agent: string): Promise<{ version: string }>;
    };
    type MockDoctor = {
        runOne(_agent: string): Promise<DoctorResult>;
        runAll(): Promise<DoctorResult[]>;
    };
    // A doctor double that reports a usable claude for both explicit and auto resolution.
    function fakeDoctor() {
        const result = {
            agent: 'claude',
            installed: true,
            version: '1',
            authenticated: 'authenticated',
            usable: true,
            tier: 1 as const,
            channels: [],
            error: null,
        };
        return { runOne: async () => result, runAll: async () => [result] };
    }

    test('folds pending messages into the prompt and maps spec id to type', async () => {
        const { ctx, cleanup } = await makeCtx();
        try {
            // Seed the spec + a pending message through the SAME ctx so they live in
            // the one cached :memory: DB that `--drain` reads (driving the flow via
            // main() opens a fresh DB per call, so drain would never see the message —
            // the whole point of team-mode is that the drained message reaches the runner).
            const team = new AgentCoordinationService(ctx);
            await team.createAgentSpec({ id: 'planner', type: 'claude' });
            await team.sendMessage('operator', 'planner', 'remember to drain me');

            let receivedInput = '';
            let receivedAgent: unknown;
            const fakeRunner = {
                runPromptCommand: async (agent: unknown, opts: { input?: string }) => {
                    receivedAgent = agent;
                    receivedInput = opts.input ?? '';
                    return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 };
                },
            };
            const fakeDetector = { detectOne: async () => ({ version: '1' }) };

            const code = await runAgentRun('do work', ctx, { agent: 'planner', drain: true, json: true }, {
                runner: fakeRunner as MockRunner,
                detector: fakeDetector as MockDetector,
                doctorRunner: fakeDoctor() as MockDoctor,
            } as unknown as AgentRunDeps);
            expect(code).toBe(0);
            // End-to-end team-mode: the pending message body is folded into the prompt
            // ahead of the operator's instruction, and the spec id 'planner' was mapped
            // to its runner type 'claude' so resolution succeeded.
            expect(receivedInput).toContain('remember to drain me');
            expect(receivedInput).toContain('do work');
            expect(receivedInput.indexOf('remember to drain me')).toBeLessThan(receivedInput.indexOf('do work'));
            expect(receivedAgent).toBe('claude');
        } finally {
            await cleanup();
        }
    });

    test('R1 (0529) — drain keeps spec-id, persisting an occupant pin', async () => {
        const { ctx, cleanup } = await makeCtx();
        try {
            const team = new AgentCoordinationService(ctx);
            await team.createAgentSpec({ id: 'reviewer', type: 'claude' });

            const fakeRunner = {
                runPromptCommand: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
            };
            const code = await runAgentRun('do work', ctx, { agent: 'reviewer', drain: true, json: true }, {
                runner: fakeRunner as MockRunner,
                detector: { detectOne: async () => ({ version: '1' }) } as MockDetector,
                doctorRunner: fakeDoctor() as MockDoctor,
            } as unknown as AgentRunDeps);
            expect(code).toBe(0);

            // drainIntoPrompt set flags['spec-id'] before rewriting agent → executeRun
            // persisted an occupant addressable by specId, with the coding-agent kind.
            const occupant = await ctx.agentService().getOccupant({ specId: 'reviewer' });
            expect(occupant).not.toBeNull();
            expect(occupant?.specId).toBe('reviewer');
            expect(occupant?.agentKind).toBe('claude');
        } finally {
            await cleanup();
        }
    });

    test('errors when --drain has no explicit --agent but still runs', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            const code = await runAgentRun('hi', ctx, { drain: true, json: true }, {
                runner: {
                    runPromptCommand: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
                } as MockRunner,
                detector: { detectOne: async () => ({ version: '1' }) } as MockDetector,
                doctorRunner: fakeDoctor() as MockDoctor,
            } as unknown as AgentRunDeps);
            // Drain warns + no-ops; run proceeds via auto resolution, so exit is 0.
            expect(code).toBe(0);
            // 0542 R1: the drain recipient is addressed via --spec <id>.
            expect(out.errors.join('\n')).toMatch(/--drain requires an explicit --spec/);
        } finally {
            await cleanup();
        }
    });

    // ── agent loop — the persistent self-draining wrapper (0258 R6) ──

    test('loop drains the inbox, runs the agent, and consumes the message (idempotent)', async () => {
        // 0896 with the upstream-wired shims: claude's persistent argv passes the
        // argv-shape gate, so the drained prompt rides the member process seam
        // (fixture factory — no real CLI). A successful send IS delivery
        // acceptance (0831): the row settles `delivered`, so the follow-up drain
        // is empty — once-consumed stays once-delivered.
        const { ctx, out, cleanup } = await makeCtx();
        const started = captureInvokeStart();
        try {
            const team = new AgentCoordinationService(ctx);
            await team.createAgentSpec({ id: 'planner', type: 'claude' });
            await team.sendMessage('operator', 'planner', 'loop message');

            const processes: FakeMemberProcess[] = [];
            let runs = 0;
            const deps = {
                runner: {
                    runPromptCommand: async () => {
                        runs++;
                        // The real runner emits `agent.invoke.start` at spawn
                        // time; the fake fires the same seam (0896 Review P2:
                        // the member runs the resume path after the argv-gate
                        // degradation, so acceptance rides the run lifecycle).
                        started.fire();
                        return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 };
                    },
                } as MockRunner,
                detector: { detectOne: async () => ({ version: '1' }) } as MockDetector,
                doctorRunner: fakeDoctor() as MockDoctor,
            } as unknown as AgentRunDeps;

            const code = await runAgentLoop(
                ctx,
                { spec: 'planner', poll: '10' },
                {
                    maxIterations: 1,
                    memberProcessFactory: (options) => {
                        const process = new FakeMemberProcess(options);
                        processes.push(process);
                        return process;
                    },
                },
                deps,
            );
            expect(code).toBe(0);
            // Persistent engaged: the fixture process took the drained prompt
            // over stdin; the run path never ran.
            expect(processes).toHaveLength(1);
            expect(processes[0]?.sends[0]).toContain('loop message');
            expect(runs).toBe(0);
            expect(out.errors.join('\n')).not.toContain('member-persistent-stdin-unwired');

            // The started delivery settles the message `delivered`: a follow-up
            // drain is empty — the loop won't re-run the same message next
            // iteration (once-consumed stays once-delivered).
            const after = await team.drainPending('planner');
            expect(after.count).toBe(0);
        } finally {
            started.restore();
            await cleanup();
        }
    });

    test('0839: idle backstop wakes never run the agent and honor maxIterations', async () => {
        const { ctx, cleanup } = await makeCtx();
        try {
            const team = new AgentCoordinationService(ctx);
            await team.createAgentSpec({ id: 'planner', type: 'claude' });

            let runs = 0;
            const deps = {
                runner: {
                    runPromptCommand: async () => {
                        runs++;
                        return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 };
                    },
                } as MockRunner,
                detector: { detectOne: async () => ({ version: '1' }) } as MockDetector,
                doctorRunner: fakeDoctor() as MockDoctor,
            } as unknown as AgentRunDeps;

            const code = await runAgentLoop(ctx, { spec: 'planner', poll: '10' }, { maxIterations: 3 }, deps);
            expect(code).toBe(0);
            expect(runs).toBe(0); // nothing to drain → never ran the agent
        } finally {
            await cleanup();
        }
    });

    test('loop requires an explicit --spec (rejects auto)', async () => {
        const { ctx, cleanup } = await makeCtx();
        try {
            const code = await runAgentLoop(ctx, { spec: 'auto' }, { maxIterations: 1 });
            expect(code).toBe(2);
        } finally {
            await cleanup();
        }
    });

    test('loop honors a numeric --poll as the backstop timeout (parseLoopPoll valid path)', async () => {
        // 0839: --poll is the wake backstop. A numeric value flows through
        // parseLoopPoll's finite-positive branch and bounds the first wait.
        const { ctx, cleanup } = await makeCtx();
        try {
            const code = await runAgentLoop(ctx, { spec: 'planner', poll: '10' }, { maxIterations: 1 });
            expect(code).toBe(0);
        } finally {
            await cleanup();
        }
    });

    test('the wake wait completes on a 1ms backstop when no wake event arrives', async () => {
        // poll='1' keeps the backstop wait to ~1ms; the loop drains (nothing) and
        // exits after one iteration.
        const { ctx, cleanup } = await makeCtx();
        try {
            const code = await runAgentLoop(ctx, { spec: 'planner', poll: '1' }, { maxIterations: 1 });
            expect(code).toBe(0);
        } finally {
            await cleanup();
        }
    });

    test('the wake wait resolves early when the abort signal fires mid-wait', async () => {
        // poll='5000' would wait 5s; aborting after 10ms cuts the wake wait
        // (loopSleep's signal abort listener), then the loop exits on the next
        // while-condition check. No maxIterations — the signal is the stop.
        const { ctx, cleanup } = await makeCtx();
        try {
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), 10);
            try {
                const code = await runAgentLoop(ctx, { spec: 'planner', poll: '5000' }, { signal: ac.signal });
                expect(code).toBe(0);
            } finally {
                clearTimeout(timer);
            }
        } finally {
            await cleanup();
        }
    });
});

type G6MockRunner = {
    runPromptCommand(
        _agent: unknown,
        opts: { input?: string },
    ): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }>;
};
type G6MockDetector = {
    detectOne(_agent: string): Promise<{ version: string }>;
};
type G6MockDoctor = {
    runOne(_agent: string): Promise<DoctorResult>;
    runAll(): Promise<DoctorResult[]>;
};
function g6Doctor() {
    const result = {
        agent: 'claude',
        installed: true,
        version: '1',
        authenticated: 'authenticated' as const,
        usable: true,
        tier: 1 as const,
        channels: [],
        error: null,
    };
    return { runOne: async () => result, runAll: async () => [result] };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Delivery-settle regression block. Grew out of the G6 characterization block
// (task 0828): probes 1 and 2 asserted today's broken delivery behavior and
// were FLIPPED by task 0831 to assert the fixed commit-after-confirm contract.
// Probe 3 (duplicate submission) was flipped by task 0832 into a regression
// asserting idempotent suppression. Probe 4 (at-most-once claiming) keeps
// asserting the MET SQL property.
// ═══════════════════════════════════════════════════════════════════════════════
import { CoordinationRunDao, createMigratedDb, InboxMessageDao } from '@gobing-ai/spur-domain';

/**
 * Capture the handlers registered for `agent.invoke.start` while a test runs.
 * The fake runner does not emit the lifecycle event (that is the real AiRunner's
 * job, wired through `context.agentService({ events })`), so this seams the
 * subscription directly: `fire()` invokes every handler registered for
 * `agent.invoke.start` on ANY EventBus — the same moment the real runner emits
 * at spawn time. Mirror of `EventBus.prototype.on`; failed subscriptions skip.
 */
function captureInvokeStart(): { restore: () => void; fire: (operation?: string) => void } {
    const proto = EventBus.prototype as unknown as {
        on: (event: string, handler: (...args: unknown[]) => void, opts?: unknown) => void;
    };
    const origOn = proto.on;
    const handlers: Array<(operation: string) => void> = [];
    proto.on = function (event, handler, opts) {
        if (event === 'agent.invoke.start') {
            handlers.push((operation) => handler({ agent: 'claude', operation, severity: 'info' }));
        }
        return origOn.call(this, event, handler, opts);
    };
    return {
        restore: () => {
            proto.on = origOn;
        },
        fire: (operation = 'prompt') => {
            for (const fire of handlers) fire(operation);
        },
    };
}

describe('G61 delivery settle regressions (0831)', () => {
    test.each(['run', 'loop'])('%s: a started version probe cannot acknowledge an unstarted prompt', async (mode) => {
        const { ctx, cleanup } = await makeCtx();
        const accepted = captureInvokeStart();
        try {
            const team = new AgentCoordinationService(ctx);
            await team.createAgentSpec({ id: 'planner', type: 'claude' });
            const sent = await team.sendMessage('operator', 'planner', 'must reach the prompt');
            const deps = {
                runner: {
                    runPromptCommand: async () => {
                        accepted.fire('version');
                        throw new Error('prompt spawn failed');
                    },
                } as G6MockRunner,
                detector: { detectOne: async () => ({ version: '1' }) } as G6MockDetector,
                doctorRunner: g6Doctor() as G6MockDoctor,
            } as unknown as AgentRunDeps;
            if (mode === 'run') {
                await runAgentRun('work', ctx, { agent: 'planner', drain: true, json: true }, deps);
            } else {
                // 0896: the loop member is persistent-stdin (claude capability
                // record), so the loop has no spawn/probe step — the same 0831
                // invariant applies at its acceptance boundary: a drain whose
                // stdin send never reaches the member (`send` not ok) is NOT a
                // delivery and must release the row for redelivery.
                await runAgentLoop(
                    ctx,
                    { spec: 'planner', poll: '1' },
                    {
                        maxIterations: 1,
                        memberProcessFactory: (options) => new FakeMemberProcess(options, false),
                    },
                    deps,
                );
            }
            expect(await new InboxMessageDao(await ctx.getDb()).getById(sent.msgId)).toMatchObject({
                status: 'queued',
                injectAttempts: 1,
            });
        } finally {
            accepted.restore();
            await cleanup();
        }
    });

    test('a successful drain+invocation settles the message delivered (R2 — was 0828 probe 1)', async () => {
        // The claim happens before spawn, but 0831's settle step runs after the
        // invocation attempt. Delivery state is final only after the run, and an
        // accepted run settles delivered (exit code irrelevant to delivery).
        const { ctx, cleanup } = await makeCtx();
        const accepted = captureInvokeStart();
        try {
            const team = new AgentCoordinationService(ctx);
            await team.createAgentSpec({ id: 'planner', type: 'claude' });
            await team.sendMessage('operator', 'planner', 'characterize me');
            const db = await ctx.getDb();

            let claims = 0;
            const deps = {
                runner: {
                    runPromptCommand: async () => {
                        claims++;
                        accepted.fire();
                        return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 };
                    },
                } as G6MockRunner,
                detector: { detectOne: async () => ({ version: '1' }) } as G6MockDetector,
                doctorRunner: g6Doctor() as G6MockDoctor,
            } as unknown as AgentRunDeps;

            const code = await runAgentRun('work', ctx, { agent: 'planner', drain: true, json: true }, deps);
            expect(code).toBe(0);
            expect(claims).toBe(1);

            // Fixed contract: the invocation ran, so the message settles delivered —
            // not stranded at 'injected' forever.
            const rows = await new InboxMessageDao(db).inbox('planner', 10);
            expect(rows.length).toBe(1);
            expect(rows[0]?.status).toBe('delivered');
            expect((await team.drainPending('planner')).count).toBe(0);
            expect((await new DeliveryReconciler(ctx).reconcile('planner')).unresolved[0]?.reason).toBe(
                'run-exit-only',
            );
        } finally {
            accepted.restore();
            await cleanup();
        }
    });

    test('a drain whose invocation never starts releases the row to queued, attempts preserved (R1)', async () => {
        // Spawn never reaches the runner: the spec's `type` is not an invocable
        // agent name, so validateAgentSelector rejects AFTER the drain (exit 2,
        // pre-spawn) — the claim happened inside drainIntoPrompt, and the settle
        // step must release it for redelivery within the attempt budget.
        const { ctx, cleanup } = await makeCtx();
        try {
            const team = new AgentCoordinationService(ctx);
            await team.createAgentSpec({ id: 'planner', type: 'bogus-exec' });
            await team.sendMessage('operator', 'planner', 'release me');
            const db = await ctx.getDb();

            const deps = {
                detector: { detectOne: async () => ({ version: '1' }) } as G6MockDetector,
                doctorRunner: g6Doctor() as G6MockDoctor,
            } as unknown as AgentRunDeps;

            const code = await runAgentRun('work', ctx, { spec: 'planner', drain: true, json: true }, deps);
            expect(code).toBe(2);

            const dao = new InboxMessageDao(db);
            const rows = await dao.inbox('planner', 10);
            expect(rows.length).toBe(1);
            // Released back to queued — redeliverable, attempts preserved (the
            // claim counter IS the budget; release never resets it).
            expect(rows[0]?.status).toBe('queued');
            expect(rows[0]?.injectAttempts).toBe(1);
            expect((await team.drainPending('planner')).count).toBe(1);
            const again = await dao.inbox('planner', 10);
            expect(again[0]?.injectAttempts).toBe(2);
        } finally {
            await cleanup();
        }
    });

    test('a never-started invocation in the loop is redelivered within the budget, then rests failed (R3, R4)', async () => {
        // maxIterations=3, the member's invocation never starts (0896 Review
        // P2: the installed claude shim cannot dispatch persistent stdin, so
        // the member runs the resume path and never-started surfaces at the
        // invocation boundary): claims 1 and 2 release for the next iteration;
        // claim 3
        // exhausts MAX_INJECT_ATTEMPTS and rests the row at failed with a
        // queryable reason. The loop keeps iterating — no iteration is lost, and
        // the message is not consumed-without-execution.
        const { ctx, out, cleanup } = await makeCtx();
        try {
            const team = new AgentCoordinationService(ctx);
            await team.createAgentSpec({ id: 'planner', type: 'codex' }); // resume path — no persistent-stdin claim
            await team.sendMessage('operator', 'planner', 'will never start');
            const db = await ctx.getDb();

            let runs = 0;
            const deps = {
                runner: {
                    runPromptCommand: async () => {
                        runs++;
                        // NO `agent.invoke.start` — the invocation never starts
                        // (the fake models the real runner's pre-spawn crash).
                        return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 };
                    },
                } as G6MockRunner,
                detector: { detectOne: async () => ({ version: '1' }) } as G6MockDetector,
                doctorRunner: g6Doctor() as G6MockDoctor,
            } as unknown as AgentRunDeps;

            const code = await runAgentLoop(ctx, { spec: 'planner', poll: '10' }, { maxIterations: 3 }, deps);
            expect(code).toBe(0);
            // Three drains, three never-started invocations — one per redelivery.
            expect(runs).toBe(3);
            // The member kept resume mode: no degradation was reported.
            expect(out.errors.join('\n')).not.toContain('member-persistent-stdin-unwired');

            const dao = new InboxMessageDao(db);
            let rows = await dao.inbox('planner', 10);
            expect(rows.length).toBe(1);
            // Terminal failed state with a reason — not stranded at 'injected'.
            expect(rows[0]?.status).toBe('failed');
            expect(rows[0]?.injectAttempts).toBe(3);
            expect(rows[0]?.injectError).toContain('never started');
            // Budget exhausted: no further redelivery.
            expect((await team.drainPending('planner')).count).toBe(0);
            rows = await dao.inbox('planner', 10);
            expect(rows.length).toBe(1);
        } finally {
            await cleanup();
        }
    });

    test('an invocation that started settles delivered even on a nonzero exit (R2, R5)', async () => {
        // Acceptance is detected from the `agent.invoke.start` lifecycle event on
        // the run bus — never from the exit code. The fake runner does not emit
        // the event (that is the real AiRunner's job), so this test drives the
        // subscription seam directly: capture the handlers registered for
        // `agent.invoke.start` on any EventBus while the run executes, and fire
        // them from inside the runner — the same moment the real runner emits.
        const { ctx, cleanup } = await makeCtx();
        const captured = captureInvokeStart();
        try {
            const team = new AgentCoordinationService(ctx);
            await team.createAgentSpec({ id: 'planner', type: 'claude' });
            await team.sendMessage('operator', 'planner', 'start then fail');
            const db = await ctx.getDb();

            let calls = 0;
            const deps = {
                runner: {
                    runPromptCommand: async () => {
                        calls++;
                        // Emit the acceptance signal BEFORE the nonzero exit —
                        // the real runner emits `agent.invoke.start` at spawn time.
                        captured.fire();
                        return { exitCode: 7, stdout: '', stderr: 'nonzero but started', durationMs: 1 };
                    },
                } as G6MockRunner,
                detector: { detectOne: async () => ({ version: '1' }) } as G6MockDetector,
                doctorRunner: g6Doctor() as G6MockDoctor,
            } as unknown as AgentRunDeps;

            const code = await runAgentRun('work', ctx, { agent: 'planner', drain: true, json: true }, deps);
            // The run's failure is the run's to report — the exit code surfaces
            // (executeRun maps a nonzero runner exit onto its own failure code).
            expect(code).not.toBe(0);
            expect(calls).toBe(1);

            // Delivery: settled delivered because the invocation STARTED, exit
            // code irrelevant (0831 R2/Q&A — no delivery/run-outcome conflation).
            const rows = await new InboxMessageDao(db).inbox('planner', 10);
            expect(rows.length).toBe(1);
            expect(rows[0]?.status).toBe('delivered');
        } finally {
            captured.restore();
            await cleanup();
        }
    });

    test('regression (was 0828 probe 3, flipped by 0832): a repeated request key suppresses duplicate rows and duplicate deliveries', async () => {
        // Boundary: AgentCoordinationService.sendMessage → InboxMessageDao.enqueueIdempotent
        // (ts-db 0.4.65, partial unique index idx_inbox_messages_request_key).
        const { ctx, cleanup } = await makeCtx();
        try {
            const db = await ctx.getDb();
            const dao = new InboxMessageDao(db);
            const team = new AgentCoordinationService(ctx);
            await team.createAgentSpec({ id: 'planner', type: 'claude' });

            const first = await team.sendMessage('operator', 'planner', 'same body', undefined, 'retry-key-1');
            const second = await team.sendMessage('operator', 'planner', 'same body', undefined, 'retry-key-1');

            // Same receipt identity, marked replayed — no second row exists.
            expect(second.msgId).toBe(first.msgId);
            expect(first.replayed).toBe(false);
            expect(second.replayed).toBe(true);
            const rows = await dao.inbox('planner', 10);
            expect(rows.length).toBe(1);
            expect(rows[0]?.requestKey).toBe('retry-key-1');

            // One delivery for the repeated key: the drain emits exactly one row.
            const drained = await team.drainPending('planner');
            expect(drained.messages).toHaveLength(1);
            expect(await dao.countPending('planner')).toBe(0);

            // Same key + different payload fails loudly — never a silent overwrite
            // nor a second identity.
            await expect(
                team.sendMessage('operator', 'planner', 'different body', undefined, 'retry-key-1'),
            ).rejects.toThrow(RequestKeyConflictError);
            expect((await dao.inbox('planner', 10)).length).toBe(1);
        } finally {
            await cleanup();
        }
    });

    test('probe competing consumers: the same queued row is claimed at most once on the shared adapter', async () => {
        // Two AgentCoordinationService instances share one SQLite connection/db (two configs of
        // the same consumer process). Boundary: InboxMessageDao.drainPending's
        // conditional UPDATE ... WHERE status='queued' ... RETURNING (ts-db 0.4.62).
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const dao = new InboxMessageDao(db);
            await dao.enqueue('operator', 'planner', 'consumed once');
            await dao.enqueue('operator', 'planner', 'consumed twice');
            const a = new AgentCoordinationService({
                cwd: process.cwd(),
                env: {},
                output: { write: () => {}, error: () => {} },
                getDb: async () => db,
                fs: createNodeFileSystem(process.cwd()),
            });
            const b = new AgentCoordinationService({
                cwd: process.cwd(),
                env: {},
                output: { write: () => {}, error: () => {} },
                getDb: async () => db,
                fs: createNodeFileSystem(process.cwd()),
            });

            const [aRows, bRows] = await Promise.all([a.drainPending('planner'), b.drainPending('planner')]);
            const claimed = [...aRows.messages, ...bRows.messages];
            // Observed: exactly the two distinct rows; no row appears on both sides.
            expect(claimed.map((m) => m.id).length).toBe(new Set(claimed.map((m) => m.id)).size);
            expect(claimed.length).toBe(2);
            const rows = await dao.inbox('planner', 10);
            for (const row of rows) expect(row.injectAttempts).toBe(1);

            // Target invariant met on this seam: the claim is statement-atomic —
            // duplicate consumption of the same row does NOT occur here. Recorded
            // residual risk for the report: this holds per DB statement; a
            // non-SQLite adapter or a drain spread over multiple statements could
            // reopen the window, and there is no cross-process leader/lease today.
        } finally {
            db.close();
        }
    });
});

describe('G61 completion receipt regressions (0833)', () => {
    test('origin is persisted before dispatch and unaddressed receipts survive reopening the database', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        const dbUrl = join(cwd, 'receipts.db');
        const ctx = createCliContext({ cwd, output: out, env: {}, dbUrl });
        try {
            const db = await ctx.getDb();
            const dao = new CoordinationRunDao(db);
            const deps = {
                runner: {
                    runPromptCommand: async () => {
                        const rows = await dao.listByTaskId('receipt-restart');
                        expect(rows).toHaveLength(1);
                        expect(rows[0]).toMatchObject({
                            status: 'running',
                            completed_at: null,
                            message_ids_json: '[]',
                        });
                        return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 };
                    },
                } as G6MockRunner,
                detector: { detectOne: async () => ({ version: '1' }) } as G6MockDetector,
                doctorRunner: g6Doctor() as G6MockDoctor,
            } as unknown as AgentRunDeps;
            expect(await runAgentRun('work', ctx, { agent: 'claude', task: 'receipt-restart', json: true }, deps)).toBe(
                0,
            );
            await db.close();
            const reopened = await createMigratedDb({ url: dbUrl });
            const rows = await new CoordinationRunDao(reopened).listByTaskId('receipt-restart');
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                status: 'exited',
                outcome: 'run-exit-only',
                message_ids_json: '[]',
                spec_id: '',
            });
            await reopened.close();
        } finally {
            await cleanup();
        }
    });

    test('probe 6, flipped by 0833: a finished run is correlated to its message and task at exit (R1, R4, R8)', async () => {
        // The exit sink in AgentService.executeRun writes the receipt into the
        // coordination_runs row it already finalizes — runId, originating message
        // id(s), task id, and the outcome, all durable.
        const { ctx, cleanup } = await makeCtx();
        const accepted = captureInvokeStart();
        try {
            const team = new AgentCoordinationService(ctx);
            await team.createAgentSpec({ id: 'planner', type: 'claude' });
            const sent = await team.sendMessage('operator', 'planner', 'complete and correlate me');
            const db = await ctx.getDb();
            const dao = new CoordinationRunDao(db);

            const deps = {
                runner: {
                    runPromptCommand: async () => {
                        const inFlight = await dao.listByMessageId(sent.msgId);
                        expect(inFlight[0]).toMatchObject({ status: 'running', task_id: '0833', completed_at: null });
                        accepted.fire();
                        return { exitCode: 0, stdout: 'done!', stderr: '', durationMs: 1 };
                    },
                } as G6MockRunner,
                detector: { detectOne: async () => ({ version: '1' }) } as G6MockDetector,
                doctorRunner: g6Doctor() as G6MockDoctor,
            } as unknown as AgentRunDeps;

            const code = await runAgentRun(
                'work',
                ctx,
                { agent: 'planner', drain: true, task: '0833', json: true },
                deps,
            );
            expect(code).toBe(0);

            // Query by message id (R5): the drained message id is on the receipt.
            const byMessage = await dao.listByMessageId(sent.msgId);
            expect(byMessage).toHaveLength(1);
            const row = byMessage[0];
            expect(row?.task_id).toBe('0833');
            // R4: zero exit with no verification result is run-exit-only — stored,
            // never inferred later; this sink never writes 'verified'.
            expect(row?.outcome).toBe('run-exit-only');
            // The row survives as a restart-readable receipt (R5): readable by run id.
            const byRun = await dao.getByRunId(row?.run_id ?? '');
            expect(byRun?.message_ids_json).toBe(JSON.stringify([sent.msgId]));

            // R3: states stay distinct — delivery is 0831's (`delivered`), the run
            // exit is this receipt's, and the task is NOT advanced by the exit.
            const rows = await new InboxMessageDao(db).inbox('planner', 10);
            expect(rows[0]?.status).toBe('delivered');
            expect((await team.drainPending('planner')).count).toBe(0);
        } finally {
            accepted.restore();
            await cleanup();
        }
    });

    test('a run with no originating request still writes a receipt with an empty message list (R7)', async () => {
        // No --drain, no messages: the receipt exists, with `[]` — never an
        // invented association (the anti-pattern the spec forbids).
        const { ctx, cleanup } = await makeCtx();
        try {
            const team = new AgentCoordinationService(ctx);
            await team.createAgentSpec({ id: 'planner', type: 'claude' });
            const db = await ctx.getDb();
            const dao = new CoordinationRunDao(db);

            const deps = {
                runner: {
                    runPromptCommand: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
                } as G6MockRunner,
                detector: { detectOne: async () => ({ version: '1' }) } as G6MockDetector,
                doctorRunner: g6Doctor() as G6MockDoctor,
            } as unknown as AgentRunDeps;

            const code = await runAgentRun('work', ctx, { spec: 'planner', task: 'T-9', json: true }, deps);
            expect(code).toBe(0);

            const byTask = await dao.listByTaskId('T-9');
            expect(byTask).toHaveLength(1);
            expect(byTask[0]?.message_ids_json).toBe('[]');
            expect(byTask[0]?.outcome).toBe('run-exit-only');
            // The task id is recorded; the task itself is untouched — only the
            // workflow verification path may advance it (R3).
            expect(await team.getInbox('operator', 10)).toMatchObject({ count: 0 });
        } finally {
            await cleanup();
        }
    });

    test('a run that exits nonzero records outcome errored, not run-exit-only (R4)', async () => {
        const { ctx, cleanup } = await makeCtx();
        try {
            const team = new AgentCoordinationService(ctx);
            await team.createAgentSpec({ id: 'planner', type: 'claude' });
            const sent = await team.sendMessage('operator', 'planner', 'fail loudly');
            const db = await ctx.getDb();
            const dao = new CoordinationRunDao(db);

            const deps = {
                runner: {
                    runPromptCommand: async () => ({ exitCode: 7, stdout: '', stderr: 'boom', durationMs: 1 }),
                } as G6MockRunner,
                detector: { detectOne: async () => ({ version: '1' }) } as G6MockDetector,
                doctorRunner: g6Doctor() as G6MockDoctor,
            } as unknown as AgentRunDeps;

            const code = await runAgentRun('work', ctx, { agent: 'planner', drain: true, json: true }, deps);
            expect(code).not.toBe(0);

            const byMessage = await dao.listByMessageId(sent.msgId);
            expect(byMessage).toHaveLength(1);
            expect(byMessage[0]?.outcome).toBe('errored');
        } finally {
            await cleanup();
        }
    });
});
