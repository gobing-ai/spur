/**
 * Comprehensive tests for apps/cli/src/commands/agent.ts.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    _resetAgentServiceShimsForTest,
    type AgentConfig,
    AgentCoordinationService,
    type AgentRunDeps,
} from '@gobing-ai/spur-app';
import { createMigratedDb, type DbAdapter, InboxMessageDao } from '@gobing-ai/spur-domain';
import { saveAgentSpec } from '@gobing-ai/ts-ai-runner';
import {
    resetAgentServerFetchForTesting,
    runAgentLoop,
    runAgentRun,
    setAgentServerFetchForTesting,
    validateAgentSelector,
} from '../../src/commands/agent';
import { type CliContext, createCliContext, resolveAgentRoles } from '../../src/context';
import { main } from '../../src/index';
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

// Warn-once shim markers are process-global; bun batches test files per worker
// process, so never inherit another file's marker state.
beforeEach(() => {
    _resetAgentServiceShimsForTest();
});

describe('agent command (main)', () => {
    test('unknown subcommand returns 1', async () => {
        const output = captureOutput();
        const exitCode = await main(['agent', 'unknown-cmd'], { output });
        expect(exitCode).toBe(1);
    });

    test(
        'list subcommand returns a number',
        async () => {
            const output = captureOutput();
            const exitCode = await main(['agent', 'list'], { output });
            expect(typeof exitCode).toBe('number');
        },
        { timeout: 15000 },
    );

    test('run subcommand with no prompt → exit 1', async () => {
        const output = captureOutput();
        const exitCode = await main(['agent', 'run'], { output });
        expect(exitCode).toBe(1);
    });

    test('run subcommand action dispatches correctly', async () => {
        const run = mock(() => Promise.resolve(0));
        const agentService = mock(() => ({ run }) as unknown as ReturnType<CliContext['agentService']>);
        const output = captureOutput();
        const program = new (await import('@commander-js/extra-typings')).Command();
        let exitCode = 0;
        const context = {
            cwd: process.cwd(),
            env: {},
            output,
            setExitCode: (code: number) => {
                exitCode = code;
            },
            getDb: async () => {
                throw new Error('not needed');
            },
            agentService,
            agentRoles: resolveAgentRoles(),
        } as unknown as CliContext;

        const { registerAgentCommand } = await import('../../src/commands/agent');
        registerAgentCommand(program, context);
        await program.parseAsync(['node', 'test', 'agent', 'run', 'test prompt', '--agent', 'auto']);
        expect(exitCode).toBe(0);
        expect(run).toHaveBeenCalledTimes(1);
    });

    test('loop subcommand action dispatches correctly', async () => {
        const tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-loop-action-'));
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const output = captureOutput();
            const ctx = createCliContext({ cwd: tempDir, output, db });
            const team = new AgentCoordinationService(ctx);
            await team.createAgentSpec({ id: 'worker-1', type: 'claude-code' });

            const program = new (await import('@commander-js/extra-typings')).Command();
            let exitCode = 0;
            const customCtx = {
                ...ctx,
                setExitCode: (code: number) => {
                    exitCode = code;
                },
                agentService: () =>
                    ({ run: () => Promise.resolve(0) }) as unknown as ReturnType<CliContext['agentService']>,
            };

            const { registerAgentCommand } = await import('../../src/commands/agent');
            registerAgentCommand(program, customCtx);
            const parsePromise = program.parseAsync([
                'node',
                'test',
                'agent',
                'loop',
                '--spec',
                'worker-1',
                '--poll',
                '1',
            ]);
            setTimeout(() => process.emit('SIGINT'), 10);
            await parsePromise;
            expect(exitCode).toBe(0);
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

describe('agent list --specs', () => {
    let tempDir: string;
    let db: DbAdapter;

    beforeEach(async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-test-'));
        db = await createMigratedDb({ url: ':memory:' });
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    test('list --specs when no specs exist writes message', async () => {
        const output = captureOutput();
        const exitCode = await main(['agent', 'list', '--specs'], {
            cwd: tempDir,
            output,
            db,
        });
        expect(exitCode).toBe(0);
        expect(output.stdout.join('\n')).toContain('No agent specs found');
    });

    test('list --specs --json when specs exist outputs JSON array', async () => {
        const output = captureOutput();
        const ctx = createCliContext({
            cwd: tempDir,
            output,
            db,
        });

        const team = new AgentCoordinationService(ctx);
        await team.createAgentSpec({ id: 'test-agent-1', type: 'coder', purpose: 'test purpose' });

        const exitCode = await main(['agent', 'list', '--specs', '--json'], {
            cwd: tempDir,
            output,
            db,
        });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output.stdout.join('\n'));
        expect(parsed.specs).toHaveLength(1);
        expect(parsed.specs[0].id).toBe('test-agent-1');
        expect(parsed.specs[0].type).toBe('coder');
    });

    test('list --specs formatted text list when specs exist', async () => {
        const output = captureOutput();
        const ctx = createCliContext({
            cwd: tempDir,
            output,
            db,
        });

        const team = new AgentCoordinationService(ctx);
        await team.createAgentSpec({ id: 'agent-a', type: 'coder', purpose: 'coding purpose' });

        const exitCode = await main(['agent', 'list', '--specs'], {
            cwd: tempDir,
            output,
            db,
        });
        expect(exitCode).toBe(0);
        // 0544 R2/R4: id \t type \t role \t executor \t purpose — unset when undeclared.
        expect(output.stdout.join('\n')).toContain('agent-a\tcoder\tunset\tunset\tcoding purpose');
    });
});

describe('agent doctor', () => {
    test('doctor command invokes doctor on AgentService with args', async () => {
        const output = captureOutput();
        const exitCode = await main(['agent', 'doctor', 'claude-code', '--json'], {
            output,
        });
        expect(typeof exitCode).toBe('number');
    });

    // B4/0683: the probe/cache flags parse and dispatch without changing the exit contract.
    test.each([
        ['--probe-health'],
        ['--force-refresh'],
        ['--probe-health', '--force-refresh'],
    ])('doctor accepts %j', async (...args: unknown[]) => {
        const flags = args.filter((a): a is string => typeof a === 'string');
        const output = captureOutput();
        const exitCode = await main(['agent', 'doctor', ...flags, '--json'], { output });
        expect(typeof exitCode).toBe('number');
    });
});

describe('member session rendering (0897)', () => {
    let tempDir: string;
    let db: DbAdapter;

    beforeEach(async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-session-render-'));
        db = await createMigratedDb({ url: ':memory:' });
    });

    afterEach(() => {
        resetAgentServerFetchForTesting();
        rmSync(tempDir, { recursive: true, force: true });
    });

    /** Supervisor feed stub: planner is running with a resume session, worker stopped. */
    function stubProcessesFeed(): void {
        setAgentServerFetchForTesting(
            (async (_input: string | URL | Request) =>
                new Response(
                    JSON.stringify({
                        processes: [
                            {
                                agentId: 'planner',
                                pid: 4132,
                                status: 'running',
                                startedAt: new Date().toISOString(),
                                exitCode: null,
                                teamId: null,
                                session: { mode: 'resume', id: 'sess-3f9c2a1d-beef' },
                            },
                            {
                                agentId: 'worker',
                                pid: null,
                                status: 'stopped',
                                startedAt: new Date().toISOString(),
                                exitCode: null,
                                teamId: null,
                            },
                        ],
                    }),
                    { status: 200 },
                )) as typeof fetch,
        );
    }

    async function seedSpecs(): Promise<void> {
        const output = captureOutput();
        const ctx = createCliContext({ cwd: tempDir, output, db });
        const team = new AgentCoordinationService(ctx);
        await team.createAgentSpec({ id: 'planner', type: 'claude-code', purpose: 'plans' });
        await team.createAgentSpec({ id: 'worker', type: 'coder', purpose: 'codes' });
    }

    test('list --specs renders the session column: mode + shortened id, - when absent', async () => {
        await seedSpecs();
        stubProcessesFeed();
        const output = captureOutput();
        const exitCode = await main(['agent', 'list', '--specs'], { cwd: tempDir, output, db });
        expect(exitCode).toBe(0);
        const lines = output.stdout.join('\n').split('\n');
        expect(lines.find((l) => l.startsWith('planner\t'))).toContain('resume id=sess-3f9');
        expect(lines.find((l) => l.startsWith('worker\t'))).toMatch(/\t-$/);
    });

    test('list --specs --json carries the full session object', async () => {
        await seedSpecs();
        stubProcessesFeed();
        const output = captureOutput();
        const exitCode = await main(['agent', 'list', '--specs', '--json'], { cwd: tempDir, output, db });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output.stdout.join('\n')) as {
            specs: Array<{ id: string; session?: { mode: string; id?: string } }>;
        };
        expect(parsed.specs.find((sp) => sp.id === 'planner')?.session).toEqual({
            mode: 'resume',
            id: 'sess-3f9c2a1d-beef',
        });
        expect(parsed.specs.find((sp) => sp.id === 'worker')?.session).toBeUndefined();
    });

    test('status renders live status and session per spec; unreachable server reports stopped', async () => {
        await seedSpecs();
        stubProcessesFeed();
        const output = captureOutput();
        const exitCode = await main(['agent', 'status'], { cwd: tempDir, output, db });
        expect(exitCode).toBe(0);
        const lines = output.stdout.join('\n').split('\n');
        expect(lines.find((l) => l.startsWith('planner\t'))).toContain('running pid=4132\tresume id=sess-3f9');
        expect(lines.find((l) => l.startsWith('worker\t'))).toContain('stopped\t-');

        // Unreachable server: every spec stopped, no session, warning on stderr.
        resetAgentServerFetchForTesting();
        const offline = captureOutput();
        const code2 = await main(['agent', 'status', '--server', 'http://127.0.0.1:59999/api'], {
            cwd: tempDir,
            output: offline,
            db,
        });
        expect(code2).toBe(0);
        expect(offline.stderr.join('\n')).toContain('Cannot reach server');
        expect(offline.stdout.join('\n')).toContain('worker\tcoder\tstopped\t-');
    });

    test('status --json carries the full session object per agent', async () => {
        await seedSpecs();
        stubProcessesFeed();
        const output = captureOutput();
        const exitCode = await main(['agent', 'status', '--json'], { cwd: tempDir, output, db });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output.stdout.join('\n')) as {
            agents: Array<{ id: string; status: string; session?: { mode: string; id?: string } }>;
        };
        const planner = parsed.agents.find((a) => a.id === 'planner');
        expect(planner?.status).toBe('running');
        expect(planner?.session).toEqual({ mode: 'resume', id: 'sess-3f9c2a1d-beef' });
    });

    test('status without specs writes the empty message', async () => {
        const output = captureOutput();
        const exitCode = await main(['agent', 'status'], { cwd: tempDir, output, db });
        expect(exitCode).toBe(0);
        expect(output.stdout.join('\n')).toContain('No agent specs found');
    });
});

