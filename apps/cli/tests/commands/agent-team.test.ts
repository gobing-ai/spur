import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
