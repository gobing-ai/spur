import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TeamService } from '@gobing-ai/spur-app';
import type { DoctorResult } from '@gobing-ai/ts-ai-runner';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { main } from '../../src';
import { type AgentRunDeps, runAgentLoop, runAgentRun, splitEditorCommand } from '../../src/commands/agent';
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

describe('spur agent create', () => {
    test('writes a spec yaml with type and purpose', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(
                ['agent', 'create', 'planner', '--type', 'claude-code', '--purpose', 'plan things', '--tags', 'a,b'],
                { cwd, output: out, dbUrl: ':memory:' },
            );
            expect(code).toBe(0);
            const yaml = await readFile(join(cwd, '.spur', 'agents', 'planner.yaml'), 'utf8');
            expect(yaml).toContain('id: planner');
            expect(yaml).toContain('type: claude-code');
            expect(yaml).toContain('plan things');
            expect(out.messages.join('\n')).toMatch(/created .spur\/agents\/planner.yaml/);
        } finally {
            await cleanup();
        }
    });

    test('--json returns the spec', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['agent', 'create', 'coder', '--type', 'codex', '--json'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            expect(code).toBe(0);
            const payload = JSON.parse(out.messages.at(-1) ?? '{}');
            expect(payload.ok).toBe(true);
            expect(payload.spec.id).toBe('coder');
        } finally {
            await cleanup();
        }
    });

    test('rejects a duplicate id', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await main(['agent', 'create', 'coder', '--type', 'codex'], { cwd, output: out, dbUrl: ':memory:' });
            const code = await main(['agent', 'create', 'coder', '--type', 'codex'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/already exists/);
        } finally {
            await cleanup();
        }
    });

    test('rejects an invalid id', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['agent', 'create', 'Bad Id', '--type', 'codex'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            expect(code).toBe(1);
            expect(out.errors.length).toBeGreaterThan(0);
        } finally {
            await cleanup();
        }
    });

    test('requires --type', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['agent', 'create', 'coder'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(2);
            expect(out.errors.join('\n')).toMatch(/requires --type/);
        } finally {
            await cleanup();
        }
    });

    test('requires an id', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['agent', 'create', '--type', 'codex'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/missing required argument/);
        } finally {
            await cleanup();
        }
    });
});

describe('spur agent delete', () => {
    test('removes a spec with --force', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await main(['agent', 'create', 'coder', '--type', 'codex'], { cwd, output: out, dbUrl: ':memory:' });
            const code = await main(['agent', 'delete', 'coder', '--force'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            const fs = createNodeFileSystem();
            expect(await fs.exists(join(cwd, '.spur', 'agents', 'coder.yaml'))).toBe(false);
        } finally {
            await cleanup();
        }
    });

    test('refuses without --force', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await main(['agent', 'create', 'coder', '--type', 'codex'], { cwd, output: out, dbUrl: ':memory:' });
            const code = await main(['agent', 'delete', 'coder'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(2);
            expect(out.errors.join('\n')).toMatch(/without --force/);
        } finally {
            await cleanup();
        }
    });

    test('errors on a missing spec', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['agent', 'delete', 'ghost', '--force'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/No agent spec found/);
        } finally {
            await cleanup();
        }
    });
});

