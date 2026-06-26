import { describe, expect, mock, test } from 'bun:test';
import type { AgentName, AgentRunResult, AuthState } from '@gobing-ai/ts-ai-runner';
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

function mockDoctorResult(
    overrides: Partial<{
        agent: string;
        installed: boolean;
        authenticated: AuthState;
        usable: boolean;
        tier: 1 | 2;
    }> = {},
) {
    return {
        agent: overrides.agent ?? 'pi',
        installed: overrides.installed ?? true,
        version: '1.0.0',
        authenticated: overrides.authenticated ?? 'authenticated',
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
                        authenticated: 'unauthenticated' as AuthState,
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
                    authenticated: 'unauthenticated' as AuthState,
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

    test('text render surfaces authenticated as a yes/no/? column', async () => {
        // Auth is informational now — all three states must render regardless of
        // usable (a logged-out agent is usable but shows auth=no).
        const { lines, output } = captureOutput();
        const svc = makeService({}, output);
        const doctorRunner = {
            runAll: mock(() =>
                Promise.resolve([
                    mockDoctorResult({ agent: 'claude', authenticated: 'authenticated' }),
                    mockDoctorResult({ agent: 'omp', authenticated: 'unauthenticated' }),
                    mockDoctorResult({ agent: 'opencode', authenticated: 'unknown' }),
                ]),
            ),
            runOne: mock(() => Promise.resolve(mockDoctorResult())),
        } as unknown as AgentRunDeps['doctorRunner'];

        const exitCode = await svc.doctor({ json: false }, { doctorRunner });
        expect(exitCode).toBe(0);
        // Aligned table: auth renders as a yes/no/? column (no `auth=` prefix).
        expect(lines.some((l) => /\bclaude\b/.test(l) && /\byes\b/.test(l))).toBe(true);
        expect(lines.some((l) => /\bomp\b/.test(l) && /\bno\b/.test(l))).toBe(true);
        expect(lines.some((l) => /\bopencode\b/.test(l) && /\?/.test(l))).toBe(true);
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
                        authenticated: 'unauthenticated',
                        usable: false,
                        tier: 1 as const,
                        channels: [],
                        error: 'not found',
                    },
                    {
                        agent: 'pi',
                        installed: true,
                        version: '1.0.0',
                        authenticated: 'authenticated',
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
                        authenticated: 'unauthenticated',
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
                    authenticated: 'unauthenticated' as AuthState,
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

    test('--agent explicit installed-but-not-runnable (version null) → exit 1, fail fast (P0-a)', async () => {
        // The dogfood defect: a pinned agent the doctor flags unusable (installed
        // but no version) was dispatched anyway and burned the full stage timeout.
        // The liveness gate must reject it BEFORE any stage runs.
        const svc = makeService();
        const doctorRunner = {
            runOne: mock(() =>
                Promise.resolve({
                    agent: 'omp',
                    installed: true,
                    version: null, // broken install → not runnable
                    authenticated: 'unauthenticated' as AuthState,
                    usable: false,
                    tier: 1 as const,
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['doctorRunner'];

        const deps: AgentRunDeps = { doctorRunner };
        const exitCode = await svc.run('hello', { agent: 'omp' }, deps);
        expect(exitCode).toBe(1);
    });

    test('--agent explicit runnable-but-unauthenticated is NOT blocked (P0-a, auth off path)', async () => {
        // Liveness-only gate: auth never feeds runnability. A logged-out agent
        // is usable and must resolve ok — it fails at runtime with its own error.
        const { errors, output } = captureOutput();
        const runResult = makeRunResult();
        const runner = {
            runPromptCommand: mock(() => Promise.resolve(runResult)),
        } as unknown as AgentRunDeps['runner'];
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({ name: 'omp', installed: true, version: '1.0.0', channels: [], error: null }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() =>
                Promise.resolve({
                    agent: 'omp',
                    installed: true,
                    version: 'omp/16.1.20',
                    authenticated: 'unauthenticated' as AuthState, // logged out
                    usable: true, // but runnable
                    tier: 1 as const,
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['doctorRunner'];

        const svc = makeService({}, output);
        const deps: AgentRunDeps = { runner, detector, doctorRunner };
        const exitCode = await svc.run('hello', { agent: 'omp' }, deps);
        expect(exitCode).toBe(0);
        expect(errors.some((e) => /omp/.test(e) && /not runnable/.test(e))).toBe(false);
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
                    name: 'openclaw',
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
                    agent: 'openclaw',
                    installed: true,
                    version: '2.0.0',
                    authenticated: 'authenticated',
                    usable: true,
                    tier: 2 as const,
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['doctorRunner'];

        const deps: AgentRunDeps = { runner, detector, doctorRunner };
        const exitCode = await svc.run('hello', { agent: 'openclaw' }, deps);
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
                    name: 'openclaw',
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
                    agent: 'openclaw',
                    installed: true,
                    version: '2.0.0',
                    authenticated: 'authenticated',
                    usable: true,
                    tier: 2 as const,
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['doctorRunner'];

        const deps: AgentRunDeps = { runner, detector, doctorRunner };
        const exitCode = await svc.run('hello', { agent: 'openclaw', json: true }, deps);
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
                    authenticated: 'authenticated',
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
                    authenticated: 'authenticated',
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
// Tests: AgentService.run — --timeout flag propagation
// ---------------------------------------------------------------------------

describe('AgentService.run --timeout flag', () => {
    test('--timeout propagates to AgentRunOptions', async () => {
        const svc = makeService();
        const { deps, runner } = mockDeps();
        await svc.run('hello', { agent: 'pi', timeout: '30000' }, deps);

        const callArgs = runner.runPromptCommand.mock.calls[0] as [string, unknown, { cwd?: string; timeout?: number }];
        expect(callArgs[2].timeout).toBe(30000);
    });

    test('timeout absent when flag not set', async () => {
        const svc = makeService();
        const { deps, runner } = mockDeps();
        await svc.run('hello', { agent: 'pi' }, deps);

        const callArgs = runner.runPromptCommand.mock.calls[0] as [string, unknown, { cwd?: string; timeout?: number }];
        expect(callArgs[2].timeout).toBeUndefined();
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
                    authenticated: 'authenticated',
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

// ---------------------------------------------------------------------------
// Tests: AgentService — phase-aware auto resolution with executor profiles (0126)
// ---------------------------------------------------------------------------
// These exercise the `run`/`executeRun` path (the only path that threads the
// prompt → phase). The resolved agent + model are observed via the agent name
// passed to runPromptCommand and the model in PromptOptions.

import type { AgentConfig } from '../../src/index';

/** Build a service with an `agent` config block threaded in. */
function makeConfiguredService(agentConfig: AgentConfig, env: Record<string, string | undefined> = {}) {
    return new AgentService({ cwd: process.cwd(), env, output: nullOutput(), agentConfig });
}

/**
 * Deps whose doctor reports per-agent usability from a map (default: usable).
 * Captures the agent + PromptOptions passed to runPromptCommand for assertions.
 */
function mockResolutionDeps(usableByAgent: Record<string, boolean> = {}) {
    const runner = { runPromptCommand: mock(() => Promise.resolve(makeRunResult())) };
    const detector = {
        detectOne: mock(() =>
            Promise.resolve({ name: 'omp', installed: true, version: '1.0.0', channels: [], error: null }),
        ),
    };
    const usable = (agent: string) => usableByAgent[agent] ?? true;
    const doctor = {
        runOne: mock((agent: string) =>
            Promise.resolve(mockDoctorResult({ agent, installed: usable(agent), usable: usable(agent) })),
        ),
        runAll: mock(() =>
            Promise.resolve(TIER1_PRIORITY.map((name: string) => mockDoctorResult({ agent: name, usable: true }))),
        ),
    };
    return {
        deps: {
            runner: runner as unknown as AgentRunDeps['runner'],
            detector: detector as unknown as AgentRunDeps['detector'],
            doctorRunner: doctor as unknown as AgentRunDeps['doctorRunner'],
        },
        runner,
    };
}

/** The agent name passed to the (single) runPromptCommand call. */
function resolvedAgent(runner: { runPromptCommand: ReturnType<typeof mock> }): string {
    return runner.runPromptCommand.mock.calls[0]?.[0] as string;
}

/** The model from the PromptOptions passed to runPromptCommand. */
function resolvedModel(runner: { runPromptCommand: ReturnType<typeof mock> }): string | undefined {
    return (runner.runPromptCommand.mock.calls[0]?.[1] as { model?: string } | undefined)?.model;
}

describe('AgentService phase-aware auto resolution', () => {
    // First Tier-1 agent in priority order — the legacy-fallback expectation.
    const firstPriority = TIER1_PRIORITY[0] as string;
    const fullConfig: AgentConfig = {
        default: 'omp',
        executors: [
            { name: 'omp', agent: 'omp' },
            { name: 'omp-zai', agent: 'omp', model: 'zai//glm-5.2' },
            { name: 'claude', agent: 'claude' },
        ],
        'default-by-phase': { 'dev-run': 'omp-zai', 'dev-review': 'claude' },
    };

    test('R1: phase mapping selects the configured executor with its model override', async () => {
        const svc = makeConfiguredService(fullConfig);
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('/sp:dev-run 0126 --auto', { agent: 'auto', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('omp');
        expect(resolvedModel(runner)).toBe('zai//glm-5.2');
    });

    test('R2: no phase match falls back to the default executor', async () => {
        const svc = makeConfiguredService(fullConfig);
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'auto', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('omp');
        expect(resolvedModel(runner)).toBeUndefined();
    });

    test('R3: legacy config (no executors / phase map) keeps Tier-1 priority behavior', async () => {
        const svc = makeConfiguredService({});
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'auto', json: true }, deps);
        expect(code).toBe(0);
        // First usable Tier-1 in priority order.
        expect(resolvedAgent(runner)).toBe(firstPriority);
    });

    test('absent agentConfig entirely → Tier-1 priority behavior', async () => {
        const svc = makeService();
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('/sp:dev-run 0126', { agent: 'auto', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe(firstPriority);
    });

    test('backward-compat: a pre-0126 `{ default: <agent> }` config resolves the named agent', async () => {
        // The exact shape every shipped config has today: a default, no executors,
        // no phase map. `default` resolves as a legacy direct agent name (R5/R8) —
        // no model override, no phase routing, no crash.
        const svc = makeConfiguredService({ default: 'pi' });
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('/sp:dev-run 0126', { agent: 'auto', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('pi');
        expect(resolvedModel(runner)).toBeUndefined();
    });

    test('R4: phase mapping naming an unknown executor exits 2 before spawning', async () => {
        const svc = makeConfiguredService({
            executors: [{ name: 'omp', agent: 'omp' }],
            'default-by-phase': { 'dev-review': 'nonexistent' },
        });
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('/sp:dev-review 0126', { agent: 'auto', json: true }, deps);
        expect(code).toBe(2);
        expect(runner.runPromptCommand).not.toHaveBeenCalled();
    });

    test('R7: phase mapping to a known-but-unusable executor exits 1 with no fallback', async () => {
        const svc = makeConfiguredService({
            default: 'omp',
            executors: [
                { name: 'omp', agent: 'omp' },
                { name: 'claude', agent: 'claude' },
            ],
            'default-by-phase': { 'dev-plan': 'claude' },
        });
        // claude unusable; omp usable — but R7 must NOT fall back to the omp default.
        const { deps, runner } = mockResolutionDeps({ claude: false, omp: true });
        const code = await svc.run('/sp:dev-plan 0126', { agent: 'auto', json: true }, deps);
        expect(code).toBe(1);
        expect(runner.runPromptCommand).not.toHaveBeenCalled();
    });

    test('R6: explicit --model overrides the executor model override', async () => {
        const svc = makeConfiguredService(fullConfig);
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('/sp:dev-run 0126', { agent: 'auto', model: 'my-model', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('omp');
        expect(resolvedModel(runner)).toBe('my-model');
    });

    test('slash-command phase normalization across every per-agent surface form', async () => {
        // `spur agent run` may receive a prompt already translated for the target
        // agent (translateSlashCommand runs after resolution), so extractPhase must
        // recognize all of: claude (/sp:, /rd3:), opencode/gemini (/sp-, /rd3-),
        // pi/omp (/skill:sp-, /skill:rd3-), codex ($sp-, $rd3-).
        const prompts = [
            '/sp:dev-run 0126', // claude
            '/sp-dev-run 0126', // opencode / gemini
            '/skill:sp-dev-run 0126', // pi / omp
            '$sp-dev-run 0126', // codex
            '/rd3:dev-run 0126', // rd3 claude
            '/rd3-dev-run 0126', // rd3 opencode / gemini
            '/skill:rd3-dev-run 0126', // rd3 pi / omp
            '$rd3-dev-run 0126', // rd3 codex
        ];
        for (const prompt of prompts) {
            const svc = makeConfiguredService(fullConfig);
            const { deps, runner } = mockResolutionDeps();
            const code = await svc.run(prompt, { agent: 'auto', json: true }, deps);
            expect(code, `prompt=${prompt}`).toBe(0);
            // Every form normalizes to phase dev-run → executor omp-zai.
            expect(resolvedModel(runner), `prompt=${prompt}`).toBe('zai//glm-5.2');
        }
    });

    test('a translated non-sp/rd3 skill prompt yields no phase (falls back to default)', async () => {
        const svc = makeConfiguredService(fullConfig);
        const { deps, runner } = mockResolutionDeps();
        // `/skill:other-thing` is not an sp/rd3 command → no phase → default executor.
        const code = await svc.run('/skill:other-thing 0126', { agent: 'auto', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('omp');
        expect(resolvedModel(runner)).toBeUndefined();
    });

    test('R8: explicit --agent name does not consult phase config', async () => {
        const svc = makeConfiguredService(fullConfig);
        const { deps, runner } = mockResolutionDeps();
        // dev-run maps to omp-zai, but an explicit agent must win with no model override.
        const code = await svc.run('/sp:dev-run 0126', { agent: 'claude', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('claude');
        expect(resolvedModel(runner)).toBeUndefined();
    });

    test('R12: prompt-less resolve() derives no phase and uses default → priority', async () => {
        const svc = makeConfiguredService(fullConfig);
        const { deps } = mockResolutionDeps();
        const result = await svc.resolve({ agent: 'auto' }, deps);
        expect(result.ok).toBe(true);
        if (result.ok) {
            // No prompt → no phase → default executor 'omp' (not the dev-run model override).
            expect(result.agent).toBe('omp');
            expect(result.model).toBeUndefined();
            expect(result.source).toBe('default');
        }
    });

    test('default falls through to priority when the default executor is unusable', async () => {
        const svc = makeConfiguredService({
            default: 'claude',
            executors: [{ name: 'claude', agent: 'claude' }],
        });
        // claude unusable → default path miss → Tier-1 priority resolves.
        const { deps, runner } = mockResolutionDeps({ claude: false });
        const code = await svc.run('plain prompt', { agent: 'auto', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe(firstPriority);
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService — timeout-kill routing (P0-b)
// ---------------------------------------------------------------------------
// The dogfood report claimed a timed-out agent.run reported ok:true and the
// pipeline advanced. The executor (ts-runtime) yields exitCode:null + a signal
// on a timeout-kill; this block locks the downstream contract that such a
// result routes to a NON-ZERO exit (never 0), so the action's `ok = exitCode
// === 0` mapping yields ok:false and the pipeline routes to `failed`.

describe('AgentService timeout-kill routing', () => {
    function mockDepsWithResult(result: AgentRunResult): AgentRunDeps {
        const runner = { runPromptCommand: mock(() => Promise.resolve(result)) } as unknown as AgentRunDeps['runner'];
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({ name: 'pi', installed: true, version: '1.0.0', channels: [], error: null }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() => Promise.resolve(mockDoctorResult({ installed: true, usable: true }))),
        } as unknown as AgentRunDeps['doctorRunner'];
        return { runner, detector, doctorRunner };
    }

    test('run: timed-out result (exitCode null + signal) → non-zero exit, never 0', async () => {
        const svc = makeService();
        // Exactly the shape ts-runtime returns when a subprocess is killed on
        // timeout (process-executor.ts: exitCode ?? null, signal set).
        const timedOut = makeRunResult({ exitCode: null, signal: 'SIGTERM', durationMs: 600_000 });
        const exitCode = await svc.run('hello', { agent: 'pi', json: true }, mockDepsWithResult(timedOut));
        expect(exitCode).not.toBe(0);
        expect(exitCode).toBe(3);
    });

    test('runCapture: timed-out result → non-zero exitCode, never 0', async () => {
        const svc = makeService();
        const timedOut = makeRunResult({ exitCode: null, signal: 'SIGTERM' });
        const { exitCode } = await svc.runCapture('hello', { agent: 'pi', mode: 'text' }, mockDepsWithResult(timedOut));
        expect(exitCode).not.toBe(0);
        expect(exitCode).toBe(3);
    });
});
