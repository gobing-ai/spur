/**
 * Comprehensive tests for apps/cli/src/commands/agent.ts.
 */
import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    _resetAgentServiceShimsForTest,
    type AgentConfig,
    AgentCoordinationService,
    type AgentRunDeps,
} from '@gobing-ai/spur-app';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { AgentDetector, saveAgentSpec } from '@gobing-ai/ts-ai-runner';
import { runAgentRun, validateAgentSelector } from '../../../src/commands/agent';
import { type CliContext, createCliContext, resolveAgentRoles } from '../../../src/context';
import { main } from '../../../src/index';
import type { CommandOutput } from '../../../src/output';

/**
 * CLI-spawning / fingerprint tests: `agent doctor` measures ~1.5s on a quiet host and 7-8s while
 * the agent fleet runs, against bun's 5000ms default — the calibration is recorded here once.
 */
const slowTest = (name: string, fn: () => Promise<void> | void): void => void test(name, fn, 30_000);

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

// ---------------------------------------------------------------------------
// 0893 R4: doctor availability provenance + usage snapshot, end-to-end through
// main() — the real AgentService renders whatever the project config and the
// producer snapshot contain (no service shims in this describe).
// ---------------------------------------------------------------------------

describe('agent command (main)', () => {
    slowTest('list renders detected agent state through the CLI JSON action', async () => {
        // Installation probes have separate detector coverage. This command
        // fixture must not depend on every coding agent installed on the host.
        const agents = [{ name: 'claude' as const, installed: true, version: '1.0.0', channels: [], error: null }];
        const detect = spyOn(AgentDetector.prototype, 'detectAll').mockResolvedValue(agents);
        const output = captureOutput();
        try {
            const exitCode = await main(['agent', 'list', '--json'], { output });
            expect(exitCode).toBe(0);
            expect(JSON.parse(output.stdout.join(''))).toEqual({ agents });
            expect(detect).toHaveBeenCalledTimes(1);
        } finally {
            detect.mockRestore();
        }
    });

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

        const { registerAgentCommand } = await import('../../../src/commands/agent');
        registerAgentCommand(program, context);
        await program.parseAsync(['node', 'test', 'agent', 'run', 'test prompt', '--agent', 'auto']);
        expect(exitCode).toBe(0);
        expect(run).toHaveBeenCalledTimes(1);
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
            await team.createAgentSpec({ id: 'worker-1', type: 'pi', executor: 'pi' });
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
            await team.createAgentSpec({ id: 'worker-2', type: 'pi', executor: 'pi' });
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