describe('spur agent edit', () => {
    test('prints the spec path when $EDITOR is unset', async () => {
        const { cwd, out, cleanup } = await makeCtx({ EDITOR: undefined });
        try {
            await main(['agent', 'create', 'coder', '--type', 'codex'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
                env: { EDITOR: undefined },
            });
            const code = await main(['agent', 'edit', 'coder'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
                env: { EDITOR: undefined },
            });
            expect(code).toBe(0);
            expect(out.messages.at(-1)).toContain(join(cwd, '.spur', 'agents', 'coder.yaml'));
        } finally {
            await cleanup();
        }
    });

    test('errors on a missing spec', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['agent', 'edit', 'ghost'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/No agent spec found/);
        } finally {
            await cleanup();
        }
    });

    test('prints the spec path when $EDITOR is whitespace-only (empty-argv fallback, no spawn)', async () => {
        // WHY: a set-but-whitespace $EDITOR is neither undefined nor '' (so it
        // passes the first guard), yet splitEditorCommand trims/splits it to [] —
        // runAgentEdit then prints the path and returns instead of spawning.
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await main(['agent', 'create', 'coder', '--type', 'codex'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
                env: { EDITOR: '   ' },
            });
            out.messages.length = 0;
            const code = await main(['agent', 'edit', 'coder'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
                env: { EDITOR: '   ' },
            });
            expect(code).toBe(0);
            expect(out.messages.at(-1)).toContain(join(cwd, '.spur', 'agents', 'coder.yaml'));
        } finally {
            await cleanup();
        }
    });
});

describe('splitEditorCommand (R6 multi-word $EDITOR)', () => {
    test('code -w splits into three argv tokens when path is appended', () => {
        // WHY: Bun.spawn([ "code -w", path ]) looks for a binary named "code -w".
        expect(splitEditorCommand('code -w')).toEqual(['code', '-w']);
        expect([...splitEditorCommand('code -w'), '/tmp/x.yaml']).toEqual(['code', '-w', '/tmp/x.yaml']);
    });

    test('single-word EDITOR is unchanged', () => {
        expect(splitEditorCommand('vim')).toEqual(['vim']);
    });

    test('whitespace-only EDITOR yields empty argv', () => {
        expect(splitEditorCommand('   ')).toEqual([]);
    });
});

