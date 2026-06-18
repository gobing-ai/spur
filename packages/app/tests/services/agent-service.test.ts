import { describe, expect, mock, test } from 'bun:test';
import type { AgentName, AgentRunResult } from '@gobing-ai/ts-ai-runner';
import { TIER1_PRIORITY } from '@gobing-ai/ts-ai-runner';
import { type AgentRunDeps, AgentService, type AgentServiceOutput } from '../../src/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nullOutput(): AgentServiceOutput {
    return { write: () => {}, error: () => {} };
}

function captureOutput(): { output: AgentServiceOutput; lines: string[]; errors: string[] } {
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

function makeService(env: Record<string, string | undefined> = {}, output = nullOutput()) {
    return new AgentService({ cwd: process.cwd(), env, output });
}

// ---------------------------------------------------------------------------
// Tests: AgentService.list
// ---------------------------------------------------------------------------

describe('AgentService.list', () => {
    test('returns exit 0', async () => {
        const svc = makeService();
        const exitCode = await svc.list({ json: false });
        expect(typeof exitCode).toBe('number');
        expect(exitCode).toBe(0);
    });

    test('--json outputs JSON envelope', async () => {
        const { lines, output } = captureOutput();
        const svc = makeService({}, output);
        const exitCode = await svc.list({ json: true });
        expect(exitCode).toBe(0);
        const jsonLine = lines.find((l) => l.includes('"agents"'));
        expect(jsonLine).toBeDefined();
        const parsed = JSON.parse(jsonLine ?? '');
        expect(Array.isArray(parsed.agents)).toBe(true);
    });

    test('plain output has ok/missing prefix lines', async () => {
        const { lines, output } = captureOutput();
        const svc = makeService({}, output);
        await svc.list({ json: false });
        expect(lines.length).toBeGreaterThanOrEqual(1);
        const text = lines[0] ?? '';
        // Each line starts with 'ok' or 'missing'
        expect(text).toMatch(/^(ok|missing)/m);
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService.doctor
// ---------------------------------------------------------------------------

describe('AgentService.doctor', () => {
    test('returns exit 0 for all usable agents', async () => {
        const svc = makeService();
        const doctorRunner = {
            runAll: mock(() => Promise.resolve([mockDoctorResult({ installed: true, usable: true })])),
            runOne: mock(() => Promise.resolve(mockDoctorResult({ installed: true, usable: true }))),
        } as unknown as AgentRunDeps['doctorRunner'];
        const exitCode = await svc.doctor({ json: false }, { doctorRunner });
        expect(exitCode).toBe(0);
    });

    test('--json outputs JSON envelope', async () => {
        const { lines, output } = captureOutput();
        const svc = makeService({}, output);
        const doctorRunner = {
            runAll: mock(() => Promise.resolve([mockDoctorResult({ installed: true, usable: true })])),
            runOne: mock(() => Promise.resolve(mockDoctorResult({ installed: true, usable: true }))),
        } as unknown as AgentRunDeps['doctorRunner'];
        const exitCode = await svc.doctor({ json: true }, { doctorRunner });
        expect(exitCode).toBe(0);
        const jsonLine = lines.find((l) => l.includes('"agents"'));
        expect(jsonLine).toBeDefined();
    });

    test('non-usable Tier-1 agent exits 1', async () => {
        const svc = makeService();
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
                ]),
            ),
            runOne: mock(() =>
                Promise.resolve({
                    agent: 'claude',
                    installed: false,
                    version: null,
                    authenticated: false,
                    usable: false,
                    tier: 1 as const,
                    channels: [],
                    error: 'not found',
                }),
            ),
        } as unknown as AgentRunDeps['doctorRunner'];
        const exitCode = await svc.doctor({ json: false }, { doctorRunner });
        expect(exitCode).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService.run — validation
// ---------------------------------------------------------------------------

describe('AgentService.run validation', () => {
    test('missing prompt → exit 2', async () => {
        const svc = makeService();
        const exitCode = await svc.run(undefined, {});
        expect(exitCode).toBe(2);
    });

    test('invalid --mode → exit 2', async () => {
        const svc = makeService();
        const exitCode = await svc.run('hello', { mode: 'xml' });
        expect(exitCode).toBe(2);
    });

    test('invalid --agent → exit 2', async () => {
        const svc = makeService();
        const exitCode = await svc.run('hello', { agent: 'not-an-agent' });
        expect(exitCode).toBe(2);
    });

    test('--cwd missing path → exit 2', async () => {
        const svc = makeService();
        const exitCode = await svc.run('hello', { cwd: '/nonexistent/path/xyzzy' });
        expect(exitCode).toBe(2);
    });

    test('--cwd file not dir → exit 2', async () => {
        const svc = makeService();
        const exitCode = await svc.run('hello', { cwd: import.meta.path });
        expect(exitCode).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService.run — team-mode identity flags
// ---------------------------------------------------------------------------

describe('AgentService.run team-mode flags', () => {
    test('--purpose, --tags, --system-prompt, --task reach PromptOptions', async () => {
        const svc = makeService();
        const { deps, runner } = mockDeps();
        const exitCode = await svc.run(
            'hello',
            {
                agent: 'pi',
                json: true,
                purpose: 'plan the work',
                tags: 'alpha, beta ,',
                'system-prompt': 'be terse',
                task: '0042',
            },
            deps,
        );
        expect(exitCode).toBe(0);
        const call = runner.runPromptCommand.mock.calls[0];
        const promptOptions = call?.[1] as {
            purpose?: string;
            tags?: string[];
            systemPrompt?: string;
            taskId?: string;
        };
        expect(promptOptions.purpose).toBe('plan the work');
        // tags are split, trimmed, and emptied entries dropped.
        expect(promptOptions.tags).toEqual(['alpha', 'beta']);
        expect(promptOptions.systemPrompt).toBe('be terse');
        expect(promptOptions.taskId).toBe('0042');
    });

    test('omits team-mode fields from PromptOptions when flags are absent', async () => {
        const svc = makeService();
        const { deps, runner } = mockDeps();
        const exitCode = await svc.run('hello', { agent: 'pi', json: true }, deps);
        expect(exitCode).toBe(0);
        const promptOptions = runner.runPromptCommand.mock.calls[0]?.[1] as Record<string, unknown>;
        expect(promptOptions.purpose).toBeUndefined();
        expect(promptOptions.tags).toBeUndefined();
        expect(promptOptions.systemPrompt).toBeUndefined();
        expect(promptOptions.taskId).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService.run — agent resolution
// ---------------------------------------------------------------------------

describe('AgentService.run agent resolution', () => {
    test('--agent auto selects first usable Tier-1', async () => {
        const svc = makeService();
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
        const exitCode = await svc.run('hello', {}, deps);
        expect(exitCode).toBe(0);
        expect(doctorRunner?.runAll).toHaveBeenCalledTimes(1);
        expect(runner?.runPromptCommand).toHaveBeenCalled();
    });

    test('--agent auto no usable Tier-1 → exit 1', async () => {
        const { errors, output } = captureOutput();
        const svc = makeService({}, output);

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

        const deps: AgentRunDeps = { doctorRunner };
        const exitCode = await svc.run('hello', {}, deps);
        expect(exitCode).toBe(1);
        expect(errors.some((e) => e.includes('No usable Tier-1'))).toBe(true);
    });

    test('--agent current reads SPUR_AGENT env var', async () => {
        const { output } = captureOutput();
        const svc = makeService({ SPUR_AGENT: 'pi' }, output);
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
        const exitCode = await svc.run('hello', { agent: 'current' }, deps);
        expect(exitCode).toBe(0);
        expect(doctorRunner?.runOne).toHaveBeenCalledWith('pi');
    });

    test('--agent current SPUR_AGENT unset → exit 2', async () => {
        const svc = makeService({});
        const exitCode = await svc.run('hello', { agent: 'current' });
        expect(exitCode).toBe(2);
    });

    test('--agent explicit not installed → exit 1', async () => {
        const svc = makeService();
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
        const exitCode = await svc.run('hello', { agent: 'antigravity' }, deps);
        expect(exitCode).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService.run — slash-command translation
// ---------------------------------------------------------------------------

describe('AgentService.run slash-command translation', () => {
    test('/plugin:command → claude pass-through', async () => {
        const svc = makeService();
        const deps = makeSimpleDeps('claude');
        const exitCode = await svc.run('/rd3:dev-run', { agent: 'claude' }, deps);
        expect(exitCode).toBe(0);
        const callArgs = (deps.runPromptCommand as ReturnType<typeof mock>).mock.calls[0] as [
            string,
            { input: string },
            unknown,
        ];
        expect(callArgs[1].input).toBe('/rd3:dev-run');
    });

    test('/plugin:command → codex $ translation', async () => {
        const svc = makeService();
        const deps = makeSimpleDeps('codex');
        const exitCode = await svc.run('/rd3:dev-run args', { agent: 'codex' }, deps);
        expect(exitCode).toBe(0);
        const callArgs = (deps.runPromptCommand as ReturnType<typeof mock>).mock.calls[0] as [
            string,
            { input: string },
            unknown,
        ];
        expect(callArgs[1].input).toBe('$rd3-dev-run args');
    });

    test('/plugin:command → pi /skill translation', async () => {
        const svc = makeService();
        const deps = makeSimpleDeps('pi');
        const exitCode = await svc.run('/rd3:dev-run', { agent: 'pi' }, deps);
        expect(exitCode).toBe(0);
        const callArgs = (deps.runPromptCommand as ReturnType<typeof mock>).mock.calls[0] as [
            string,
            { input: string },
            unknown,
        ];
        expect(callArgs[1].input).toBe('/skill:rd3-dev-run');
    });

    test('/plugin:command → gemini default translation', async () => {
        const svc = makeService();
        const deps = makeSimpleDeps('gemini');
        const exitCode = await svc.run('/rd3:dev-run', { agent: 'gemini' }, deps);
        expect(exitCode).toBe(0);
        const callArgs = (deps.runPromptCommand as ReturnType<typeof mock>).mock.calls[0] as [
            string,
            { input: string },
            unknown,
        ];
        expect(callArgs[1].input).toBe('/rd3-dev-run');
    });

    test('non-slash-command passes through unchanged', async () => {
        const svc = makeService();
        const deps = makeSimpleDeps('pi');
        const exitCode = await svc.run('Fix the login bug', { agent: 'pi' }, deps);
        expect(exitCode).toBe(0);
        const callArgs = (deps.runPromptCommand as ReturnType<typeof mock>).mock.calls[0] as [
            string,
            { input: string },
            unknown,
        ];
        expect(callArgs[1].input).toBe('Fix the login bug');
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService.run — output handling
// ---------------------------------------------------------------------------

describe('AgentService.run output handling', () => {
    test('--json outputs JSON envelope', async () => {
        const { lines, output } = captureOutput();
        const svc = makeService({}, output);
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
        const exitCode = await svc.run('hello', { agent: 'pi', json: true }, deps);
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
        const svc = makeService({}, output);

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
        const exitCode = await svc.run('hello', { agent: 'pi' }, deps);
        expect(exitCode).toBe(2);
        expect(errors.some((e) => e.includes('ENOENT'))).toBe(true);
    });

    test('agent non-zero exit → exit 3', async () => {
        const { errors, output } = captureOutput();
        const svc = makeService({}, output);
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
        const exitCode = await svc.run('hello', { agent: 'pi' }, deps);
        expect(exitCode).toBe(3);
        expect(errors.some((e) => e.includes('exited with code 1'))).toBe(true);
    });

    test('agent signal termination → exit 3', async () => {
        const { errors, output } = captureOutput();
        const svc = makeService({}, output);
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
        const exitCode = await svc.run('hello', { agent: 'pi' }, deps);
        expect(exitCode).toBe(3);
        expect(errors.some((e) => e.includes('SIGTERM'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService.run — Tier-2 warning
// ---------------------------------------------------------------------------

describe('AgentService.run Tier-2 warning', () => {
    test('Tier-2 agent emits warning to stderr', async () => {
        const { errors, output } = captureOutput();
        const svc = makeService({}, output);
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
        const exitCode = await svc.run('hello', { agent: 'antigravity' }, deps);
        expect(exitCode).toBe(0);
        expect(errors.some((e) => e.includes('Tier-2 agent'))).toBe(true);
    });

    test('Tier-2 warning suppressed in --json mode', async () => {
        const { errors, output } = captureOutput();
        const svc = makeService({}, output);
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
        const exitCode = await svc.run('hello', { agent: 'antigravity', json: true }, deps);
        expect(exitCode).toBe(0);
        expect(errors.some((e) => e.includes('Tier-2 agent'))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService.run — codex resume
// ---------------------------------------------------------------------------

describe('AgentService.run codex resume', () => {
    test('--continue + prompt: shim throws during diagnostics → exit 2', async () => {
        const { errors, output } = captureOutput();
        const svc = makeService({}, output);

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
        const exitCode = await svc.run('extra prompt', { agent: 'codex', continue: true }, deps);
        expect(exitCode).toBe(2);
        expect(errors.some((e) => e.includes('Codex resume mode'))).toBe(true);
    });

    test('--continue without prompt (valid codex resume) succeeds', async () => {
        const svc = makeService();
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
        const exitCode = await svc.run(undefined, { agent: 'codex', continue: true }, deps);
        expect(exitCode).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService.run — diagnostics
// ---------------------------------------------------------------------------

describe('AgentService.run diagnostics', () => {
    test('diagnostics emitted to stderr in text mode', async () => {
        const { errors, output } = captureOutput();
        const svc = makeService({}, output);
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
        const exitCode = await svc.run('hello', { agent: 'pi' }, deps);
        expect(exitCode).toBe(0);
        expect(errors.some((e) => e.includes('⚙️'))).toBe(true);
        expect(errors.some((e) => e.includes('pi v1.2.3'))).toBe(true);
    });

    test('diagnostics suppressed in --json mode', async () => {
        const { errors, output } = captureOutput();
        const svc = makeService({}, output);
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
        const exitCode = await svc.run('hello', { agent: 'pi', json: true }, deps);
        expect(exitCode).toBe(0);
        expect(errors.some((e) => e.includes('⚙️'))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService.run — --mode flag propagation
// ---------------------------------------------------------------------------

describe('AgentService.run --mode flag', () => {
    test('--mode json passes through to PromptOptions', async () => {
        const svc = makeService();
        const { deps, runner } = mockDeps();
        await svc.run('hello', { agent: 'pi', mode: 'json' }, deps);

        const callArgs = runner.runPromptCommand.mock.calls[0] as [string, { mode: string }, unknown];
        expect(callArgs[1].mode).toBe('json');
    });

    test('--mode text is default', async () => {
        const svc = makeService();
        const { deps, runner } = mockDeps();
        await svc.run('hello', { agent: 'pi' }, deps);

        const callArgs = runner.runPromptCommand.mock.calls[0] as [string, { mode: string }, unknown];
        expect(callArgs[1].mode).toBe('text');
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService.run — --cwd propagation
// ---------------------------------------------------------------------------

describe('AgentService.run --cwd flag', () => {
    test('--cwd propagates to AgentRunOptions', async () => {
        const svc = makeService();
        const { deps, runner } = mockDeps();
        await svc.run('hello', { agent: 'pi', cwd: '/tmp' }, deps);

        const callArgs = runner.runPromptCommand.mock.calls[0] as [string, unknown, { cwd: string }];
        expect(callArgs[2].cwd).toBe('/tmp');
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService.runCapture
// ---------------------------------------------------------------------------

describe('AgentService.runCapture', () => {
    test('returns exitCode 0 and answer text on success', async () => {
        const svc = makeService();
        const { deps } = mockDeps(makeRunResult({ stdout: 'the agent answer' }));
        const result = await svc.runCapture('hello', { agent: 'pi' }, deps);
        expect(result.exitCode).toBe(0);
        expect(result.answer).toBe('the agent answer');
    });

    test('returns exitCode 3 on non-zero agent exit', async () => {
        const svc = makeService();
        const { deps } = mockDeps(makeRunResult({ exitCode: 1, stdout: 'partial output' }));
        const result = await svc.runCapture('hello', { agent: 'pi' }, deps);
        expect(result.exitCode).toBe(3);
        expect(result.answer).toBe('partial output');
    });

    test('returns exitCode 3 on signal termination', async () => {
        const svc = makeService();
        const { deps } = mockDeps(makeRunResult({ exitCode: null, signal: 'SIGTERM', stdout: '' }));
        const result = await svc.runCapture('hello', { agent: 'pi' }, deps);
        expect(result.exitCode).toBe(3);
        expect(result.answer).toBe('');
    });

    test('returns exitCode 2 on validation error (missing prompt)', async () => {
        const svc = makeService();
        const result = await svc.runCapture(undefined, {});
        expect(result.exitCode).toBe(2);
        expect(result.answer).toBe('');
    });

    test('returns exitCode 2 on invalid mode', async () => {
        const svc = makeService();
        const result = await svc.runCapture('hello', { mode: 'xml' });
        expect(result.exitCode).toBe(2);
        expect(result.answer).toBe('');
    });

    test('suppresses all output — no diagnostics, no errors', async () => {
        const { lines, errors, output } = captureOutput();
        const svc = makeService({}, output);
        const { deps } = mockDeps(makeRunResult({ stdout: 'answer' }));
        await svc.runCapture('hello', { agent: 'pi' }, deps);
        expect(lines.length).toBe(0);
        expect(errors.length).toBe(0);
    });

    test('suppresses Tier-2 warning even without --json', async () => {
        const { errors, output } = captureOutput();
        const svc = makeService({}, output);
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
        await svc.runCapture('hello', { agent: 'antigravity' }, deps);
        expect(errors.some((e) => e.includes('Tier-2 agent'))).toBe(false);
    });

    test('uses buffered output policy (captured stdout returned)', async () => {
        const svc = makeService();
        const { deps, runner } = mockDeps(makeRunResult({ stdout: 'captured via buffered mode' }));
        const result = await svc.runCapture('hello', { agent: 'pi' }, deps);
        expect(result.answer).toBe('captured via buffered mode');
        // Verify runner was called (dispatch happened)
        expect(runner.runPromptCommand).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService.resolve
// ---------------------------------------------------------------------------

describe('AgentService.resolve', () => {
    test('explicit agent resolves ok', async () => {
        const svc = makeService();
        const { deps } = mockDeps();
        const result = await svc.resolve({ agent: 'pi' }, deps);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.agent).toBe('pi');
    });

    test('unknown agent resolves not ok', async () => {
        const svc = makeService();
        const result = await svc.resolve({ agent: 'not-an-agent' });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.exitCode).toBe(2);
    });
});
