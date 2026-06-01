import { describe, expect, mock, test } from 'bun:test';
import type { AgentName, AgentRunResult } from '@gobing-ai/ts-ai-runner';
import { TIER1_PRIORITY } from '@gobing-ai/ts-ai-runner';
import { type AgentRunDeps, runAgentCommand, runAgentRun } from '../../src/commands/agent';
import { createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

function captureOutput(): { output: CommandOutput; lines: string[]; errors: string[] } {
    const lines: string[] = [];
    const errors: string[] = [];
    return {
        lines,
        errors,
        output: {
            write: (msg: string) => lines.push(msg),
            error: (msg: string) => errors.push(msg),
        },
    };
}

function makeRunResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
    return {
        exitCode: 0,
        stdout: 'hello from agent',
        stderr: '',
        durationMs: 42,
        ...overrides,
    };
}

function mockDoctorResult(overrides: Partial<{ installed: boolean; usable: boolean; tier: 1 | 2 }> = {}) {
    return {
        agent: 'pi',
        installed: overrides.installed ?? true,
        version: '1.0.0',
        authenticated: true,
        usable: overrides.usable ?? true,
        tier: (overrides.tier ?? 1) as 1 | 2,
        channels: [],
        error: null,
    };
}

interface MockRunner {
    runPromptCommand: ReturnType<typeof mock>;
}

interface MockDetector {
    detectOne: ReturnType<typeof mock>;
}

interface MockDoctorRunner {
    runAll?: ReturnType<typeof mock>;
    runOne: ReturnType<typeof mock>;
}

function mockDeps(runResult?: AgentRunResult): {
    deps: AgentRunDeps;
    runner: MockRunner;
    detector: MockDetector;
    doctor: MockDoctorRunner;
} {
    const result = runResult ?? makeRunResult();
    const runner: MockRunner = {
        runPromptCommand: mock(() => Promise.resolve(result)),
    };
    const detector: MockDetector = {
        detectOne: mock(() =>
            Promise.resolve({
                name: 'pi',
                installed: true,
                version: '1.0.0',
                channels: [],
                error: null,
            }),
        ),
    };
    const doctor: MockDoctorRunner = {
        runOne: mock(() => Promise.resolve(mockDoctorResult())),
        runAll: mock(() => Promise.resolve([mockDoctorResult({ installed: true, usable: true })])),
    };
    return {
        deps: {
            runner: runner as unknown as AgentRunDeps['runner'],
            detector: detector as unknown as AgentRunDeps['detector'],
            doctorRunner: doctor as unknown as AgentRunDeps['doctorRunner'],
        },
        runner,
        detector,
        doctor,
    };
}

// ---------------------------------------------------------------------------
// Tests: runAgentCommand dispatch
// ---------------------------------------------------------------------------

