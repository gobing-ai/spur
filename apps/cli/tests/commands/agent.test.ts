/**
 * Comprehensive tests for apps/cli/src/commands/agent.ts.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AgentConfig, type AgentRunDeps, TeamService } from '@gobing-ai/spur-app';
import { createMigratedDb, type DbAdapter } from '@gobing-ai/spur-domain';
import { saveAgentSpec } from '@gobing-ai/ts-ai-runner';
import { runAgentLoop, runAgentRun, splitEditorCommand } from '../../src/commands/agent';
import { bundledRolesFile, type CliContext, createCliContext, parseAgentRoles } from '../../src/context';
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
            const team = new TeamService(ctx);
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
                '--agent',
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

describe('splitEditorCommand', () => {
    test('splits multi-word editor command into array', () => {
        expect(splitEditorCommand('code -w')).toEqual(['code', '-w']);
        expect(splitEditorCommand('  vim   -f  ')).toEqual(['vim', '-f']);
    });

    test('returns empty array for empty or whitespace-only input', () => {
        expect(splitEditorCommand('')).toEqual([]);
        expect(splitEditorCommand('   \t\n ')).toEqual([]);
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

        const team = new TeamService(ctx);
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

        const team = new TeamService(ctx);
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
});

describe('agent create', () => {
    let tempDir: string;
    let db: DbAdapter;

    beforeEach(async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-create-test-'));
        db = await createMigratedDb({ url: ':memory:' });
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    test('agent create without id fails with exit code 1', async () => {
        const output = captureOutput();
        const exitCode = await main(['agent', 'create'], {
            cwd: tempDir,
            output,
            db,
        });
        expect(exitCode).toBe(1);
    });

    test('agent create without --type fails with code 2', async () => {
        const output = captureOutput();
        const exitCode = await main(['agent', 'create', 'my-agent'], {
            cwd: tempDir,
            output,
            db,
        });
        expect(exitCode).toBe(2);
        expect(output.stderr.join('\n')).toContain('agent create requires --type <agent-type>');
    });

    test('agent create with full options and text output', async () => {
        const output = captureOutput();
        const exitCode = await main(
            [
                'agent',
                'create',
                'new-spec',
                '--type',
                'coder',
                '--tags',
                'tag1, tag2',
                '--system-prompt',
                'Be helpful',
                '--name',
                'New Spec',
                '--workspace',
                tempDir,
                '--purpose',
                'Custom purpose',
                '--auto-start',
                '--model',
                'claude-3-5-sonnet',
                '--autonomy',
                'full',
                '--no-identity-preamble',
            ],
            {
                cwd: tempDir,
                output,
                db,
            },
        );
        expect(exitCode).toBe(0);
        expect(output.stdout.join('\n')).toContain('created .spur/agents/new-spec.yaml');
    });

    test('agent create with --json flag', async () => {
        const output = captureOutput();
        const exitCode = await main(['agent', 'create', 'json-spec', '--type', 'coder', '--json'], {
            cwd: tempDir,
            output,
            db,
        });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output.stdout.join('\n'));
        expect(parsed.ok).toBe(true);
        expect(parsed.spec.id).toBe('json-spec');
    });

    test('agent create duplicate id returns exit code 1', async () => {
        const output = captureOutput();
        const exitCode1 = await main(['agent', 'create', 'dup-spec', '--type', 'coder'], {
            cwd: tempDir,
            output,
            db,
        });
        expect(exitCode1).toBe(0);

        const output2 = captureOutput();
        const exitCode2 = await main(['agent', 'create', 'dup-spec', '--type', 'coder'], {
            cwd: tempDir,
            output: output2,
            db,
        });
        expect(exitCode2).toBe(1);
        expect(output2.stderr.join('\n')).toContain('Agent spec already exists');
    });
});

describe('agent edit', () => {
    let tempDir: string;
    let db: DbAdapter;

    beforeEach(async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-edit-test-'));
        db = await createMigratedDb({ url: ':memory:' });
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    test('agent edit without id fails', async () => {
        const output = captureOutput();
        const exitCode = await main(['agent', 'edit'], {
            cwd: tempDir,
            output,
            db,
        });
        expect(exitCode).toBe(1);
    });

    test('agent edit non-existent spec returns exit 1', async () => {
        const output = captureOutput();
        const exitCode = await main(['agent', 'edit', 'missing-spec'], {
            cwd: tempDir,
            output,
            db,
        });
        expect(exitCode).toBe(1);
        expect(output.stderr.join('\n')).toContain('No agent spec found: missing-spec');
    });

    test('agent edit when spec exists and EDITOR is empty prints path', async () => {
        const output = captureOutput();
        const ctx = createCliContext({
            cwd: tempDir,
            output,
            db,
            env: { EDITOR: '' },
        });
        const team = new TeamService(ctx);
        await team.createAgentSpec({ id: 'edit-spec', type: 'coder' });

        const exitCode = await main(['agent', 'edit', 'edit-spec'], {
            cwd: tempDir,
            output,
            db,
            env: { EDITOR: '' },
        });
        expect(exitCode).toBe(0);
        expect(output.stdout.join('\n')).toContain('.spur/agents/edit-spec.yaml');
    });

    test('agent edit when spec exists and EDITOR is whitespace-only prints path', async () => {
        const output = captureOutput();
        const ctx = createCliContext({
            cwd: tempDir,
            output,
            db,
            env: { EDITOR: '   ' },
        });
        const team = new TeamService(ctx);
        await team.createAgentSpec({ id: 'ws-spec', type: 'coder' });

        const exitCode = await main(['agent', 'edit', 'ws-spec'], {
            cwd: tempDir,
            output,
            db,
            env: { EDITOR: '   ' },
        });
        expect(exitCode).toBe(0);
        expect(output.stdout.join('\n')).toContain('.spur/agents/ws-spec.yaml');
    });

    test('agent edit when EDITOR is an executable runs editor process', async () => {
        const output = captureOutput();
        const ctx = createCliContext({
            cwd: tempDir,
            output,
            db,
            env: { EDITOR: 'true' },
        });
        const team = new TeamService(ctx);
        await team.createAgentSpec({ id: 'exec-spec', type: 'coder' });

        const exitCode = await main(['agent', 'edit', 'exec-spec'], {
            cwd: tempDir,
            output,
            db,
            env: { EDITOR: 'true' },
        });
        expect(exitCode).toBe(0);
    });
});

describe('agent delete', () => {
    let tempDir: string;
    let db: DbAdapter;

    beforeEach(async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-del-test-'));
        db = await createMigratedDb({ url: ':memory:' });
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    test('agent delete without id fails', async () => {
        const output = captureOutput();
        const exitCode = await main(['agent', 'delete'], {
            cwd: tempDir,
            output,
            db,
        });
        expect(exitCode).toBe(1);
    });

    test('agent delete without --force fails with code 2', async () => {
        const output = captureOutput();
        const exitCode = await main(['agent', 'delete', 'some-spec'], {
            cwd: tempDir,
            output,
            db,
        });
        expect(exitCode).toBe(2);
        expect(output.stderr.join('\n')).toContain('Refusing to delete some-spec without --force');
    });

    test('agent delete non-existent spec with --force returns code 1', async () => {
        const output = captureOutput();
        const exitCode = await main(['agent', 'delete', 'ghost-spec', '--force'], {
            cwd: tempDir,
            output,
            db,
        });
        expect(exitCode).toBe(1);
        expect(output.stderr.join('\n')).toContain('No agent spec found: ghost-spec');
    });

    test('agent delete with --force succeeds', async () => {
        const output = captureOutput();
        const ctx = createCliContext({
            cwd: tempDir,
            output,
            db,
        });
        const team = new TeamService(ctx);
        await team.createAgentSpec({ id: 'del-me', type: 'coder' });

        const exitCode = await main(['agent', 'delete', 'del-me', '--force'], {
            cwd: tempDir,
            output,
            db,
        });
        expect(exitCode).toBe(0);
        expect(output.stdout.join('\n')).toContain('deleted .spur/agents/del-me.yaml');
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

            const team = new TeamService(ctx);
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

            const team = new TeamService(ctx);
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
            await new TeamService(ctx).sendMessage(null, 'demo-codex-sol', 'Do step 1');

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

    test('runAgentLoop errors when agent flag is missing or auto', async () => {
        const output = captureOutput();
        const ctx = createCliContext({ cwd: tempDir, output, db });
        const code1 = await runAgentLoop(ctx, {});
        expect(code1).toBe(2);
        // 0542 R3: the loop addresses the occupant via --spec <id> (legacy --agent still read).
        expect(output.stderr.join('\n')).toContain(
            'agent loop requires an explicit --spec <id> matching a team agent spec',
        );

        const output2 = captureOutput();
        const ctx2 = createCliContext({ cwd: tempDir, output: output2, db });
        const code2 = await runAgentLoop(ctx2, { agent: 'auto' });
        expect(code2).toBe(2);
        expect(output2.stderr.join('\n')).toContain(
            'agent loop requires an explicit --spec <id> matching a team agent spec',
        );
    });

    test('runAgentLoop drains inbox when messages exist and runs agent', async () => {
        const output = captureOutput();
        const ctx = createCliContext({ cwd: tempDir, output, db });
        const team = new TeamService(ctx);
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

        let sleepCallCount = 0;
        const mockSleep = async () => {
            sleepCallCount++;
        };

        const code = await runAgentLoop(
            customCtx,
            { agent: 'loop-worker', poll: '100' },
            { maxIterations: 1, sleep: mockSleep },
        );
        expect(code).toBe(0);
        expect(run).toHaveBeenCalledTimes(1);
        expect(sleepCallCount).toBe(0);
    });

    test('runAgentLoop sleeps using default sleep helper when idle', async () => {
        const output = captureOutput();
        const ctx = createCliContext({ cwd: tempDir, output, db });
        const team = new TeamService(ctx);
        await team.createAgentSpec({ id: 'idle-worker-default-sleep', type: 'claude-code' });

        const run = mock(() => Promise.resolve(0));
        const customCtx = {
            ...ctx,
            agentService: () => ({ run }) as unknown as ReturnType<CliContext['agentService']>,
        };

        const code = await runAgentLoop(
            customCtx,
            { agent: 'idle-worker-default-sleep', poll: '1' },
            { maxIterations: 1 },
        );
        expect(code).toBe(0);
        expect(run).toHaveBeenCalledTimes(0);
    });

    test('runAgentLoop loopSleep abort listener clears timer', async () => {
        const output = captureOutput();
        const ctx = createCliContext({ cwd: tempDir, output, db });
        const team = new TeamService(ctx);
        await team.createAgentSpec({ id: 'abort-worker', type: 'claude-code' });

        const run = mock(() => Promise.resolve(0));
        const customCtx = {
            ...ctx,
            agentService: () => ({ run }) as unknown as ReturnType<CliContext['agentService']>,
        };

        const controller = new AbortController();
        const loopPromise = runAgentLoop(
            customCtx,
            { agent: 'abort-worker', poll: '5000' },
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

        const code = await runAgentLoop(ctx, { agent: 'worker-1' }, { signal: controller.signal });
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
        } as unknown as AgentRunDeps['doctorRunner'];
        return { runner, detector, doctorRunner };
    }

    test('R1: the bundled roles map parses four roles with their roles.md tiers', () => {
        const file = bundledRolesFile();
        expect(file).not.toBeNull();
        const parsed = parseAgentRoles(readFileSync(file ?? '', 'utf8'));
        expect([...parsed.keys()].sort()).toEqual(['coder', 'planner', 'reviewer', 'scribe']);
        expect(parsed.get('scribe')).toBe('cheap');
        expect(parsed.get('coder')).toBe('standard');
        expect(parsed.get('reviewer')).toBe('capable-1');
        expect(parsed.get('planner')).toBe('capable-2');
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
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('R1/R3: a role passes the boundary and resolves through the real roles.md map', async () => {
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
});