describe('runAgentRun service wiring (0126 / 0370)', () => {
    test('routes through context.agentService({ events }), preserving agentConfig', async () => {
        const run = mock(() => Promise.resolve(0));
        const agentService = mock(
            (_opts?: { events?: unknown }) => ({ run }) as unknown as ReturnType<CliContext['agentService']>,
        );
        const context = {
            cwd: process.cwd(),
            env: {},
            output: captureOutput(),
            getDb: async () => {
                throw new Error('ledger attach is best-effort in this unit test');
            },
            agentService,
            agentRoles: resolveAgentRoles(),
        } as unknown as CliContext;

        const code = await runAgentRun('/sp:dev-run 0126', context, { agent: 'auto' });
        expect(code).toBe(0);
        expect(agentService).toHaveBeenCalledTimes(1);
        expect(agentService.mock.calls[0]?.[0]).toMatchObject({ events: expect.anything() });
        expect(run).toHaveBeenCalledWith('/sp:dev-run 0126', { agent: 'auto' }, undefined);
    });

    test('runAgentRun with --drain error without agent id', async () => {
        const output = captureOutput();
        const run = mock(() => Promise.resolve(0));
        const agentService = mock(() => ({ run }) as unknown as ReturnType<CliContext['agentService']>);
        const context = {
            cwd: process.cwd(),
            env: {},
            output,
            getDb: async () => {
                throw new Error('ledger error');
            },
            agentService,
            agentRoles: resolveAgentRoles(),
        } as unknown as CliContext;

        const code = await runAgentRun('hello', context, { drain: true });
        expect(code).toBe(0);
        // 0542 R1: the drain recipient is addressed via --spec <id>.
        expect(output.stderr.join('\n')).toContain(
            '--drain requires an explicit --spec <id> matching a message recipient',
        );
    });

    test('runAgentRun with --drain and recipient prepends messages and maps spec type', async () => {
        const tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-drain-test-'));
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const output = captureOutput();
            const ctx = createCliContext({
                cwd: tempDir,
                output,
                db,
            });

            const team = new AgentCoordinationService(ctx);
            await team.createAgentSpec({ id: 'worker-1', type: 'pi' });
            await team.sendMessage(null, 'worker-1', 'Do step 1');

            const run = mock((prompt: string | undefined, flags: Record<string, unknown>) => {
                expect(prompt).toContain('Pending messages:');
                expect(prompt).toContain('Do step 1');
                expect(prompt).toContain('Main task prompt');
                // 0536 R3: the rewritten selector must pass the flag boundary —
                // a canonical coding-agent type (bare binary shim), not a bogus one.
                expect(flags.agent).toBe('pi');
                return Promise.resolve(0);
            });

            const customCtx = {
                ...ctx,
                agentService: () => ({ run }) as unknown as ReturnType<CliContext['agentService']>,
            };

            const code = await runAgentRun('Main task prompt', customCtx, { drain: true, agent: 'worker-1' });
            expect(code).toBe(0);
            expect(run).toHaveBeenCalledTimes(1);
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('runAgentRun with --drain and recipient when prompt is undefined', async () => {
        const tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-drain-noprompt-'));
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const output = captureOutput();
            const ctx = createCliContext({
                cwd: tempDir,
                output,
                db,
            });

            const team = new AgentCoordinationService(ctx);
            await team.createAgentSpec({ id: 'worker-2', type: 'pi' });
            await team.sendMessage('operator', 'worker-2', 'Solo message');

            const run = mock((prompt: string | undefined) => {
                expect(prompt).toBe('Pending messages:\n- operator: Solo message');
                return Promise.resolve(0);
            });

            const customCtx = {
                ...ctx,
                agentService: () => ({ run }) as unknown as ReturnType<CliContext['agentService']>,
            };

            const code = await runAgentRun(undefined, customCtx, { drain: true, agent: 'worker-2' });
            expect(code).toBe(0);
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('runAgentRun with --drain resolves the spec executor, not a bare kind (0537 R2)', async () => {
        const tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-drain-executor-'));
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const output = captureOutput();
            const ctx = createCliContext({
                cwd: tempDir,
                output,
                db,
                agentConfig: {
                    executors: [{ name: 'codex-sol', agent: 'codex', model: 'gpt-5.6-sol', tier: 'capable-3' }],
                } as AgentConfig,
            });

            // A team-materialized spec carries the executor binding beside the kind.
            await saveAgentSpec(
                {
                    id: 'demo-codex-sol',
                    name: 'Verifier',
                    type: 'codex',
                    executor: 'codex-sol',
                    workspace: tempDir,
                    purpose: 'Second opinion',
                    tags: ['team:demo', 'spur:generated'],
                    config: { model: 'gpt-5.6-sol' },
                },
                join(tempDir, '.spur', 'agents'),
            );
            await new AgentCoordinationService(ctx).sendMessage(null, 'demo-codex-sol', 'Do step 1');

            const run = mock((_prompt: string | undefined, flags: Record<string, unknown>) => {
                // Regression: the selector is the executor name — resolveExecutor's
                // executor-first lookup restores {agent, model} + tier, never bare
                // `codex` on the default model.
                expect(flags.agent).toBe('codex-sol');
                // Occupant pin (R3): spec-id survives the selector rewrite.
                expect(flags['spec-id']).toBe('demo-codex-sol');
                return Promise.resolve(0);
            });

            const customCtx = {
                ...ctx,
                agentService: () => ({ run }) as unknown as ReturnType<CliContext['agentService']>,
            };

            const code = await runAgentRun('Main task prompt', customCtx, { drain: true, agent: 'demo-codex-sol' });
            expect(code).toBe(0);
            expect(run).toHaveBeenCalledTimes(1);
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('runAgentRun with --drain fails loud on a dangling executor (0537 R5)', async () => {
        const tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-drain-ghost-'));
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const output = captureOutput();
            const ctx = createCliContext({
                cwd: tempDir,
                output,
                db,
                agentConfig: { executors: [] } as AgentConfig,
            });

            // Spec references an executor that no longer exists in agent.executors.
            await saveAgentSpec(
                {
                    id: 'demo-ghost',
                    name: 'Ghost',
                    type: 'codex',
                    executor: 'ghost-exec',
                    workspace: tempDir,
                    purpose: 'gone',
                    tags: [],
                    config: {},
                },
                join(tempDir, '.spur', 'agents'),
            );

            const run = mock(() => Promise.resolve(0));
            const customCtx = {
                ...ctx,
                agentService: () => ({ run }) as unknown as ReturnType<CliContext['agentService']>,
            };

            // Exits non-zero naming the spec and the missing executor; no process spawns.
            await expect(runAgentRun('prompt', customCtx, { drain: true, agent: 'demo-ghost' })).rejects.toThrow(
                /Spec "demo-ghost" references unknown executor "ghost-exec"/,
            );
            expect(run).not.toHaveBeenCalled();
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });
    test('runAgentRun with --drain fails loud on a spec pinned to a disabled executor (0796 R4)', async () => {
        const tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-drain-disabled-'));
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const output = captureOutput();
            const ctx = createCliContext({
                cwd: tempDir,
                output,
                db,
                agentConfig: {
                    executors: [{ name: 'retired-exec', agent: 'codex', disabled: true }],
                } as AgentConfig,
            });

            // Spec references an executor that exists but is disabled in config.
            await saveAgentSpec(
                {
                    id: 'demo-disabled',
                    name: 'Disabled',
                    type: 'codex',
                    executor: 'retired-exec',
                    workspace: tempDir,
                    purpose: 'off',
                    tags: [],
                    config: {},
                },
                join(tempDir, '.spur', 'agents'),
            );

            const run = mock(() => Promise.resolve(0));
            const customCtx = {
                ...ctx,
                agentService: () => ({ run }) as unknown as ReturnType<CliContext['agentService']>,
            };

            // Exits non-zero naming the spec, the disabled flag and the enable fix;
            // never relabeled as a dangling reference; no process spawns.
            await expect(runAgentRun('prompt', customCtx, { drain: true, agent: 'demo-disabled' })).rejects.toThrow(
                /Spec "demo-disabled" pins disabled executor "retired-exec" .*disabled: false/,
            );
            expect(run).not.toHaveBeenCalled();
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

describe('runAgentLoop', () => {
    let tempDir: string;
    let db: DbAdapter;

    beforeEach(async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-loop-test-'));
        db = await createMigratedDb({ url: ':memory:' });
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    test('loop requires explicit --spec <id>', async () => {
        const output = captureOutput();
        const exitCode = await main(['agent', 'loop'], {
            cwd: tempDir,
            output,
            db,
        });
        // 0542 R3: missing occupant address exits 2, matching the run-level error path.
        expect(exitCode).toBe(2);
    });

    test('runAgentLoop errors when --spec is missing or auto', async () => {
        const output = captureOutput();
        const ctx = createCliContext({ cwd: tempDir, output, db });
        const code1 = await runAgentLoop(ctx, {});
        expect(code1).toBe(2);
        // 0542 R3: the loop addresses the occupant via --spec <id>.
        expect(output.stderr.join('\n')).toContain(
            'agent loop requires an explicit --spec <id> matching a team agent spec',
        );

        const output2 = captureOutput();
        const ctx2 = createCliContext({ cwd: tempDir, output: output2, db });
        const code2 = await runAgentLoop(ctx2, { spec: 'auto' });
        expect(code2).toBe(2);
        expect(output2.stderr.join('\n')).toContain(
            'agent loop requires an explicit --spec <id> matching a team agent spec',
        );
    });

    test('runAgentLoop drains inbox when messages exist and runs agent', async () => {
        const output = captureOutput();
        const ctx = createCliContext({ cwd: tempDir, output, db });
        const team = new AgentCoordinationService(ctx);
        await team.createAgentSpec({ id: 'loop-worker', type: 'claude-code' });
        await team.sendMessage('operator', 'loop-worker', 'Process task #100');

        const run = mock((prompt: string | undefined) => {
            expect(prompt).toContain('Process task #100');
            return Promise.resolve(0);
        });

        const customCtx = {
            ...ctx,
            agentService: () => ({ run }) as unknown as ReturnType<CliContext['agentService']>,
        };

        // 0839: no sleep seam — the pre-queued message is drained on the `--poll`
        // backstop wake (no ledger event precedes it; R5 keeps the drain bounded).
        const code = await runAgentLoop(customCtx, { spec: 'loop-worker', poll: '100' }, { maxIterations: 1 });
        expect(code).toBe(0);
        expect(run).toHaveBeenCalledTimes(1);
    });

    // 0834 R2/R7: restart with in-flight work through the real call path — the
    // loop reconciles BEFORE its first drain, marks the over-budget row failed
    // (its only write), names the receipt-less row outcome-unknown, and never
    // gates on the report.
    test('0834: loop startup reconciles in-flight work before its first drain', async () => {
        const output = captureOutput();
        const ctx = createCliContext({ cwd: tempDir, output, db });
        const team = new AgentCoordinationService(ctx);
        await team.createAgentSpec({ id: 'reconcile-worker', type: 'claude-code' });
        const inbox = new InboxMessageDao(db);
        // In-flight: consumed by a previous drain that never settled (no receipt).
        const stuck = await inbox.enqueue('operator', 'reconcile-worker', 'ambiguous work');
        await inbox.drainPending('reconcile-worker');
        // Over-budget redelivery still waiting in the queue.
        const overBudget = await inbox.enqueue('operator', 'reconcile-worker', 'exhausted work');
        await db.run('UPDATE inbox_messages SET inject_attempts = ?1 WHERE id = ?2', 3, overBudget);

        const run = mock(() => Promise.resolve(0));
        const customCtx = {
            ...ctx,
            agentService: () => ({ run }) as unknown as ReturnType<CliContext['agentService']>,
        };

        const code = await runAgentLoop(customCtx, { spec: 'reconcile-worker', poll: '100' }, { maxIterations: 1 });
        expect(code).toBe(0);
        const stdout = output.stdout.join('\n');
        expect(stdout).toContain('reconcile: scanned=2 unresolved=2 exhausted=1');
        expect(stdout).toContain(`${stuck} outcome-unknown`);
        expect(stdout).toContain(`${overBudget} attempts-exhausted`);
        // The reconciler's only write: the budget row is terminally failed.
        const row = await inbox.getById(overBudget);
        expect(row?.status).toBe('failed');
        expect(row?.injectError).toBe('attempts exhausted after 3 deliveries');
        // Reconciliation preceded dispatch: nothing re-claimed, no agent run.
        expect(run).not.toHaveBeenCalled();
    });

    test('0839: idle backstop wake drains nothing and never runs the agent', async () => {
        const output = captureOutput();
        const ctx = createCliContext({ cwd: tempDir, output, db });
        const team = new AgentCoordinationService(ctx);
        await team.createAgentSpec({ id: 'idle-worker-default-sleep', type: 'claude-code' });

        const run = mock(() => Promise.resolve(0));
        const customCtx = {
            ...ctx,
            agentService: () => ({ run }) as unknown as ReturnType<CliContext['agentService']>,
        };

        const code = await runAgentLoop(
            customCtx,
            { spec: 'idle-worker-default-sleep', poll: '1' },
            { maxIterations: 1 },
        );
        expect(code).toBe(0);
        expect(run).toHaveBeenCalledTimes(0);
    });

    test('runAgentLoop loopSleep abort listener clears timer', async () => {
        const output = captureOutput();
        const ctx = createCliContext({ cwd: tempDir, output, db });
        const team = new AgentCoordinationService(ctx);
        await team.createAgentSpec({ id: 'abort-worker', type: 'claude-code' });

        const run = mock(() => Promise.resolve(0));
        const customCtx = {
            ...ctx,
            agentService: () => ({ run }) as unknown as ReturnType<CliContext['agentService']>,
        };

        // 0839: the abort cuts the wake wait (no 5s backstop) — the loop exits 0.
        const controller = new AbortController();
        const loopPromise = runAgentLoop(
            customCtx,
            { spec: 'abort-worker', poll: '5000' },
            { signal: controller.signal },
        );
        setTimeout(() => controller.abort(), 10);
        const code = await loopPromise;
        expect(code).toBe(0);
    });

    test('runAgentLoop exits immediately when AbortSignal is pre-aborted', async () => {
        const output = captureOutput();
        const ctx = createCliContext({ cwd: tempDir, output, db });
        const controller = new AbortController();
        controller.abort();

        const code = await runAgentLoop(ctx, { spec: 'worker-1' }, { signal: controller.signal });
        expect(code).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Tests: 0536 — --agent role boundary (R1/R3) at the flag boundary
// ---------------------------------------------------------------------------

describe('runAgentRun role boundary (0536)', () => {
    /** Minimal deps whose doctor reports every agent usable; captures dispatches. */
    function depsWith(runPromptCommand: ReturnType<typeof mock>): AgentRunDeps {
        const runner = { runPromptCommand } as unknown as AgentRunDeps['runner'];
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({ name: 'pi', installed: true, version: '1.0.0', channels: [], error: null }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock((agent: string) =>
                Promise.resolve({
                    agent,
                    installed: true,
                    version: '1.0.0',
                    authenticated: 'authenticated',
                    usable: true,
                    tier: 1,
                    channels: [],
                    error: null,
                }),
            ),
            // 0687 R3: omitted/explicit inline walk tier priority, so a runAll
            // leg is required for resolution to reach a concrete executor.
            runAll: mock(() =>
                Promise.resolve([
                    {
                        agent: 'pi',
                        installed: true,
                        version: '1.0.0',
                        authenticated: 'authenticated',
                        usable: true,
                        tier: 1,
                        channels: [],
                        error: null,
                    },
                ]),
            ),
        } as unknown as AgentRunDeps['doctorRunner'];
        return { runner, detector, doctorRunner };
    }

    test('R1: the bundled roles map resolves four roles at their DEFAULT_AGENT_ROLES tiers (0572)', () => {
        const parsed = resolveAgentRoles();
        expect([...parsed.keys()].sort()).toEqual(['coder', 'planner', 'reviewer', 'scribe']);
        expect(parsed.get('scribe')?.tier).toBe('cheap');
        expect(parsed.get('coder')?.tier).toBe('standard');
        expect(parsed.get('reviewer')?.tier).toBe('capable-1');
        expect(parsed.get('planner')?.tier).toBe('capable-2');
    });

    test('R3: an unknown --agent value is rejected at the boundary, before any spawn', async () => {
        const tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-boundary-reject-'));
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const output = captureOutput();
            const ctx = createCliContext({
                cwd: tempDir,
                output,
                db,
                agentConfig: { executors: [{ name: 'codex-sol', agent: 'codex' }] } as AgentConfig,
            });
            const runPromptCommand = mock((_agent: string) =>
                Promise.resolve({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
            );
            const code = await runAgentRun('plain prompt', ctx, { agent: 'not-a-name' }, depsWith(runPromptCommand));
            expect(code).toBe(2);
            expect(runPromptCommand).not.toHaveBeenCalled();
            const diag = output.stderr.join('\n');
            expect(diag).toContain("Unknown agent: 'not-a-name'");
            expect(diag).toContain('role');
            expect(diag).toContain('codex-sol');
            expect(diag).toContain('inline');
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('R1/R3: a role passes the boundary and resolves through the DEFAULT_AGENT_ROLES map', async () => {
        const tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-boundary-role-'));
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const output = captureOutput();
            const ctx = createCliContext({
                cwd: tempDir,
                output,
                db,
                agentConfig: {
                    executors: [
                        { name: 'cheap-exec', agent: 'pi', tier: 'cheap' },
                        { name: 'cap1-exec', agent: 'claude', tier: 'capable-1' },
                    ],
                } as AgentConfig,
            });
            const runPromptCommand = mock((_agent: string) =>
                Promise.resolve({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
            );
            const code = await runAgentRun('plain prompt', ctx, { agent: 'reviewer' }, depsWith(runPromptCommand));
            expect(code).toBe(0);
            expect(runPromptCommand).toHaveBeenCalledTimes(1);
            // reviewer floors at capable-1 → the cheapest eligible executor (claude).
            expect(runPromptCommand.mock.calls[0]?.[0]).toBe('claude');
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('R3: a bare coding-agent binary name passes the boundary and the service warns once', async () => {
        const tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-boundary-bare-'));
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const output = captureOutput();
            const ctx = createCliContext({
                cwd: tempDir,
                output,
                db,
                agentConfig: { executors: [] } as AgentConfig,
            });
            const runPromptCommand = mock((_agent: string) =>
                Promise.resolve({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
            );
            const code = await runAgentRun('plain prompt', ctx, { agent: 'openclaw' }, depsWith(runPromptCommand));
            expect(code).toBe(0);
            expect(runPromptCommand).toHaveBeenCalledTimes(1);
            expect(output.stderr.join('\n')).toContain('bare coding-agent binary name');
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    // ADR-087: the CLI boundary accepts inline. AgentService owns the headless
    // substitution warning so every dispatch surface follows one resolution path.
    test('R3 (0687): validateAgentSelector accepts inline, omitted, and auto selectors', async () => {
        const tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-inline-selector-'));
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const output = captureOutput();
            const ctx = createCliContext({ cwd: tempDir, output, db, agentConfig: {} as AgentConfig });
            expect(validateAgentSelector({ agent: 'inline' }, ctx)).toBeNull(); // 0687 R3: valid everywhere
            expect(validateAgentSelector({}, ctx)).toBeNull();
            expect(validateAgentSelector({ agent: 'auto' }, ctx)).toBeNull();
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('R3 (0687): --agent inline substitutes tier resolution with a warning and spawns', async () => {
        const tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-inline-reject-'));
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const output = captureOutput();
            const ctx = createCliContext({ cwd: tempDir, output, db, agentConfig: {} as AgentConfig });
            const runPromptCommand = mock((_agent: string) =>
                Promise.resolve({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 }),
            );
            const code = await runAgentRun('plain prompt', ctx, { agent: 'inline' }, depsWith(runPromptCommand));
            expect(code).toBe(0);
            expect(runPromptCommand).toHaveBeenCalledTimes(1);
            const diag = output.stderr.join('\n');
            expect(diag).toContain('--agent inline requested on a headless surface');
            expect(diag).toContain('inline');
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

// ---------------------------------------------------------------------------
// 0893 R4: doctor availability provenance + usage snapshot, end-to-end through
// main() — the real AgentService renders whatever the project config and the
// producer snapshot contain (no service shims in this describe).
// ---------------------------------------------------------------------------

describe('agent doctor — availability provenance (0893)', () => {
    let tempDir: string;
    let snapshotPath: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-doctor-0893-'));
        // bun's homedir() ignores HOME at runtime — pin the snapshot via the
        // injected-env seam (SPUR_AGENT_USAGE_SNAPSHOT) instead.
        snapshotPath = join(tempDir, 'agent-usage.json');
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    /** Project-layer config with one bare-boolean and one object-form disabled executor. */
    function writeProjectConfig(): void {
        mkdirSync(join(tempDir, '.spur'), { recursive: true });
        writeFileSync(
            join(tempDir, '.spur', 'config.yaml'),
            [
                'agent:',
                '  executors:',
                '    - name: dis-bare',
                '      agent: omp',
                '      disabled: true',
                '    - name: dis-obj',
                '      agent: omp',
                '      disabled:',
                '        owner: quota',
                '        since: "2026-09-17T22:10:00.000Z"',
                '        reason: agent.quota.exhausted dis-obj',
            ].join('\n'),
        );
    }

    function writeUsageSnapshot(capturedAt: string): void {
        writeFileSync(snapshotPath, JSON.stringify({ captured_at: capturedAt }));
    }

    async function runDoctor(json: boolean): Promise<{ code: number; stdout: string[]; stderr: string[] }> {
        const output = captureOutput();
        const code = await main(['agent', 'doctor', ...(json ? ['--json'] : [])], {
            output,
            cwd: tempDir,
            env: { SPUR_SKIP_GLOBAL_CONFIG: 'true', SPUR_AGENT_USAGE_SNAPSHOT: snapshotPath },
        });
        return { code, stdout: output.stdout, stderr: output.stderr };
    }

    test('bare-boolean and object-form disables render normalized availability in --json', async () => {
        writeProjectConfig();
        const { code, stdout } = await runDoctor(true);
        expect(code).toBe(1); // tier-2 disabled row fails the support-tier exit aggregation
        const parsed = JSON.parse(stdout.find((l) => l.includes('"agents"')) ?? '');
        const bare = parsed.agents.find((a: { agent: string }) => a.agent === 'dis-bare');
        expect(bare.availability).toEqual({ disabled: true, owner: 'operator', since: null, reason: null });
        const obj = parsed.agents.find((a: { agent: string }) => a.agent === 'dis-obj');
        expect(obj.availability).toEqual({
            disabled: true,
            owner: 'quota',
            since: '2026-09-17T22:10:00.000Z',
            reason: 'agent.quota.exhausted dis-obj',
        });
    });

    test('fresh usage snapshot is reported; stale one is flagged; missing one is none (no warning)', async () => {
        writeProjectConfig();
        writeUsageSnapshot(new Date(Date.now() - 60_000).toISOString());
        const fresh = await runDoctor(true);
        const freshParsed = JSON.parse(fresh.stdout.find((l) => l.includes('"agents"')) ?? '');
        expect(freshParsed.usage.stale).toBe(false);
        expect(freshParsed.usage.age).toBeLessThan(120_000);

        writeUsageSnapshot(new Date(Date.now() - 7 * 3_600_000).toISOString());
        const stale = await runDoctor(true);
        expect(JSON.parse(stale.stdout.find((l) => l.includes('"agents"')) ?? '').usage.stale).toBe(true);

        rmSync(snapshotPath);
        const missing = await runDoctor(false);
        expect(missing.stdout.join('\n')).toContain('usage: none');
        // R3 scope: the missing producer snapshot itself is silent. Unrelated text-mode
        // warnings (e.g. B8 capability-declaration-stale) may legitimately appear.
        // 0899 R4: narrowed form kept deliberately — post-normalization a host with REAL
        // version drift still warns, so a broad no-warning assertion would be host-dependent.
        expect(missing.stderr.join('\n')).not.toMatch(/usage|snapshot|codexbar/i);
    });

    test('text table renders OWNER/SINCE/REASON with provenance from the project config', async () => {
        writeProjectConfig();
        const { code, stdout } = await runDoctor(false);
        expect(code).toBe(1);
        const table = stdout.join('\n');
        expect(table).toContain('OWNER');
        expect(table).toContain('SINCE');
        expect(table).toContain('REASON');
        expect(table).toContain('operator');
        expect(table).toContain('agent.quota.exhausted dis-obj');
    });
});