describe('runAgentCommand dispatch', () => {
    test('unknown subcommand returns error', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runAgentCommand('unknown-cmd', ctx, {}, []);
        expect(exitCode).toBe(1);
    });

    test('list subcommand returns exit code', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runAgentCommand('list', ctx, {}, []);
        expect(typeof exitCode).toBe('number');
    });

    test('run subcommand dispatches (missing prompt → exit 2)', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runAgentCommand('run', ctx, {}, []);
        expect(exitCode).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Tests: runAgentRun — validation
// ---------------------------------------------------------------------------

describe('runAgentRun validation', () => {
    test('missing prompt → exit 2', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runAgentRun(undefined, ctx, {});
        expect(exitCode).toBe(2);
    });

    test('invalid --mode → exit 2', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runAgentRun('hello', ctx, { mode: 'xml' });
        expect(exitCode).toBe(2);
    });

    test('invalid --agent → exit 2', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runAgentRun('hello', ctx, { agent: 'not-an-agent' });
        expect(exitCode).toBe(2);
    });

    test('--cwd missing path → exit 2', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runAgentRun('hello', ctx, { cwd: '/nonexistent/path/xyzzy' });
        expect(exitCode).toBe(2);
    });

    test('--cwd file not dir → exit 2', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runAgentRun('hello', ctx, { cwd: import.meta.path });
        expect(exitCode).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Tests: runAgentRun — agent resolution
// ---------------------------------------------------------------------------

describe('runAgentRun agent resolution', () => {
    test('--agent auto selects first usable Tier-1', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const runResult = makeRunResult();
        const runner = {
            runPromptCommand: mock(() => Promise.resolve(runResult)),
        } as unknown as AgentRunDeps['runner'];
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({
                    name: 'pi',
                    installed: true,
                    version: '1.0.0',
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runAll: mock(() =>
                Promise.resolve([
                    {
                        agent: 'claude',
                        installed: false,
                        version: null,
                        authenticated: false,
                        usable: false,
                        tier: 1 as const,
                        channels: [],
                        error: 'not found',
                    },
                    {
                        agent: 'pi',
                        installed: true,
                        version: '1.0.0',
                        authenticated: true,
                        usable: true,
                        tier: 1 as const,
                        channels: [],
                        error: null,
                    },
                ]),
            ),
        } as unknown as AgentRunDeps['doctorRunner'];

        const deps: AgentRunDeps = { runner, detector, doctorRunner };
        const exitCode = await runAgentRun('hello', ctx, {}, deps);
        expect(exitCode).toBe(0);
        expect(doctorRunner?.runAll).toHaveBeenCalledTimes(1);
        expect(runner?.runPromptCommand).toHaveBeenCalled();
    });

    test('--agent auto no usable Tier-1 → exit 1', async () => {
        const { errors, output } = captureOutput();
        const ctx = createCliContext({ output });

        const doctorRunner = {
            runAll: mock(() =>
                Promise.resolve(
                    TIER1_PRIORITY.map((name: string) => ({
                        agent: name,
                        installed: false,
                        version: null,
                        authenticated: false,
                        usable: false,
                        tier: 1 as const,
                        channels: [],
                        error: 'not found',
                    })),
                ),
            ),
        } as unknown as AgentRunDeps['doctorRunner'];

        // We need a doctorRunner only — runner/detector defaults will be constructed
        const deps: AgentRunDeps = { doctorRunner };
        const exitCode = await runAgentRun('hello', ctx, {}, deps);
        expect(exitCode).toBe(1);
        expect(errors.some((e) => e.includes('No usable Tier-1'))).toBe(true);
    });

    test('--agent current reads SPUR_AGENT env var', async () => {
        const { output } = captureOutput();
        const ctx = createCliContext({ env: { SPUR_AGENT: 'pi' }, output });
        const runResult = makeRunResult();

        const runner = {
            runPromptCommand: mock(() => Promise.resolve(runResult)),
        } as unknown as AgentRunDeps['runner'];
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({
                    name: 'pi',
                    installed: true,
                    version: '1.0.0',
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() => Promise.resolve(mockDoctorResult())),
        } as unknown as AgentRunDeps['doctorRunner'];

        const deps: AgentRunDeps = { runner, detector, doctorRunner };
        const exitCode = await runAgentRun('hello', ctx, { agent: 'current' }, deps);
        expect(exitCode).toBe(0);
        expect(doctorRunner?.runOne).toHaveBeenCalledWith('pi');
    });

    test('--agent current SPUR_AGENT unset → exit 2', async () => {
        const ctx = createCliContext({ env: {}, output: nullOutput() });
        const exitCode = await runAgentRun('hello', ctx, { agent: 'current' });
        expect(exitCode).toBe(2);
    });

    test('--agent explicit not installed → exit 1', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const doctorRunner = {
            runOne: mock(() =>
                Promise.resolve({
                    agent: 'antigravity',
                    installed: false,
                    version: null,
                    authenticated: false,
                    usable: false,
                    tier: 2 as const,
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['doctorRunner'];

        const deps: AgentRunDeps = { doctorRunner };
        const exitCode = await runAgentRun('hello', ctx, { agent: 'antigravity' }, deps);
        expect(exitCode).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Tests: runAgentRun — slash-command translation
// ---------------------------------------------------------------------------

describe('runAgentRun slash-command translation', () => {
    test('/plugin:command → claude pass-through', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const deps = makeSimpleDeps('claude');
        const exitCode = await runAgentRun('/rd3:dev-run', ctx, { agent: 'claude' }, deps);
        expect(exitCode).toBe(0);
        const callArgs = (deps.runPromptCommand as ReturnType<typeof mock>).mock.calls[0] as [
            string,
            { input: string },
            unknown,
        ];
        expect(callArgs[1].input).toBe('/rd3:dev-run');
    });

    test('/plugin:command → codex $ translation', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const deps = makeSimpleDeps('codex');
        const exitCode = await runAgentRun('/rd3:dev-run args', ctx, { agent: 'codex' }, deps);
        expect(exitCode).toBe(0);
        const callArgs = (deps.runPromptCommand as ReturnType<typeof mock>).mock.calls[0] as [
            string,
            { input: string },
            unknown,
        ];
        expect(callArgs[1].input).toBe('$rd3-dev-run args');
    });

    test('/plugin:command → pi /skill translation', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const deps = makeSimpleDeps('pi');
        const exitCode = await runAgentRun('/rd3:dev-run', ctx, { agent: 'pi' }, deps);
        expect(exitCode).toBe(0);
        const callArgs = (deps.runPromptCommand as ReturnType<typeof mock>).mock.calls[0] as [
            string,
            { input: string },
            unknown,
        ];
        expect(callArgs[1].input).toBe('/skill:rd3-dev-run');
    });

    test('/plugin:command → gemini default translation', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const deps = makeSimpleDeps('gemini');
        const exitCode = await runAgentRun('/rd3:dev-run', ctx, { agent: 'gemini' }, deps);
        expect(exitCode).toBe(0);
        const callArgs = (deps.runPromptCommand as ReturnType<typeof mock>).mock.calls[0] as [
            string,
            { input: string },
            unknown,
        ];
        expect(callArgs[1].input).toBe('/rd3-dev-run');
    });

    test('non-slash-command passes through unchanged', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const deps = makeSimpleDeps('pi');
        const exitCode = await runAgentRun('Fix the login bug', ctx, { agent: 'pi' }, deps);
        expect(exitCode).toBe(0);
        const callArgs = (deps.runPromptCommand as ReturnType<typeof mock>).mock.calls[0] as [
            string,
            { input: string },
            unknown,
        ];
        expect(callArgs[1].input).toBe('Fix the login bug');
    });
});

// Helper for slash-command tests that only need a runner + the detector/doctor to resolve the agent
function makeSimpleDeps(_agent: AgentName): { runPromptCommand: ReturnType<typeof mock> } & AgentRunDeps {
    const runResult = makeRunResult();
    const runPromptCommand = mock(() => Promise.resolve(runResult));
    const runner = { runPromptCommand } as unknown as AgentRunDeps['runner'];
    const detector = {
        detectOne: mock(() =>
            Promise.resolve({
                name: _agent,
                installed: true,
                version: '1.0.0',
                channels: [],
                error: null,
            }),
        ),
    } as unknown as AgentRunDeps['detector'];
    const doctorRunner = {
        runOne: mock(() => Promise.resolve(mockDoctorResult())),
    } as unknown as AgentRunDeps['doctorRunner'];
    return { runPromptCommand, runner, detector, doctorRunner };
}

// ---------------------------------------------------------------------------
// Tests: runAgentRun — output handling
// ---------------------------------------------------------------------------

describe('runAgentRun output handling', () => {
    test('--json outputs JSON envelope', async () => {
        const { lines, output } = captureOutput();
        const ctx = createCliContext({ output });
        const runResult = makeRunResult({ stdout: 'result', stderr: '' });

        const runner = {
            runPromptCommand: mock(() => Promise.resolve(runResult)),
        } as unknown as AgentRunDeps['runner'];
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({
                    name: 'pi',
                    installed: true,
                    version: '1.0.0',
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() => Promise.resolve(mockDoctorResult())),
        } as unknown as AgentRunDeps['doctorRunner'];

        const deps: AgentRunDeps = { runner, detector, doctorRunner };
        const exitCode = await runAgentRun('hello', ctx, { agent: 'pi', json: true }, deps);
        expect(exitCode).toBe(0);

        const jsonLine = lines.find((l) => l.includes('"exitCode"'));
        expect(jsonLine).toBeDefined();
        const parsed = JSON.parse(jsonLine ?? '');
        expect(parsed.exitCode).toBe(0);
        expect(parsed.stdout).toBe('result');
        expect(parsed.durationMs).toBe(42);
    });

    test('runPromptCommand unexpected throw → exit 2', async () => {
        const { errors, output } = captureOutput();
        const ctx = createCliContext({ output });

        const runner = {
            runPromptCommand: mock(() => {
                throw new Error('ENOENT: spawn failed');
            }),
        } as unknown as AgentRunDeps['runner'];
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({
                    name: 'pi',
                    installed: true,
                    version: '1.0.0',
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() => Promise.resolve(mockDoctorResult())),
        } as unknown as AgentRunDeps['doctorRunner'];

        const deps: AgentRunDeps = { runner, detector, doctorRunner };
        const exitCode = await runAgentRun('hello', ctx, { agent: 'pi' }, deps);
        expect(exitCode).toBe(2);
        expect(errors.some((e) => e.includes('ENOENT'))).toBe(true);
    });

    test('agent non-zero exit → exit 3', async () => {
        const { errors, output } = captureOutput();
        const ctx = createCliContext({ output });
        const runResult = makeRunResult({ exitCode: 1, stdout: '', stderr: 'failed' });

        const runner = {
            runPromptCommand: mock(() => Promise.resolve(runResult)),
        } as unknown as AgentRunDeps['runner'];
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({
                    name: 'pi',
                    installed: true,
                    version: '1.0.0',
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() => Promise.resolve(mockDoctorResult())),
        } as unknown as AgentRunDeps['doctorRunner'];

        const deps: AgentRunDeps = { runner, detector, doctorRunner };
        const exitCode = await runAgentRun('hello', ctx, { agent: 'pi' }, deps);
        expect(exitCode).toBe(3);
        expect(errors.some((e) => e.includes('exited with code 1'))).toBe(true);
    });

    test('agent signal termination → exit 3', async () => {
        const { errors, output } = captureOutput();
        const ctx = createCliContext({ output });
        const runResult = makeRunResult({ exitCode: null, signal: 'SIGTERM', stdout: '', stderr: '' });

        const runner = {
            runPromptCommand: mock(() => Promise.resolve(runResult)),
        } as unknown as AgentRunDeps['runner'];
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({
                    name: 'pi',
                    installed: true,
                    version: '1.0.0',
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() => Promise.resolve(mockDoctorResult())),
        } as unknown as AgentRunDeps['doctorRunner'];

        const deps: AgentRunDeps = { runner, detector, doctorRunner };
        const exitCode = await runAgentRun('hello', ctx, { agent: 'pi' }, deps);
        expect(exitCode).toBe(3);
        expect(errors.some((e) => e.includes('SIGTERM'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Tests: runAgentRun — Tier-2 warning
// ---------------------------------------------------------------------------

describe('runAgentRun Tier-2 warning', () => {
    test('Tier-2 agent emits warning to stderr', async () => {
        const { errors, output } = captureOutput();
        const ctx = createCliContext({ output });
        const runResult = makeRunResult();

        const runner = {
            runPromptCommand: mock(() => Promise.resolve(runResult)),
        } as unknown as AgentRunDeps['runner'];
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({
                    name: 'antigravity',
                    installed: true,
                    version: '2.0.0',
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() =>
                Promise.resolve({
                    agent: 'antigravity',
                    installed: true,
                    version: '2.0.0',
                    authenticated: true,
                    usable: true,
                    tier: 2 as const,
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['doctorRunner'];

        const deps: AgentRunDeps = { runner, detector, doctorRunner };
        const exitCode = await runAgentRun('hello', ctx, { agent: 'antigravity' }, deps);
        expect(exitCode).toBe(0);
        expect(errors.some((e) => e.includes('Tier-2 agent'))).toBe(true);
    });

    test('Tier-2 warning suppressed in --json mode', async () => {
        const { errors, output } = captureOutput();
        const ctx = createCliContext({ output });
        const runResult = makeRunResult();

        const runner = {
            runPromptCommand: mock(() => Promise.resolve(runResult)),
        } as unknown as AgentRunDeps['runner'];
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({
                    name: 'antigravity',
                    installed: true,
                    version: '2.0.0',
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() =>
                Promise.resolve({
                    agent: 'antigravity',
                    installed: true,
                    version: '2.0.0',
                    authenticated: true,
                    usable: true,
                    tier: 2 as const,
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['doctorRunner'];

        const deps: AgentRunDeps = { runner, detector, doctorRunner };
        const exitCode = await runAgentRun('hello', ctx, { agent: 'antigravity', json: true }, deps);
        expect(exitCode).toBe(0);
        expect(errors.some((e) => e.includes('Tier-2 agent'))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Tests: runAgentRun — codex resume
// ---------------------------------------------------------------------------

describe('runAgentRun codex resume', () => {
    test('--continue + prompt: shim throws during diagnostics → exit 2', async () => {
        const { errors, output } = captureOutput();
        const ctx = createCliContext({ output });

        const runner = {
            runPromptCommand: mock(() => Promise.resolve(makeRunResult())),
        } as unknown as AgentRunDeps['runner'];
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({
                    name: 'codex',
                    installed: true,
                    version: '1.0.0',
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() =>
                Promise.resolve({
                    agent: 'codex',
                    installed: true,
                    version: '1.0.0',
                    authenticated: true,
                    usable: true,
                    tier: 1 as const,
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['doctorRunner'];

        const deps: AgentRunDeps = { runner, detector, doctorRunner };
        // continue=true + prompt=defined → codex shim's getPromptCommand throws
        const exitCode = await runAgentRun('extra prompt', ctx, { agent: 'codex', continue: true }, deps);
        expect(exitCode).toBe(2);
        expect(errors.some((e) => e.includes('Codex resume mode'))).toBe(true);
    });

    test('--continue without prompt (valid codex resume) succeeds', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const runResult = makeRunResult();

        const runner = {
            runPromptCommand: mock(() => Promise.resolve(runResult)),
        } as unknown as AgentRunDeps['runner'];
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({
                    name: 'codex',
                    installed: true,
                    version: '1.0.0',
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() =>
                Promise.resolve({
                    agent: 'codex',
                    installed: true,
                    version: '1.0.0',
                    authenticated: true,
                    usable: true,
                    tier: 1 as const,
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['doctorRunner'];

        const deps: AgentRunDeps = { runner, detector, doctorRunner };
        const exitCode = await runAgentRun(undefined, ctx, { agent: 'codex', continue: true }, deps);
        expect(exitCode).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Tests: runAgentRun — diagnostics
// ---------------------------------------------------------------------------

describe('runAgentRun diagnostics', () => {
    test('diagnostics emitted to stderr in text mode', async () => {
        const { errors, output } = captureOutput();
        const ctx = createCliContext({ output });
        const runResult = makeRunResult();

        const runner = {
            runPromptCommand: mock(() => Promise.resolve(runResult)),
        } as unknown as AgentRunDeps['runner'];
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({
                    name: 'pi',
                    installed: true,
                    version: '1.2.3',
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() => Promise.resolve(mockDoctorResult({ installed: true, usable: true }))),
        } as unknown as AgentRunDeps['doctorRunner'];

        const deps: AgentRunDeps = { runner, detector, doctorRunner };
        const exitCode = await runAgentRun('hello', ctx, { agent: 'pi' }, deps);
        expect(exitCode).toBe(0);
        expect(errors.some((e) => e.includes('⚙️'))).toBe(true);
        expect(errors.some((e) => e.includes('pi v1.2.3'))).toBe(true);
    });

    test('diagnostics suppressed in --json mode', async () => {
        const { errors, output } = captureOutput();
        const ctx = createCliContext({ output });
        const runResult = makeRunResult();

        const runner = {
            runPromptCommand: mock(() => Promise.resolve(runResult)),
        } as unknown as AgentRunDeps['runner'];
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({
                    name: 'pi',
                    installed: true,
                    version: '1.2.3',
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() => Promise.resolve(mockDoctorResult({ installed: true, usable: true }))),
        } as unknown as AgentRunDeps['doctorRunner'];

        const deps: AgentRunDeps = { runner, detector, doctorRunner };
        const exitCode = await runAgentRun('hello', ctx, { agent: 'pi', json: true }, deps);
        expect(exitCode).toBe(0);
        expect(errors.some((e) => e.includes('⚙️'))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Tests: runAgentRun — --mode flag propagation
// ---------------------------------------------------------------------------

describe('runAgentRun --mode flag', () => {
    test('--mode json passes through to PromptOptions', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const { deps, runner } = mockDeps();
        await runAgentRun('hello', ctx, { agent: 'pi', mode: 'json' }, deps);

        const callArgs = runner.runPromptCommand.mock.calls[0] as [string, { mode: string }, unknown];
        expect(callArgs[1].mode).toBe('json');
    });

    test('--mode text is default', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const { deps, runner } = mockDeps();
        await runAgentRun('hello', ctx, { agent: 'pi' }, deps);

        const callArgs = runner.runPromptCommand.mock.calls[0] as [string, { mode: string }, unknown];
        expect(callArgs[1].mode).toBe('text');
    });
});

// ---------------------------------------------------------------------------
// Tests: runAgentRun — --cwd propagation
// ---------------------------------------------------------------------------

describe('runAgentRun --cwd flag', () => {
    test('--cwd propagates to AgentRunOptions', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const { deps, runner } = mockDeps();
        await runAgentRun('hello', ctx, { agent: 'pi', cwd: '/tmp' }, deps);

        const callArgs = runner.runPromptCommand.mock.calls[0] as [string, unknown, { cwd: string }];
        expect(callArgs[2].cwd).toBe('/tmp');
    });
});