describe('spur agent list --specs', () => {
    test('lists created specs', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await main(['agent', 'create', 'coder', '--type', 'codex', '--purpose', 'code'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            const code = await main(['agent', 'list', '--specs'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toContain('coder');
        } finally {
            await cleanup();
        }
    });

    test('--json includes spec paths', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await main(['agent', 'create', 'coder', '--type', 'codex'], { cwd, output: out, dbUrl: ':memory:' });
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
                    '  team:',
                    '    alpha:',
                    '      name: Alpha',
                    '      work_dir: /tmp/alpha-ws',
                    '      members:',
                    '        - role: reviewer',
                    '        - executor: cheap-exec',
                    '',
                ].join('\n'),
                'utf8',
            );
            const up = await main(['team', 'up', 'alpha'], { cwd, output: out, dbUrl: ':memory:' });
            expect(up).toBe(0);

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
            const team = new TeamService(ctx);
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
            const team = new TeamService(ctx);
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
        const { ctx, cleanup } = await makeCtx();
        try {
            const team = new TeamService(ctx);
            await team.createAgentSpec({ id: 'planner', type: 'claude' });
            await team.sendMessage('operator', 'planner', 'loop message');

            let receivedInput = '';
            const deps = {
                runner: {
                    runPromptCommand: async (_agent: unknown, opts: { input?: string }) => {
                        receivedInput = opts.input ?? '';
                        return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 };
                    },
                } as MockRunner,
                detector: { detectOne: async () => ({ version: '1' }) } as MockDetector,
                doctorRunner: fakeDoctor() as MockDoctor,
            } as unknown as AgentRunDeps;

            const code = await runAgentLoop(
                ctx,
                { agent: 'planner' },
                { maxIterations: 1, sleep: async () => {} },
                deps,
            );
            expect(code).toBe(0);
            expect(receivedInput).toContain('loop message');

            // drainPending (queued→injected) consumed it: a follow-up drain is empty — the
            // loop won't re-prepend the same message next iteration (the idempotency fix).
            const after = await team.drainPending('planner');
            expect(after.count).toBe(0);
        } finally {
            await cleanup();
        }
    });

    test('loop idle-sleeps when the inbox is empty (never runs the agent) and honors maxIterations', async () => {
        const { ctx, cleanup } = await makeCtx();
        try {
            const team = new TeamService(ctx);
            await team.createAgentSpec({ id: 'planner', type: 'claude' });

            let runs = 0;
            let sleeps = 0;
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

            const code = await runAgentLoop(
                ctx,
                { agent: 'planner' },
                {
                    maxIterations: 3,
                    sleep: async () => {
                        sleeps++;
                    },
                },
                deps,
            );
            expect(code).toBe(0);
            expect(runs).toBe(0); // nothing to drain → never ran the agent
            expect(sleeps).toBe(3); // idle-slept each of the 3 iterations
        } finally {
            await cleanup();
        }
    });

    test('loop requires an explicit --agent (rejects auto)', async () => {
        const { ctx, cleanup } = await makeCtx();
        try {
            const code = await runAgentLoop(ctx, { agent: 'auto' }, { maxIterations: 1 });
            expect(code).toBe(2);
        } finally {
            await cleanup();
        }
    });

    test('loop honors a numeric --poll as the sleep interval (parseLoopPoll valid path)', async () => {
        // parseLoopPoll('500') returns 500 (not the default) — the injected sleep
        // receives the parsed value, proving the finite-positive branch ran.
        const { ctx, cleanup } = await makeCtx();
        try {
            let slept = 0;
            const code = await runAgentLoop(
                ctx,
                { agent: 'planner', poll: '500' },
                {
                    maxIterations: 1,
                    sleep: async (ms) => {
                        slept = ms;
                    },
                },
            );
            expect(code).toBe(0);
            expect(slept).toBe(500);
        } finally {
            await cleanup();
        }
    });

    test('loopSleep waits the poll interval via a real timer when no sleep is injected', async () => {
        // No injected sleep + no signal → runAgentLoop calls the real loopSleep,
        // which schedules setTimeout(resolve, poll) and resolves after it fires.
        // poll='1' keeps the real wait to 1ms.
        const { ctx, cleanup } = await makeCtx();
        try {
            const code = await runAgentLoop(ctx, { agent: 'planner', poll: '1' }, { maxIterations: 1 });
            expect(code).toBe(0);
        } finally {
            await cleanup();
        }
    });

    test('loopSleep resolves early when the abort signal fires mid-sleep', async () => {
        // poll='5000' would wait 5s; aborting after 10ms exercises loopSleep's
        // signal abort listener (clearTimeout + resolve), then the loop exits on
        // the next while-condition check. No maxIterations — the signal is the stop.
        const { ctx, cleanup } = await makeCtx();
        try {
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), 10);
            try {
                const code = await runAgentLoop(ctx, { agent: 'planner', poll: '5000' }, { signal: ac.signal });
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
// G6 characterization block (task 0828) — fault-probe evidence for report
// `docs/reports/g6-runtime-inventory.md`. Characterization ONLY: each test
// observes current behavior; a passing test names the unmet target invariant
// explicitly and does NOT assert conformance to it. No production change.
// ═══════════════════════════════════════════════════════════════════════════════
import { createMigratedDb, InboxMessageDao } from '@gobing-ai/spur-domain';

describe('G6 characterization (0828) — delivery faults', () => {
    test('probe drain-before-spawn: inbox rows are injected BEFORE the invocation runs', async () => {
        // Setup: one queued message; fake runner records the pending count it sees
        // at invocation entry. Boundary: drainIntoPrompt (agent.ts:543) → svc.run.
        const { ctx, cleanup } = await makeCtx();
        try {
            const team = new TeamService(ctx);
            await team.createAgentSpec({ id: 'planner', type: 'claude' });
            await team.sendMessage('operator', 'planner', 'characterize me');
            const db = await ctx.getDb();
            const dao = new InboxMessageDao(db);

            let pendingAtInvocation = -1;
            let calls = 0;
            const deps = {
                runner: {
                    runPromptCommand: async () => {
                        calls++;
                        // Observed state INSIDE the invocation: what status are the rows in?
                        pendingAtInvocation = await dao.countPending('planner');
                        return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 };
                    },
                } as G6MockRunner,
                detector: { detectOne: async () => ({ version: '1' }) } as G6MockDetector,
                doctorRunner: g6Doctor() as G6MockDoctor,
            } as unknown as AgentRunDeps;

            const code = await runAgentRun('work', ctx, { agent: 'planner', drain: true, json: true }, deps);
            expect(code).toBe(0);
            expect(calls).toBe(1);
            expect(pendingAtInvocation).toBe(0); // queued rows already flipped to injected

            // Target invariant UNMET: delivery is finalized (queued→injected,
            // injectAttempts++) before any invocation attempt is verifiable. If spawn
            // fails after drain, the message is irrecoverably 'injected' — no redelivery.
            const rows = await new InboxMessageDao(db).inbox('planner', 10);
            expect(rows.length).toBe(1);
            expect(rows[0]?.status).toBe('injected');
        } finally {
            await cleanup();
        }
    });

    test.each([
        'throw',
        'nonzero',
    ] as const)('probe %s invocation: the loop consumes the message and continues', async (failure) => {
        // Injected fault: the runner throws during invocation. Boundary:
        // AgentService.executeRun catch at agent-service.ts:1292 converts the throw
        // into { ok:false, exitCode:2 } WITHOUT a persisted message failure; svc.run
        // returns that code; runAgentLoop (agent.ts:736) discards the return value.
        const { ctx, out, cleanup } = await makeCtx();
        try {
            const team = new TeamService(ctx);
            await team.createAgentSpec({ id: 'planner', type: 'claude' });
            await team.sendMessage('operator', 'planner', 'will crash');
            const db = await ctx.getDb();
            const dao = new InboxMessageDao(db);

            let calls = 0;
            const deps = {
                runner: {
                    runPromptCommand: async () => {
                        calls++;
                        if (failure === 'throw') throw new Error('injected invocation failure');
                        return { exitCode: 7, stdout: '', stderr: 'injected nonzero exit', durationMs: 1 };
                    },
                } as G6MockRunner,
                detector: { detectOne: async () => ({ version: '1' }) } as G6MockDetector,
                doctorRunner: g6Doctor() as G6MockDoctor,
            } as unknown as AgentRunDeps;

            // Observed: the loop does NOT propagate the failure — it iterates 3 times
            // (idle-sleeping the remaining two) and resolves 0.
            const code = await runAgentLoop(
                ctx,
                { agent: 'planner' },
                { maxIterations: 3, sleep: async () => {} },
                deps,
            );
            expect(code).toBe(0);
            expect(calls).toBe(1);
            if (failure === 'throw') expect(out.errors.join('\n')).toContain('injected invocation failure');

            const rows = await dao.inbox('planner', 10);
            expect(rows.length).toBe(1);
            // Observed: row is 'injected' (consumed) despite the failed invocation.
            expect(rows[0]?.status).toBe('injected');
            // No requeue seam exists: further drains return nothing.
            expect((await team.drainPending('planner')).count).toBe(0);

            // Target invariant UNMET: a failed invocation leaves no durable recovery
            // path — the message is neither requeued, marked failed, nor surfaced as a
            // delivery failure to any caller; recovery depends wholly on the supervisor
            // process-restart, which then finds an empty inbox. A long-lived loop
            // swallows this loss without an exit nonzero or a durable trace beyond the
            // stderr line on the (no-op) captured console.
        } finally {
            await cleanup();
        }
    });

    test('probe duplicate submission: two identical bodies enqueue two distinct msgIds, both deliver', async () => {
        // Boundary: TeamService.sendMessage → InboxMessageDao.enqueue (ts-db 0.4.62).
        const { ctx, cleanup } = await makeCtx();
        try {
            const db = await ctx.getDb();
            const dao = new InboxMessageDao(db);
            await dao.enqueue('operator', 'planner', 'same body');
            await dao.enqueue('operator', 'planner', 'same body');

            const rows = await dao.inbox('planner', 10);
            expect(rows.length).toBe(2);
            // Observed: per-send UUIDs — same-body requests are NOT unified.
            expect(rows[0]?.id).not.toBe(rows[1]?.id);
            const drained = await dao.drainPending('planner');
            expect(drained).toHaveLength(2);
            expect(await dao.countPending('planner')).toBe(0);

            // Target invariant UNMET: no idempotency/dedup key exists. A retried
            // send (client crash + resend, double-click, operator retry)
            // duplicates the invocation payload rather than coalescing to one row.
        } finally {
            await cleanup();
        }
    });

    test('probe competing consumers: the same queued row is claimed at most once on the shared adapter', async () => {
        // Two TeamService instances share one SQLite connection/db (two configs of
        // the same consumer process). Boundary: InboxMessageDao.drainPending's
        // conditional UPDATE ... WHERE status='queued' ... RETURNING (ts-db 0.4.62).
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const dao = new InboxMessageDao(db);
            await dao.enqueue('operator', 'planner', 'consumed once');
            await dao.enqueue('operator', 'planner', 'consumed twice');
            const a = new TeamService({
                cwd: process.cwd(),
                env: {},
                output: { write: () => {}, error: () => {} },
                getDb: async () => db,
                fs: createNodeFileSystem(process.cwd()),
            });
            const b = new TeamService({
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

    test('probe completion-without-notification: a successful run writes no completion-to-message association', async () => {
        // Suppress the notification sink: there is none to suppress. Boundary:
        // runAgentRun --drain with a successful fake runner; inspect what survives.
        const { ctx, cleanup } = await makeCtx();
        try {
            const team = new TeamService(ctx);
            await team.createAgentSpec({ id: 'planner', type: 'claude' });
            await team.sendMessage('operator', 'planner', 'complete and tell me');
            const db = await ctx.getDb();
            const systemDao = new (await import('@gobing-ai/spur-domain')).SystemEventDao(db);

            let calls = 0;
            const deps = {
                runner: {
                    runPromptCommand: async () => {
                        calls++;
                        return { exitCode: 0, stdout: 'done!', stderr: '', durationMs: 1 };
                    },
                } as G6MockRunner,
                detector: { detectOne: async () => ({ version: '1' }) } as G6MockDetector,
                doctorRunner: g6Doctor() as G6MockDoctor,
            } as unknown as AgentRunDeps;

            const code = await runAgentRun('work', ctx, { agent: 'planner', drain: true, json: true }, deps);
            expect(code).toBe(0);

            expect(calls).toBe(1);
            // Observed: (a) the message row is stuck at 'injected' forever — markDelivered
            // (ts-db) is never called on this path; (b) no DAO delivery events reach this CLI ledger;
            // (c) nothing in the ledger associates the runId with a message id.
            const rows = await new InboxMessageDao(db).inbox('planner', 10);
            expect(rows[0]?.status).toBe('injected');
            const messageEvents = await systemDao.query({
                names: ['message.enqueued', 'message.injected', 'message.delivered'],
                limit: 100,
            });
            expect(messageEvents.length).toBe(0);
            const sent = await team.getInbox('operator', 10);
            expect(sent.count).toBe(0); // no completion message back to the sender

            // Target invariant ABSENT (seam named): AgentService.executeRun persists
            // the run result + occupant exit pin (agent-service.ts ~1434–1483) but has
            // no completion-notification sink into InboxMessageDao. The durable
            // completion→message association the future control plane needs does not
            // exist; this probe demonstrates its absence rather than manufacturing one.
        } finally {
            await cleanup();
        }
    });
});
