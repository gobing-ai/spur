import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCliMigrations, RunSessionDao } from '@gobing-ai/spur-domain';
import type { AgentName, AgentRunResult, AuthState } from '@gobing-ai/ts-ai-runner';
import { TIER1_PRIORITY } from '@gobing-ai/ts-ai-runner';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { EventBus } from '@gobing-ai/ts-infra';
import {
    _resetAgentServiceShimsForTest,
    AGENT_INLINE_HEADLESS_MESSAGE,
    type AgentConfig,
    type AgentExecutionEvent,
    type AgentExecutionStartedEvent,
    type AgentRoleDefinition,
    type AgentRunDeps,
    AgentService,
    type AgentServiceOutput,
    RunSessionObserver,
} from '../../src/index';
import { RolePropagatingProcessExecutor } from '../../src/services/agent-service';

// Warn-once shim markers are process-global; bun batches test files per worker
// process, so never inherit another file's marker state.
beforeEach(() => {
    _resetAgentServiceShimsForTest();
});

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
        modelStatus: { status: string; detail?: string; checkedAt: string };
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
        ...(overrides.modelStatus !== undefined ? { modelStatus: overrides.modelStatus } : {}),
    };
}

interface MockRunner {
    runPromptCommand: ReturnType<typeof mock>;
}

interface MockDetector {
    detectAll: ReturnType<typeof mock>;
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
        detectAll: mock(() =>
            Promise.resolve([
                {
                    name: 'pi',
                    installed: true,
                    version: '1.0.0',
                    channels: [],
                    error: null,
                },
            ]),
        ),
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

function makeService(env: Record<string, string | undefined> = {}, output = nullOutput(), agentConfig?: AgentConfig) {
    return new AgentService({ cwd: process.cwd(), env, output, agentConfig });
}

// ---------------------------------------------------------------------------
// Tests: AgentService.list
// ---------------------------------------------------------------------------

describe('AgentService.list', () => {
    test('returns exit 0', async () => {
        const svc = makeService();
        const { deps } = mockDeps();
        const exitCode = await svc.list({ json: false }, deps);
        expect(typeof exitCode).toBe('number');
        expect(exitCode).toBe(0);
    });

    test('--json outputs JSON envelope', async () => {
        const { lines, output } = captureOutput();
        const svc = makeService({}, output);
        const { deps } = mockDeps();
        const exitCode = await svc.list({ json: true }, deps);
        expect(exitCode).toBe(0);
        const jsonLine = lines.find((l) => l.includes('"agents"'));
        expect(jsonLine).toBeDefined();
        const parsed = JSON.parse(jsonLine ?? '');
        expect(Array.isArray(parsed.agents)).toBe(true);
    });

    test('plain output has ok/missing prefix lines', async () => {
        const { lines, output } = captureOutput();
        const svc = makeService({}, output);
        const { deps } = mockDeps();
        await svc.list({ json: false }, deps);
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

    test('R3 (0487): --json carries the executor capability tier, distinct from the support tier', async () => {
        const { lines, output } = captureOutput();
        const svc = makeService({}, output, {
            executors: [
                { name: 'omp-dsv4-flash-volc', agent: 'omp' },
                { name: 'pinned-capable', agent: 'omp', tier: 'capable-2' },
            ],
        } as AgentConfig);
        const doctorRunner = {
            runAll: mock(() =>
                Promise.resolve([
                    mockDoctorResult({ agent: 'omp-dsv4-flash-volc', tier: 1 }),
                    mockDoctorResult({ agent: 'pinned-capable', tier: 1 }),
                    mockDoctorResult({ agent: 'unconfigured', tier: 2 }),
                ]),
            ),
            runOne: mock(() => Promise.resolve(mockDoctorResult())),
        } as unknown as AgentRunDeps['doctorRunner'];

        await svc.doctor({ json: true }, { doctorRunner });

        const parsed = JSON.parse(lines.find((l) => l.includes('"agents"')) ?? '');
        // Inferred from the executor name (`flash`), not read off the support tier.
        expect(parsed.agents[0].capabilityTier).toBe('cheap');
        expect(parsed.agents[0].tier).toBe(1);
        expect(parsed.agents[1].capabilityTier).toBe('capable-2');
        // No matching executor entry → inferred from the bare agent name.
        expect(parsed.agents[2].capabilityTier).toBe('standard');
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

    // --- Task 0239: model health probe integration (cases 11–16) ---

    test('text table renders MODEL column header', async () => {
        const { lines, output } = captureOutput();
        const svc = makeService({}, output);
        const doctorRunner = {
            runAll: mock(() => Promise.resolve([mockDoctorResult({ agent: 'omp-zai' })])),
            runOne: mock(() => Promise.resolve(mockDoctorResult())),
        } as unknown as AgentRunDeps['doctorRunner'];
        await svc.doctor({ json: false }, { doctorRunner });
        expect(lines.some((l) => l.includes('MODEL'))).toBe(true);
    });

    test('text table renders — in MODEL column for executor with no model override (AC2)', async () => {
        const { lines, output } = captureOutput();
        const svc = makeService({}, output);
        const doctorRunner = {
            runAll: mock(() =>
                Promise.resolve([
                    mockDoctorResult({ agent: 'omp' }),
                    mockDoctorResult({
                        agent: 'omp-zai',
                        modelStatus: { status: 'available', checkedAt: '2026-07-09T00:00:00Z' },
                    }),
                ]),
            ),
            runOne: mock(() => Promise.resolve(mockDoctorResult())),
        } as unknown as AgentRunDeps['doctorRunner'];
        await svc.doctor({ json: false }, { doctorRunner });
        const text = lines.join('\n');
        // The "omp" row (without -zai suffix) must show — for its MODEL column.
        const ompRow = text.split('\n').find((l) => /\bomp\b/.test(l) && !l.includes('omp-zai'));
        expect(ompRow).toBeDefined();
        expect(ompRow).toContain('—');
    });

    test('text table renders full model status for available model (R4/AC1)', async () => {
        const { lines, output } = captureOutput();
        const svc = makeService({}, output);
        const doctorRunner = {
            runAll: mock(() =>
                Promise.resolve([
                    mockDoctorResult({
                        agent: 'omp-zai',
                        modelStatus: { status: 'available', checkedAt: '2026-07-09T00:00:00Z' },
                    }),
                ]),
            ),
            runOne: mock(() => Promise.resolve(mockDoctorResult())),
        } as unknown as AgentRunDeps['doctorRunner'];
        await svc.doctor({ json: false }, { doctorRunner });
        expect(lines.some((l) => l.includes('available'))).toBe(true);
    });

    test('text table renders full quota_exhausted status (R4/AC1)', async () => {
        const { lines, output } = captureOutput();
        const svc = makeService({}, output);
        const doctorRunner = {
            runAll: mock(() =>
                Promise.resolve([
                    mockDoctorResult({
                        agent: 'omp-zai',
                        modelStatus: {
                            status: 'quota_exhausted',
                            detail: 'insufficient_quota',
                            checkedAt: '2026-07-09T00:00:00Z',
                        },
                    }),
                ]),
            ),
            runOne: mock(() => Promise.resolve(mockDoctorResult())),
        } as unknown as AgentRunDeps['doctorRunner'];
        await svc.doctor({ json: false }, { doctorRunner });
        expect(lines.some((l) => l.includes('quota_exhausted'))).toBe(true);
    });

    test('--json includes modelStatus in the output envelope', async () => {
        const { lines, output } = captureOutput();
        const svc = makeService({}, output);
        const doctorRunner = {
            runAll: mock(() =>
                Promise.resolve([
                    mockDoctorResult({
                        agent: 'omp-zai',
                        modelStatus: {
                            status: 'rate_limited',
                            detail: 'rate_limit_exceeded',
                            checkedAt: '2026-07-09T00:00:00Z',
                        },
                    }),
                ]),
            ),
            runOne: mock(() => Promise.resolve(mockDoctorResult())),
        } as unknown as AgentRunDeps['doctorRunner'];
        await svc.doctor({ json: true }, { doctorRunner });
        const jsonLine = lines.find((l) => l.includes('"agents"'));
        expect(jsonLine).toBeDefined();
        const parsed = JSON.parse(jsonLine ?? '');
        expect(parsed.agents[0].modelStatus).toBeDefined();
        expect(parsed.agents[0].modelStatus.status).toBe('rate_limited');
    });

    test('single executor detail mode shows full model status', async () => {
        const { lines, output } = captureOutput();
        const svc = makeService({}, output);
        const doctorRunner = {
            runAll: mock(() => Promise.resolve([mockDoctorResult()])),
            runOne: mock(() =>
                Promise.resolve(
                    mockDoctorResult({
                        agent: 'omp-zai',
                        modelStatus: {
                            status: 'available',
                            checkedAt: '2026-07-09T12:00:00Z',
                        },
                    }),
                ),
            ),
        } as unknown as AgentRunDeps['doctorRunner'];
        await svc.doctor({ json: false, agent: 'omp-zai' }, { doctorRunner });
        const text = lines.join('\n');
        expect(text).toContain('omp-zai');
        expect(text).toContain('model:');
        expect(text).toContain('available');
        expect(text).toContain('checked:');
    });

    test('doctor passes executors from agentConfig to DoctorRunner', async () => {
        // R1: when agentConfig.executors is present, doctor must thread them
        // to DoctorRunner so runAll() probes each executor's model health.
        const svc = makeService({}, nullOutput(), {
            executors: [
                { name: 'omp-zai', agent: 'omp', model: 'zai/glm-5.2' },
                { name: 'omp-deepseek', agent: 'omp', model: 'deepseek/deepseek-v4-pro' },
            ],
        });
        // The deps.doctorRunner mock bypasses real construction, but the
        // doctor() method still reads this.ctx.agentConfig?.executors —
        // verify it doesn't throw and produces exit 0 for usable agents.
        const doctorRunner = {
            runAll: mock(() => Promise.resolve([mockDoctorResult({ agent: 'omp-zai' })])),
            runOne: mock(() => Promise.resolve(mockDoctorResult())),
        } as unknown as AgentRunDeps['doctorRunner'];
        const exitCode = await svc.doctor({ json: false }, { doctorRunner });
        expect(exitCode).toBe(0);
    });

    test('warns on quota_exhausted model status (AC5)', async () => {
        // AC5: when an executor's modelStatus is quota_exhausted, the doctor
        // command emits a warning to stderr naming the executor and model.
        const { errors, output } = captureOutput();
        const svc = makeService({}, output, {
            executors: [{ name: 'omp-zai-volc', agent: 'omp', model: 'volc/glm-5.2' }],
        });
        const doctorRunner = {
            runAll: mock(() =>
                Promise.resolve([
                    mockDoctorResult({
                        agent: 'omp-zai-volc',
                        modelStatus: {
                            status: 'quota_exhausted',
                            detail: 'insufficient_quota',
                            checkedAt: '2026-07-09T00:00:00Z',
                        },
                    }),
                ]),
            ),
            runOne: mock(() => Promise.resolve(mockDoctorResult())),
        } as unknown as AgentRunDeps['doctorRunner'];
        await svc.doctor({ json: false }, { doctorRunner });
        const warningText = errors.join('\n');
        expect(warningText).toContain('omp-zai-volc');
        expect(warningText).toContain('volc/glm-5.2');
        expect(warningText).toContain('quota_exhausted');
        expect(warningText).toContain('--agent');
    });

    test('does not warn when model status is available (AC5)', async () => {
        // AC5: no warning when the executor's model is available.
        const { errors, output } = captureOutput();
        const svc = makeService({}, output, {
            executors: [{ name: 'omp-zai', agent: 'omp', model: 'zai/glm-5.2' }],
        });
        const doctorRunner = {
            runAll: mock(() =>
                Promise.resolve([
                    mockDoctorResult({
                        agent: 'omp-zai',
                        modelStatus: { status: 'available', checkedAt: '2026-07-09T00:00:00Z' },
                    }),
                ]),
            ),
            runOne: mock(() => Promise.resolve(mockDoctorResult())),
        } as unknown as AgentRunDeps['doctorRunner'];
        await svc.doctor({ json: false }, { doctorRunner });
        const warningText = errors.join('\n');
        expect(warningText).not.toContain('quota_exhausted');
        expect(warningText).not.toContain('unavailable');
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

    test('dead tokens (current, inherit) → treated as unknown agent (exit 2)', async () => {
        // `current` (and the phantom `inherit`) were removed: the env-var-backed
        // path never had a producer (nothing sets SPUR_AGENT), so the token is now
        // resolved as a plain explicit name, which is unknown → exit 2.
        const svc = makeService({ SPUR_AGENT: 'pi' });
        const currentExit = await svc.run('hello', { agent: 'current' });
        expect(currentExit).toBe(2);
        // `inherit` was never a real token — it fell through to explicit and exited 2.
        const inheritExit = await svc.run('hello', { agent: 'inherit' });
        expect(inheritExit).toBe(2);
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

    test('non-numeric --timeout returns exit 2 and does not invoke runner (R4)', async () => {
        // WHY: pre-fix code forwarded Number('abc') === NaN to the runner; the
        // validation path must reject with exit 2 before any spawn.
        const { output, errors } = captureOutput();
        const svc = makeService({}, output);
        const { deps, runner } = mockDeps();

        const code = await svc.run('hello', { agent: 'pi', timeout: 'not-a-number' }, deps);

        expect(code).toBe(2);
        expect(errors.some((e) => e.includes('Invalid --timeout=not-a-number'))).toBe(true);
        expect(runner.runPromptCommand.mock.calls.length).toBe(0);
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
        // Pin `pi` as a configured executor so no bare-binary transition warning is
        // warranted — silence must come from runCapture, not from a warm warn-once marker.
        const svc = makeService({}, output, {
            executors: [{ name: 'pi', agent: 'pi', tier: 'standard' }],
        } as AgentConfig);
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

    // R2b (G2): durationMs/signal/stderr must be forwarded, not discarded — the
    // agent.run action's timeout/failure handoff artifact depends on them.
    test('forwards durationMs on success', async () => {
        const svc = makeService();
        const { deps } = mockDeps(makeRunResult({ stdout: 'ok', durationMs: 12345 }));
        const result = await svc.runCapture('hello', { agent: 'pi' }, deps);
        expect(result.durationMs).toBe(12345);
    });

    test('forwards signal and stderr on a killed (timeout) run', async () => {
        const svc = makeService();
        const { deps } = mockDeps(
            makeRunResult({
                exitCode: null,
                signal: 'SIGKILL',
                stdout: 'partial',
                stderr: 'oops',
                durationMs: 1_800_000,
            }),
        );
        const result = await svc.runCapture('hello', { agent: 'pi' }, deps);
        expect(result.exitCode).toBe(3);
        expect(result.signal).toBe('SIGKILL');
        expect(result.stderr).toBe('oops');
        expect(result.durationMs).toBe(1_800_000);
    });

    test('signal is undefined (not present) on a normal non-zero exit', async () => {
        const svc = makeService();
        const { deps } = mockDeps(makeRunResult({ exitCode: 1, stdout: 'partial' }));
        const result = await svc.runCapture('hello', { agent: 'pi' }, deps);
        expect(result.signal).toBeUndefined();
    });

    test('validation failure (missing prompt) returns no duration/signal/stderr', async () => {
        const svc = makeService();
        const result = await svc.runCapture(undefined, {});
        expect(result.durationMs).toBeUndefined();
        expect(result.signal).toBeUndefined();
        expect(result.stderr).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService.runTraced — task 0295
// ---------------------------------------------------------------------------

describe('AgentService.runTraced', () => {
    test('direct and workflow dispatch use the same correlated lifecycle without double-counting', async () => {
        const eventBus = new EventBus<Record<string, (event: unknown) => void>>();
        const directEvents: AgentExecutionEvent[] = [];
        eventBus.on('agent.execution', (event) => directEvents.push(event as AgentExecutionEvent));
        const service = new AgentService({
            cwd: process.cwd(),
            env: { API_TOKEN: 'configured-secret' },
            output: nullOutput(),
            events: eventBus,
        });
        const { deps, runner } = mockDeps();
        runner.runPromptCommand.mockImplementation(
            (_agent: unknown, _prompt: unknown, options: { onOutput?: (output: unknown) => void }) => {
                options.onOutput?.({
                    stream: 'stdout',
                    chunk: 'live configured-secret',
                    timestamp: new Date().toISOString(),
                });
                return Promise.resolve(makeRunResult({ stdout: 'live configured-secret final' }));
            },
        );

        await service.run('direct prompt', { agent: 'pi', 'run-id': 'direct-run' }, deps);
        expect(directEvents.map((event) => event.kind)).toEqual(['started', 'output', 'finished']);
        expect(directEvents.every((event) => event.runId === 'direct-run')).toBe(true);
        expect(JSON.stringify(directEvents)).not.toContain('configured-secret');

        const workflowEvents: AgentExecutionEvent[] = [];
        await service.runTraced('workflow prompt', { agent: 'pi' }, deps, {
            correlation: { runId: 'workflow-run', actionId: 'action-1', executionId: 'execution-1' },
            observer: (event) => workflowEvents.push(event),
            heartbeatMs: 0,
        });
        expect(workflowEvents.map((event) => event.kind)).toEqual(['started', 'output', 'finished']);
        expect(workflowEvents.every((event) => event.actionId === 'action-1')).toBe(true);
    });

    test('redacts prompt-bearing argv and translated source before trace persistence (R1)', async () => {
        const svc = makeService();
        const deps = makeSimpleDeps('pi');
        const secret = 'api_key=do-not-persist-this';
        const result = await svc.runTraced(`/sp:dev-run 0295 --auto --description ${secret}`, { agent: 'pi' }, deps);

        expect(result.exitCode).toBe(0);
        expect(result.invocation).toBeDefined();
        const serialized = JSON.stringify(result.invocation);
        expect(serialized).not.toContain('do-not-persist-this');
        expect(result.invocation?.argv).toContain('/skill:sp-dev-run 0295 --auto [redacted] [redacted]');
        expect(result.invocation?.translatedFrom).toBe('/sp:dev-run 0295 --auto [redacted] [redacted]');
        expect(result.invocation?.outputMode).toBe('pipe');
        expect(result.invocation?.stdinInteractive).toBe(false);
    });

    test('fully redacts an ordinary prose prompt from traced argv (R1)', async () => {
        const svc = makeService();
        const deps = makeSimpleDeps('pi');
        const prompt = 'Investigate customer password swordfish in the failing request';
        const result = await svc.runTraced(prompt, { agent: 'pi' }, deps);

        const serialized = JSON.stringify(result.invocation);
        expect(serialized).not.toContain('swordfish');
        expect(result.invocation?.argv).toContain(`[redacted prompt: ${prompt.length} chars]`);
    });

    // R2/R3 (task 0295): runTraced must (R2) translate Claude-style slash
    // commands to the agent's dialect, force buffered/non-interactive stdin so
    // the subprocess can never stall on a TTY, and (R3) map a killed/timed-out
    // continuation to exit 3 without stalling. Exercised via a mock runner that
    // mirrors the real omp shim argv contract — no `omp` subprocess is spawned,
    // so the test is deterministic on GHA Linux (no PATH/fixture/TTY drift).
    test('bounded OMP fixture distinguishes translation, non-TTY stdin, and stale continuation (R2/R3)', async () => {
        // Mock runner mirrors ompShim.getPromptCommand (ts-ai-runner): fresh run
        // emits `--no-session -p <input> --mode text`; continue drops
        // `--no-session` and appends `-c`. It returns the observed prompt +
        // flags as JSON stdout so the assertions inspect what the agent would
        // have seen, exactly as the /bin/sh fixture did — minus the subprocess.
        const buildPromptCommand = mock((_agent: string, options: { input?: string; continue?: boolean }) => {
            const args: string[] = [];
            if (options.continue !== true) args.push('--no-session');
            args.push('-p', options.input ?? '');
            if (options.continue === true) args.push('-c');
            args.push('--mode', 'text');
            return { command: 'omp', args };
        });
        const runPromptCommand = mock(async (_agent: string, options: { input?: string; continue?: boolean }) => {
            const payload = JSON.stringify({
                prompt: options.input ?? '',
                stdinInteractive: false,
                continue: options.continue === true,
                noSession: options.continue !== true,
            });
            // Stale-continuation path: simulate a timeout-kill. runTraced maps
            // any non-zero/null exit (including signal-killed) to 3.
            if (options.continue === true) {
                return {
                    exitCode: null,
                    signal: 'SIGTERM',
                    stdout: payload,
                    stderr: '',
                    durationMs: 500,
                } satisfies AgentRunResult;
            }
            return {
                exitCode: 0,
                stdout: payload,
                stderr: '',
                durationMs: 10,
            } satisfies AgentRunResult;
        });
        const deps: AgentRunDeps = {
            runner: { buildPromptCommand, runPromptCommand } as unknown as AgentRunDeps['runner'],
            detector: {
                detectOne: mock(() =>
                    Promise.resolve({ name: 'omp', installed: true, version: 'fixture', channels: [], error: null }),
                ),
            } as unknown as AgentRunDeps['detector'],
            doctorRunner: {
                runOne: mock(() => Promise.resolve(mockDoctorResult({ agent: 'omp', installed: true, usable: true }))),
            } as unknown as AgentRunDeps['doctorRunner'],
        };

        const svc = makeService();
        const prompt = '/sp:dev-run 0295 --mode implement --auto';

        // R2: fresh dispatch translates the slash command and runs non-interactively.
        const fresh = await svc.runTraced(prompt, { agent: 'omp', timeout: '15000' }, deps);
        expect(fresh.exitCode).toBe(0);
        const freshObservation = JSON.parse(fresh.stdout) as {
            prompt: string;
            stdinInteractive: boolean;
            continue: boolean;
            noSession: boolean;
        };
        expect(freshObservation).toEqual({
            prompt: '/skill:sp-dev-run 0295 --mode implement --auto',
            stdinInteractive: false,
            continue: false,
            noSession: true,
        });
        expect(fresh.invocation).toMatchObject({
            continue: false,
            // H83 R5 / 0448: nonInteractive uses pipe-no-TTY (live onOutput), not stream.
            outputMode: 'pipe',
            stdinInteractive: false,
        });

        // R3: a killed continuation maps to exit 3 promptly, with the argv
        // shape proving `--no-session` was dropped for resume mode.
        const startedAt = Date.now();
        const stale = await svc.runTraced(prompt, { agent: 'omp', continue: true, timeout: '500' }, deps);
        const elapsedMs = Date.now() - startedAt;
        expect(stale.exitCode).toBe(3);
        expect(elapsedMs).toBeLessThan(2000);
        expect(JSON.parse(stale.stdout)).toMatchObject({ continue: true });
        expect(stale.invocation?.continue).toBe(true);
        expect(stale.invocation?.argv).toContain('-c');
        expect(stale.invocation?.argv).not.toContain('--no-session');
    });

    // R7 (task 0414): the core claim — chunks are observed during a buffered
    // run because runTraced threads onOutput into the executor call. Must fail
    // if the onOutput wiring is ever removed.
    test('passes onOutput to the executor on the runTraced path (R7 core claim)', async () => {
        const svc = makeService();
        const { deps, runner } = mockDeps();
        await svc.runTraced('prompt', { agent: 'pi' }, deps);
        const callArgs = runner.runPromptCommand.mock.calls[0] as [
            string,
            unknown,
            { onOutput?: (output: unknown) => void } | undefined,
        ];
        expect(typeof callArgs[2]?.onOutput).toBe('function');
    });

    // R3 mutation check (task 0414 / H83 R5): the pipeline path must never
    // re-expose a TTY to the child. nonInteractive uses pipe-no-TTY; if that
    // contract is dropped for stream-inherit, outputMode flips and
    // stdinInteractive may become true — these assertions catch the regression.
    test('non-interactive contract keeps the child TTY-blind (R3 mutation check)', async () => {
        const svc = makeService();
        const deps = makeSimpleDeps('pi');
        const result = await svc.runTraced('/sp:dev-run 0414 --mode implement --auto', { agent: 'pi' }, deps);
        expect(result.invocation?.outputMode).toBe('pipe');
        expect(result.invocation?.stdinInteractive).toBe(false);
    });

    // R5 (task 0414): observability must be best-effort — an observer that
    // throws must not interrupt or fail the agent run.
    test('a throwing observer never fails the run (R5)', async () => {
        const svc = makeService();
        const deps = makeSimpleDeps('pi');
        const result = await svc.runTraced('hello', { agent: 'pi' }, deps, {
            observer: () => {
                throw new Error('observer exploded');
            },
            heartbeatMs: 0,
        });
        expect(result.exitCode).toBe(0);
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

    test('G5 regression: omitted --agent resolves ok (omit path unchanged)', async () => {
        const svc = makeService();
        const { deps } = mockDeps();
        const result = await svc.resolve({}, deps);
        expect(result.ok).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService — phase-aware auto resolution with executor profiles (0126)
// ---------------------------------------------------------------------------
// These exercise the `run`/`executeRun` path (the only path that threads the
// prompt → phase). The resolved agent + model are observed via the agent name
// passed to runPromptCommand and the model in PromptOptions.

/** Build a service with an `agent` config block threaded in. */
function makeConfiguredService(
    agentConfig: AgentConfig,
    env: Record<string, string | undefined> = {},
    roles?: ReadonlyMap<string, AgentRoleDefinition>,
    output: AgentServiceOutput = nullOutput(),
) {
    return new AgentService({ cwd: process.cwd(), env, output, agentConfig, ...(roles ? { roles } : {}) });
}

/** Layer-1 role map mirroring `plugins/sp/references/roles.md` (0535), stages included. */
function roleMap(): Map<string, AgentRoleDefinition> {
    return new Map<string, AgentRoleDefinition>([
        ['scribe', { tier: 'cheap', stages: ['changelog'] }],
        ['coder', { tier: 'standard', stages: ['implement', 'test', 'wrap'] }],
        ['reviewer', { tier: 'capable-1', stages: ['verify', 'review', 'dogfood'] }],
        ['planner', { tier: 'capable-2', stages: ['plan', 'refine', 'brainstorm'] }],
    ]);
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
    };

    test('R1: slash-command auto resolves via stage/default without default-by-phase (0452)', async () => {
        const svc = makeConfiguredService(fullConfig);
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('/sp:dev-run 0126 --auto', { agent: 'auto', json: true }, deps);
        expect(code).toBe(0);
        // No default-by-phase: stage model_policy or agent.default → omp (no zai model force)
        expect(resolvedAgent(runner)).toBe('omp');
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

    test('R2 (0542): a pre-0126 bare-agent `{ default: <agent> }` fails naming both accepted sets', async () => {
        // The old contract — `default` resolves as a legacy direct agent name — is
        // retired by 0542 R2: the value domain moved to roles. A bare agent name
        // that is neither a role nor a configured executor now fails loudly.
        const svc = makeConfiguredService({ default: 'pi' });
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('/sp:dev-run 0126', { agent: 'auto', json: true }, deps);
        expect(code).toBe(2);
        expect(resolvedAgent(runner)).toBeUndefined();
        expect(runner.runPromptCommand).not.toHaveBeenCalled();
    });

    test('R6: explicit --model overrides the executor model override', async () => {
        const svc = makeConfiguredService(fullConfig);
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'omp-zai', model: 'my-model', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('omp');
        expect(resolvedModel(runner)).toBe('my-model');
    });

    test('R4 (0536): prompt text never derives a stage — every slash surface form resolves like free text', async () => {
        // `extractPhase` is retired (0536 R4): a slash command in the prompt must
        // not change resolution. Each per-agent surface form (claude /sp:,
        // opencode/gemini /sp-, pi/omp /skill:sp-, codex $sp-, plus rd3 variants)
        // and a free-text prompt resolve identically through agent.default — the
        // role (or default) is the selector, never the prompt text.
        const prompts = [
            '/sp:dev-run 0126', // claude
            '/sp-dev-run 0126', // opencode / gemini
            '/skill:sp-dev-run 0126', // pi / omp
            '$sp-dev-run 0126', // codex
            '/rd3:dev-run 0126', // rd3 claude
            '/rd3-dev-run 0126', // rd3 opencode / gemini
            '/skill:rd3-dev-run 0126', // rd3 pi / omp
            '$rd3-dev-run 0126', // rd3 codex
            'implement task X', // free text
        ];
        for (const prompt of prompts) {
            const svc = makeConfiguredService(fullConfig);
            const { deps, runner } = mockResolutionDeps();
            const code = await svc.run(prompt, { agent: 'auto', json: true }, deps);
            expect(code, `prompt=${prompt}`).toBe(0);
            // No stage derived from the text → default executor 'omp'.
            expect(resolvedAgent(runner), `prompt=${prompt}`).toBe('omp');
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

describe('AgentService executor-aware explicit --agent (0346)', () => {
    // Same fixture as phase-aware auto: omp + omp-zai + claude executors,
    // with omp-zai and claude both shadowing bare-binary names.
    const cfg: AgentConfig = {
        default: 'omp',
        executors: [
            { name: 'omp', agent: 'omp' },
            { name: 'omp-zai', agent: 'omp', model: 'zai//glm-5.2' },
            { name: 'claude', agent: 'claude' },
        ],
    };

    test('R5: --agent <executor-name> resolves to that executor with model override', async () => {
        const svc = makeConfiguredService(cfg);
        const { deps, runner } = mockResolutionDeps();
        // Plain prompt, explicit selector — no phase routing involved.
        const code = await svc.run('plain prompt', { agent: 'omp-zai', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('omp');
        expect(resolvedModel(runner)).toBe('zai//glm-5.2');
    });

    test('R3 collision: --agent <shared-name> resolves to the executor, not the bare binary', async () => {
        const svc = makeConfiguredService(cfg);
        const { deps, runner } = mockResolutionDeps();
        // 'claude' is both a bare binary and an executor entry; executor wins.
        const code = await svc.run('plain prompt', { agent: 'claude', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('claude');
        // The executor entry has no model override; none propagates.
        expect(resolvedModel(runner)).toBeUndefined();
    });

    test('R2 no-regression: --agent <bare-binary> with no matching executor still resolves', async () => {
        const svc = makeConfiguredService(cfg);
        const { deps, runner } = mockResolutionDeps();
        // 'pi' is a canonical agent with no executor entry — legacy direct path.
        const code = await svc.run('plain prompt', { agent: 'pi', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('pi');
        expect(resolvedModel(runner)).toBeUndefined();
    });

    test('explicit --agent still ignores phase mapping (R8 preserved)', async () => {
        const svc = makeConfiguredService(cfg);
        const { deps, runner } = mockResolutionDeps();
        // dev-run maps to omp-zai, but an explicit agent must win with no model override.
        const code = await svc.run('/sp:dev-run 0126', { agent: 'claude', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('claude');
        expect(resolvedModel(runner)).toBeUndefined();
    });

    test('explicit --agent <unknown> exits 2 and the diagnostic lists available executors (R8, task 0413)', async () => {
        const svc = makeConfiguredService(cfg);
        const { deps } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'not-a-name', json: true }, deps);
        expect(code).toBe(2);
    });

    test('R8 (task 0413): unknown --agent error message lists every configured executor', async () => {
        const { errors, output } = captureOutput();
        const svc = new AgentService({ cwd: process.cwd(), env: {}, output, agentConfig: cfg });
        const { deps } = mockResolutionDeps();
        await svc.run('plain prompt', { agent: 'not-a-name', json: true }, deps);
        // The diagnostic must name the offending value AND list available executors
        // so a typo is recoverable rather than an opaque "Unknown agent".
        const diag = errors.join('\n');
        expect(diag).toContain("Unknown agent: 'not-a-name'");
        expect(diag).toContain('omp');
        expect(diag).toContain('omp-zai');
        expect(diag).toContain('claude');
    });

    test('ADR-047 (G5): --agent inline fails resolution with the frozen message — no agent.default fallback, no dispatch', async () => {
        const { errors, output } = captureOutput();
        const svc = new AgentService({ cwd: process.cwd(), env: {}, output, agentConfig: cfg });
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'inline', json: true }, deps);
        // Explicit inline is host-session-only; a headless surface cannot host a
        // session, so resolution fails loudly through the resolve-failure channel
        // — never normalized to agent.default (no default-executor subprocess).
        expect(code).toBe(2);
        expect(runner.runPromptCommand).not.toHaveBeenCalled();
        expect(errors.join('\n')).toContain(AGENT_INLINE_HEADLESS_MESSAGE);
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService — role routing (0536)
// ---------------------------------------------------------------------------
// `--agent` takes a role (scribe|coder|reviewer|planner) from
// `plugins/sp/references/roles.md`; a role selects the *starting* tier and
// resolution begins at that tier's cheapest eligible executor (R1). An explicit
// executor name remains a permanent pin that beats role routing (R2). A value
// that is neither a role, a configured executor, nor a bare binary is rejected
// before any spawn (R3). Prompt-regex phase detection is gone (R4).

describe('AgentService role routing (0536)', () => {
    const roleCfg: AgentConfig = {
        executors: [
            { name: 'cheap-exec', agent: 'pi', tier: 'cheap' },
            { name: 'std-exec', agent: 'pi', tier: 'standard' },
            { name: 'cap1-exec', agent: 'claude', tier: 'capable-1' },
        ],
    };

    function envelopeJson(output: { lines: string[]; errors: string[] }): Record<string, unknown> {
        const line = output.lines.find((l) => l.includes('"exitCode"'));
        expect(line, 'expected a JSON envelope line').toBeDefined();
        return JSON.parse(line ?? '') as Record<string, unknown>;
    }

    test('R1: --agent reviewer starts from the reviewer tier (capable-1) and picks the cheapest eligible executor', async () => {
        const { lines, errors, output } = captureOutput();
        const svc = makeConfiguredService(roleCfg, {}, roleMap(), output);
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'reviewer', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('claude');
        const resolved = envelopeJson({ lines, errors }).resolved as Record<string, unknown>;
        expect(resolved.role).toBe('reviewer');
        expect(resolved.tier).toBe('capable-1');
        expect(resolved.executor).toBe('cap1-exec');
        expect(resolved.agent).toBe('claude');
        expect(resolved.source).toBe('role');
    });

    test('a role whose folded stages span tiers routes through the highest floor, never a cheaper one', async () => {
        // coder folds implement/test/wrap — all `standard`. Picking the max min_tier
        // (not stages[0]) is what guarantees a reordered roles.md cannot silently
        // downgrade a role's starting tier.
        const { lines, errors, output } = captureOutput();
        const svc = makeConfiguredService(roleCfg, {}, roleMap(), output);
        const { deps } = mockResolutionDeps();

        await svc.run('plain prompt', { agent: 'auto', role: 'coder', json: true }, deps);

        const resolved = envelopeJson({ lines, errors }).resolved as Record<string, unknown>;
        expect(resolved.tier).toBe('standard');
    });

    test('R1: --agent coder floors at standard — the cheap executor is not eligible', async () => {
        const svc = makeConfiguredService(roleCfg, {}, roleMap());
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'coder', json: true }, deps);
        expect(code).toBe(0);
        // Cheapest eligible for standard is std-exec (pi), not cheap-exec.
        expect(resolvedAgent(runner)).toBe('pi');
    });

    test('R1: --agent scribe floors at cheap — the cheapest executor wins', async () => {
        const svc = makeConfiguredService(roleCfg, {}, roleMap());
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'scribe', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('pi');
    });

    test('R1: no executor at the role tier → exit 1 naming the role and tier', async () => {
        const svc = makeConfiguredService(
            { executors: [{ name: 'cheap-exec', agent: 'pi', tier: 'cheap' }] },
            {},
            roleMap(),
        );
        const { deps } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'planner', json: true }, deps);
        expect(code).toBe(1);
    });

    test('R2: an explicit executor pin beats role routing and emits no deprecation warning', async () => {
        const { lines, errors, output } = captureOutput();
        const svc = makeConfiguredService(roleCfg, {}, roleMap(), output);
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'cap1-exec', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('claude');
        const resolved = envelopeJson({ lines, errors }).resolved as Record<string, unknown>;
        // The pin is the executor — not a role-resolved choice; both values ride the envelope.
        expect(resolved.executor).toBe('cap1-exec');
        expect(resolved.agent).toBe('claude');
        expect(resolved.source).toBe('explicit');
        expect(resolved.role).toBeUndefined();
        expect(errors.join('\n')).not.toMatch(/deprecat/i);
    });

    test('0538 R2: --agent auto plus a declared role resolves from the declared role tier', async () => {
        const { lines, errors, output } = captureOutput();
        const svc = makeConfiguredService(roleCfg, {}, roleMap(), output);
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'auto', role: 'reviewer', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('claude');
        const resolved = envelopeJson({ lines, errors }).resolved as Record<string, unknown>;
        expect(resolved.role).toBe('reviewer');
        expect(resolved.tier).toBe('capable-1');
        expect(resolved.executor).toBe('cap1-exec');
        expect(resolved.source).toBe('role');
    });

    test('0538 R2: an explicit pin plus a declared role runs the pin and records the role for attribution', async () => {
        const { lines, errors, output } = captureOutput();
        const svc = makeConfiguredService(roleCfg, {}, roleMap(), output);
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'cap1-exec', role: 'reviewer', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('claude');
        const resolved = envelopeJson({ lines, errors }).resolved as Record<string, unknown>;
        expect(resolved.executor).toBe('cap1-exec');
        expect(resolved.source).toBe('explicit');
        expect(resolved.role).toBe('reviewer');
        expect(errors.join('\n')).not.toMatch(/deprecat/i);
    });

    test('0538 R1: an unknown declared role fails loudly naming the vocabulary', async () => {
        const { errors, output } = captureOutput();
        const svc = makeConfiguredService(roleCfg, {}, roleMap(), output);
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'auto', role: 'sorcerer', json: true }, deps);
        expect(code).toBe(2);
        expect(runner.runPromptCommand).not.toHaveBeenCalled();
        expect(errors.join('\n')).toContain("Unknown declared role: 'sorcerer'");
    });

    test('R3: an unknown value exits 2 naming both accepted sets, and nothing spawns', async () => {
        const { errors, output } = captureOutput();
        const svc = makeConfiguredService(roleCfg, {}, roleMap(), output);
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'not-a-name', json: true }, deps);
        expect(code).toBe(2);
        expect(runner.runPromptCommand).not.toHaveBeenCalled();
        const diag = errors.join('\n');
        expect(diag).toContain("Unknown agent: 'not-a-name'");
        expect(diag).toContain('role');
        expect(diag).toContain('scribe');
        expect(diag).toContain('configured executor');
    });

    test('R3: a bare coding-agent binary name warns once and runs under the registered shim', async () => {
        const { errors, output } = captureOutput();
        const svc = makeConfiguredService(roleCfg, {}, roleMap(), output);
        // 'hermes' is a canonical agent with no executor entry → bare-binary shim path.
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'hermes', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('hermes');
        const warnings = errors.filter((e) => e.includes('bare coding-agent binary name'));
        expect(warnings).toHaveLength(1);
        // Warn once, not per dispatch: a second run with the same name stays silent.
        const code2 = await svc.run('plain prompt', { agent: 'hermes', json: true }, deps);
        expect(code2).toBe(0);
        expect(errors.filter((e) => e.includes('bare coding-agent binary name'))).toHaveLength(1);
    });

    test('R4: a free-text prompt with --agent coder resolves the same tier as the equivalent slash command', async () => {
        const svcSlash = makeConfiguredService(roleCfg, {}, roleMap());
        const { deps: deps1, runner: runner1 } = mockResolutionDeps();
        const code1 = await svcSlash.run('/sp:dev-run 0126 --auto', { agent: 'coder', json: true }, deps1);
        const svcFree = makeConfiguredService(roleCfg, {}, roleMap());
        const { deps: deps2, runner: runner2 } = mockResolutionDeps();
        const code2 = await svcFree.run('implement task X', { agent: 'coder', json: true }, deps2);
        expect(code1).toBe(0);
        expect(code2).toBe(0);
        // Both resolve through the coder role's tier → the same executor.
        expect(resolvedAgent(runner1)).toBe('pi');
        expect(resolvedAgent(runner2)).toBe('pi');
    });

    test('R4: --agent auto with a slash prompt no longer derives a stage', async () => {
        const svc = makeConfiguredService(roleCfg, {}, roleMap());
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('/sp:dev-changelog', { agent: 'auto', json: true }, deps);
        expect(code).toBe(0);
        // No stage, no default → Tier-1 priority (pi), NOT the changelog stage's cheap executor.
        expect(resolvedAgent(runner)).toBe(TIER1_PRIORITY[0] as string);
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService — role propagation across fan-out (0551)
// ---------------------------------------------------------------------------
// A dispatched subagent that declares its own role resolves through that
// role's tier (declared wins); with nothing declared it inherits the
// dispatcher's effective role via SPUR_ROLE. The effective role and its
// origin ('declared' | 'inherited') ride the --json envelope per dispatched
// subagent (R3).

describe('AgentService role propagation (0551)', () => {
    const roleCfg: AgentConfig = {
        executors: [
            { name: 'cheap-exec', agent: 'pi', tier: 'cheap' },
            { name: 'std-exec', agent: 'pi', tier: 'standard' },
            { name: 'cap1-exec', agent: 'claude', tier: 'capable-1' },
        ],
    };

    function envelopeJson(output: { lines: string[]; errors: string[] }): Record<string, unknown> {
        const line = output.lines.find((l) => l.includes('"exitCode"'));
        expect(line, 'expected a JSON envelope line').toBeDefined();
        return JSON.parse(line ?? '') as Record<string, unknown>;
    }

    test("R1: a declared role beats the inherited SPUR_ROLE — origin 'declared'", async () => {
        const { lines, errors, output } = captureOutput();
        const svc = makeConfiguredService(roleCfg, { SPUR_ROLE: 'scribe' }, roleMap(), output);
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'auto', role: 'reviewer', json: true }, deps);
        expect(code).toBe(0);
        // reviewer floors at capable-1 — NOT the inherited scribe tier.
        expect(resolvedAgent(runner)).toBe('claude');
        const resolved = envelopeJson({ lines, errors }).resolved as Record<string, unknown>;
        expect(resolved.role).toBe('reviewer');
        expect(resolved.roleOrigin).toBe('declared');
    });

    test("R2: with nothing declared, the run inherits the dispatcher's role and its tier", async () => {
        const { lines, errors, output } = captureOutput();
        const svc = makeConfiguredService(roleCfg, { SPUR_ROLE: 'reviewer' }, roleMap(), output);
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'auto', json: true }, deps);
        expect(code).toBe(0);
        // Inherited reviewer floors at capable-1 → claude, not the cheap pi executor.
        expect(resolvedAgent(runner)).toBe('claude');
        const resolved = envelopeJson({ lines, errors }).resolved as Record<string, unknown>;
        expect(resolved.role).toBe('reviewer');
        expect(resolved.roleOrigin).toBe('inherited');
        expect(resolved.source).toBe('role');
        expect(resolved.executor).toBe('cap1-exec');
    });

    test("R2: inheritance respects the role's tier floor — coder inherits standard, not cheap", async () => {
        const { lines, errors, output } = captureOutput();
        const svc = makeConfiguredService(roleCfg, { SPUR_ROLE: 'coder' }, roleMap(), output);
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'auto', json: true }, deps);
        expect(code).toBe(0);
        // Both cheap-exec and std-exec map to agent pi; the tier + executor
        // assertions are what distinguish the inherited standard floor.
        expect(resolvedAgent(runner)).toBe('pi');
        const resolved = envelopeJson({ lines, errors }).resolved as Record<string, unknown>;
        expect(resolved.role).toBe('coder');
        expect(resolved.tier).toBe('standard');
        expect(resolved.executor).toBe('std-exec');
    });

    test('R2: an unknown inherited role warns once and falls through to priority', async () => {
        const { errors, output } = captureOutput();
        const svc = makeConfiguredService(roleCfg, { SPUR_ROLE: 'sorcerer' }, roleMap(), output);
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'auto', json: true }, deps);
        // Inheritance must never hard-fail a dispatch — stale env degrades to priority.
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe(TIER1_PRIORITY[0] as string);
        expect(errors.join('\n')).toContain("ignoring inherited role 'sorcerer'");
    });

    test('R3: an explicit pin inherits attribution — the pin wins routing, the envelope carries role + origin', async () => {
        const { lines, errors, output } = captureOutput();
        const svc = makeConfiguredService(roleCfg, { SPUR_ROLE: 'reviewer' }, roleMap(), output);
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'cap1-exec', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('claude');
        const resolved = envelopeJson({ lines, errors }).resolved as Record<string, unknown>;
        expect(resolved.executor).toBe('cap1-exec');
        expect(resolved.source).toBe('explicit');
        expect(resolved.role).toBe('reviewer');
        expect(resolved.roleOrigin).toBe('inherited');
    });

    test('R3: a stale inherited role under an executor pin warns — never drops silently', async () => {
        const { errors, output } = captureOutput();
        const svc = makeConfiguredService(roleCfg, { SPUR_ROLE: 'sorcerer' }, roleMap(), output);
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'cap1-exec', json: true }, deps);
        expect(code).toBe(0);
        // The pin still wins routing; the unknown inherited role must surface as
        // a warning (same path as the auto branch), not vanish without a trace.
        expect(resolvedAgent(runner)).toBe('claude');
        expect(errors.join('\n')).toContain("ignoring inherited role 'sorcerer'");
    });

    test("R3: a role selector under an inherited role records 'declared', not 'inherited'", async () => {
        const { lines, errors, output } = captureOutput();
        const svc = makeConfiguredService(roleCfg, { SPUR_ROLE: 'scribe' }, roleMap(), output);
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'reviewer', json: true }, deps);
        expect(code).toBe(0);
        // --agent reviewer resolves through reviewer's tier (capable-1), ignoring scribe.
        expect(resolvedAgent(runner)).toBe('claude');
        const resolved = envelopeJson({ lines, errors }).resolved as Record<string, unknown>;
        expect(resolved.role).toBe('reviewer');
        expect(resolved.roleOrigin).toBe('declared');
    });

    test('R3: a mixed fan-out surfaces each dispatched subagent’s own role and origin', async () => {
        const { lines, output } = captureOutput();
        // One dispatcher (SPUR_ROLE=scribe) fans out two subagents.
        const svc = makeConfiguredService(roleCfg, { SPUR_ROLE: 'scribe' }, roleMap(), output);
        const { deps: depsA, runner: runnerA } = mockResolutionDeps();
        const { deps: depsB, runner: runnerB } = mockResolutionDeps();
        // Subagent A declares nothing → inherits the dispatcher's scribe role.
        const codeA = await svc.run('summarize the diff', { agent: 'auto', json: true }, depsA);
        // Subagent B declares its own reviewer role → declared wins.
        const codeB = await svc.run('review the plan', { agent: 'auto', role: 'reviewer', json: true }, depsB);
        expect(codeA).toBe(0);
        expect(codeB).toBe(0);
        expect(resolvedAgent(runnerA)).toBe('pi');
        expect(resolvedAgent(runnerB)).toBe('claude');
        const origins = lines
            .filter((l) => l.includes('"roleOrigin"'))
            .map((l) => (JSON.parse(l) as Record<string, unknown>).resolved as Record<string, unknown>);
        expect(origins).toHaveLength(2);
        expect(origins[0]).toMatchObject({ role: 'scribe', roleOrigin: 'inherited' });
        expect(origins[1]).toMatchObject({ role: 'reviewer', roleOrigin: 'declared' });
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService — agent.default role domain (0542 R2)
// ---------------------------------------------------------------------------
// `agent.default` is redefined as the default *role* for a dispatch that
// declares nothing. Three-way migration, all loud: a role uses the new
// semantics; a configured executor name warns once and keeps legacy fallthrough
// (shim agent-default-executor); a value that is neither fails naming both
// accepted sets.

describe('AgentService agent.default role domain (0542)', () => {
    const execCfg: AgentConfig = {
        default: 'omp',
        executors: [
            { name: 'cheap-exec', agent: 'pi', tier: 'cheap' },
            { name: 'std-exec', agent: 'pi', tier: 'standard' },
            { name: 'omp', agent: 'omp', tier: 'standard' },
            { name: 'cap1-exec', agent: 'claude', tier: 'capable-1' },
        ],
    };

    test('R2: a role value resolves via the role (recommended default coder → standard floor)', async () => {
        const svc = makeConfiguredService({ ...execCfg, default: 'coder' }, {}, roleMap());
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'auto', json: true }, deps);
        expect(code).toBe(0);
        // coder floors at standard → cheapest standard executor (std-exec, array order).
        expect(resolvedAgent(runner)).toBe('pi');
    });

    test('R2: a configured executor value warns once and keeps legacy fallthrough', async () => {
        const { errors, output } = captureOutput();
        // 'std-exec' is not used as an agent.default value anywhere else in this
        // suite, so the per-selector warn-once module set is cold for it (the
        // phase-aware describe pre-warms 'omp').
        const svc = makeConfiguredService({ ...execCfg, default: 'std-exec' }, {}, undefined, output);
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'auto', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('pi');
        expect(errors.join('\n')).toContain('agent.default "std-exec" is a configured executor name');
        expect(errors.join('\n')).toContain('agent-default-executor');
        // Second run warns no more (warn-once per selector).
        const second = await svc.run('another prompt', { agent: 'auto', json: true }, deps);
        expect(second).toBe(0);
        expect(errors.join('\n').split('configured executor name').length - 1).toBe(1);
    });

    test('R2: a value that is neither a role nor an executor fails naming both accepted sets', async () => {
        const { errors, output } = captureOutput();
        const svc = makeConfiguredService({ ...execCfg, default: 'bogus-default' }, {}, roleMap(), output);
        const { deps, runner } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'auto', json: true }, deps);
        expect(code).toBe(2);
        expect(runner.runPromptCommand).not.toHaveBeenCalled();
        const joined = errors.join('\n');
        expect(joined).toContain("Unknown agent.default value: 'bogus-default'");
        expect(joined).toContain('role (');
        expect(joined).toContain('configured executor (');
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

// ---------------------------------------------------------------------------
// Tests: AgentService — Stage-registry adaptive model routing (0319)
// ---------------------------------------------------------------------------

describe('AgentService stage-registry adaptive model routing (0319)', () => {
    const stageConfig: AgentConfig = {
        executors: [
            { name: 'cheap-exec', agent: 'pi', tier: 'cheap' },
            { name: 'std-exec', agent: 'pi', tier: 'standard' },
            { name: 'capable-exec', agent: 'claude', tier: 'capable-1' },
        ],
    };

    test('R1: resolution keys on canonical stage_id via explicit --stage flag', async () => {
        const svc = makeConfiguredService(stageConfig);
        const { deps, runner } = mockResolutionDeps();
        // Subagent run with no /sp: prefix, passing explicit --stage implement
        const code = await svc.run(
            'Implement the user requirement',
            { agent: 'auto', stage: 'implement', json: true },
            deps,
        );
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('pi');
    });

    test('R2: consumes stage model_policy and starts on cheapest eligible executor', async () => {
        const svc = makeConfiguredService({
            executors: [
                { name: 'cheap-exec', agent: 'pi', tier: 'cheap' },
                { name: 'capable-exec', agent: 'claude', tier: 'capable-1' },
            ],
        });
        const { deps, runner } = mockResolutionDeps();
        // Stage changelog has min_tier: cheap -> selects cheap-exec. The stage
        // comes from the explicit --stage flag (prompt text never derives one,
        // 0536 R4 — the slash command alone would fall through to default/priority).
        const code = await svc.run('/sp:dev-changelog', { agent: 'auto', stage: 'changelog', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('pi');
    });

    // Task 0413 R9: sub-tier ordering across capable-1/2/3 was the newest and least-proven part of
    // the tier logic (0343 split bare `capable` into quality sub-tiers). Array order must NOT decide
    // between different capable sub-tiers — only between executors sharing the exact same tier.
    test('R9 (task 0413): cheapest eligible wins across capable sub-tiers, not array order', async () => {
        const svc = makeConfiguredService({
            executors: [
                // Deliberately declared highest-first so array order would pick capable-3 if it won.
                { name: 'cap3-exec', agent: 'claude', tier: 'capable-3' },
                { name: 'cap2-exec', agent: 'grok', tier: 'capable-2' },
                { name: 'cap1-exec', agent: 'pi', tier: 'capable-1' },
                { name: 'std-exec', agent: 'omp', tier: 'standard' },
            ],
        });
        const { deps, runner } = mockResolutionDeps();
        // Stage verify floors at capable-1 -> cheapest ELIGIBLE is capable-1, despite being declared last.
        const code = await svc.run('Verify task', { agent: 'auto', stage: 'verify', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('pi');
    });

    test('R9 (task 0413): a sub-tier below the floor is not eligible', async () => {
        const svc = makeConfiguredService({
            executors: [
                { name: 'std-exec', agent: 'omp', tier: 'standard' },
                { name: 'cap2-exec', agent: 'grok', tier: 'capable-2' },
            ],
        });
        const { deps, runner } = mockResolutionDeps();
        // verify floors at capable-1: standard is below the floor, so capable-2 must win even
        // though it is more expensive and declared later.
        const code = await svc.run('Verify task', { agent: 'auto', stage: 'verify', json: true }, deps);
        expect(code).toBe(0);
        expect(resolvedAgent(runner)).toBe('grok');
    });

    test('R3: objective escalation signal selects fallback entry and records escalation', async () => {
        const { errors, output } = captureOutput();
        const svc = makeService({}, output, stageConfig);
        const { deps, runner } = mockResolutionDeps();

        // Stage implement has min_tier: standard, fallback on gate-fail: capable-1
        const code = await svc.run(
            'Implement task',
            {
                agent: 'auto',
                stage: 'implement',
                signal: 'gate-fail',
                'from-executor': 'std-exec',
                json: true,
            },
            deps,
        );
        expect(code).toBe(0);
        // Escalated to capable-exec (claude)
        expect(resolvedAgent(runner)).toBe('claude');
        expect(errors.some((e) => e.includes('Stage escalation: stage=implement signal=gate-fail'))).toBe(true);
    });

    test('R5: stage mapping fails fast when executor maps to unknown agent', async () => {
        const svc = makeConfiguredService({
            executors: [{ name: 'unknown-agent-exec', agent: 'nonexistent-agent', tier: 'standard' }],
        });
        const { deps } = mockResolutionDeps();
        const code = await svc.run('/sp:dev-run 0319', { agent: 'auto', stage: 'implement', json: true }, deps);
        expect(code).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService — automatic tier escalation on objective failure (0407)
// ---------------------------------------------------------------------------
// R7: Prove by test, not by wiring. These tests inject a resource-exhaustion
// failure on the starting tier and assert the next tier is selected — and
// they must FAIL if the escalation path is severed (verified by mutation).

describe('AgentService automatic tier escalation (0407)', () => {
    // std-exec (pi, standard) → capable-exec (claude, capable-1).
    // Stage implement has min_tier: standard, so std-exec is the starting tier.
    const escalationConfig: AgentConfig = {
        executors: [
            { name: 'std-exec', agent: 'pi', tier: 'standard' },
            { name: 'capable-exec', agent: 'claude', tier: 'capable-1' },
        ],
    };

    test('R7: exhaustion on starting tier escalates to the next tier and succeeds', async () => {
        const { errors, output } = captureOutput();
        const svc = makeService({}, output, escalationConfig);

        // Sequential runner: first dispatch (pi) fails with a rate-limit error,
        // second dispatch (claude) succeeds. After that, any further calls fail.
        const results: AgentRunResult[] = [
            makeRunResult({ exitCode: 1, stderr: 'Error: rate limit exceeded (429)' }),
            makeRunResult({ exitCode: 0 }),
        ];
        let callIndex = 0;
        const runPromptCommand = mock((_agent: string) => {
            const idx = Math.min(callIndex++, results.length - 1);
            return Promise.resolve(results[idx] ?? results[results.length - 1]);
        });
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({ name: 'pi', installed: true, version: '1.0.0', channels: [], error: null }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() => Promise.resolve(mockDoctorResult({ usable: true }))),
        } as unknown as AgentRunDeps['doctorRunner'];
        const deps = { runner: { runPromptCommand } as unknown as AgentRunDeps['runner'], detector, doctorRunner };

        const code = await svc.run('Implement the task', { agent: 'auto', stage: 'implement', json: false }, deps);

        // Escalation succeeded → exit code 0.
        expect(code).toBe(0);
        // Two dispatches: pi (starting tier) then claude (escalated tier).
        expect(runPromptCommand).toHaveBeenCalledTimes(2);
        const dispatchedAgents = runPromptCommand.mock.calls.map((c) => c[0] as string);
        expect(dispatchedAgents).toEqual(['pi', 'claude']);
        // R3: escalation is observable — the message names what failed and why.
        expect(errors.some((e) => e.includes('Escalating: std-exec'))).toBe(true);
        expect(errors.some((e) => e.includes('resource-exhaustion'))).toBe(true);
        expect(errors.some((e) => e.includes('retrying on capable-exec'))).toBe(true);
    });

    test('a DECLARED ROLE escalates — the ladder no longer needs a flag nothing sets', async () => {
        // Every test above drives escalation with `stage: 'implement'`. No production
        // caller sets that flag: `spur agent run` has no such option, the workflow
        // `agent.run` action forwards agent/role/model/mode/cwd/session/timeout, and
        // the server never sets it. So the ladder was green in tests and inert in
        // production. `role` is what the pipeline actually declares (0538 R2), and
        // `coder` folds implement/test/wrap — all `standard`, the same floor
        // `stage: 'implement'` supplied above.
        const { errors, output } = captureOutput();
        const svc = makeConfiguredService(escalationConfig, {}, roleMap(), output);

        const results: AgentRunResult[] = [
            makeRunResult({ exitCode: 1, stderr: 'Error: rate limit exceeded (429)' }),
            makeRunResult({ exitCode: 0 }),
        ];
        let callIndex = 0;
        const runPromptCommand = mock((_agent: string) => {
            const idx = Math.min(callIndex++, results.length - 1);
            return Promise.resolve(results[idx] ?? results[results.length - 1]);
        });
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({ name: 'pi', installed: true, version: '1.0.0', channels: [], error: null }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() => Promise.resolve(mockDoctorResult({ usable: true }))),
        } as unknown as AgentRunDeps['doctorRunner'];
        const deps = { runner: { runPromptCommand } as unknown as AgentRunDeps['runner'], detector, doctorRunner };

        // No `stage` flag anywhere — only the role a real dispatch carries.
        const code = await svc.run('Implement the task', { agent: 'auto', role: 'coder', json: false }, deps);

        expect(code).toBe(0);
        expect(runPromptCommand.mock.calls.map((c) => c[0] as string)).toEqual(['pi', 'claude']);
        expect(errors.some((e) => e.includes('Escalating: std-exec'))).toBe(true);
        expect(errors.some((e) => e.includes('retrying on capable-exec'))).toBe(true);
    });

    test('0503 R1: classified authentication failure escalates to the next executor', async () => {
        const { errors, output } = captureOutput();
        const svc = makeService({}, output, escalationConfig);
        const results: AgentRunResult[] = [
            makeRunResult({ exitCode: 1, stderr: "API key not found for provider 'volc'" }),
            makeRunResult({ exitCode: 0 }),
        ];
        let callIndex = 0;
        const runPromptCommand = mock((_agent: string) => {
            const idx = Math.min(callIndex++, results.length - 1);
            return Promise.resolve(results[idx] ?? results[results.length - 1]);
        });
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({ name: 'pi', installed: true, version: '1.0.0', channels: [], error: null }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() => Promise.resolve(mockDoctorResult({ usable: true }))),
        } as unknown as AgentRunDeps['doctorRunner'];
        const deps = { runner: { runPromptCommand } as unknown as AgentRunDeps['runner'], detector, doctorRunner };

        const code = await svc.run('Implement the task', { agent: 'auto', stage: 'implement', json: false }, deps);

        expect(code).toBe(0);
        expect(runPromptCommand).toHaveBeenCalledTimes(2);
        expect(runPromptCommand.mock.calls.map((call) => call[0] as string)).toEqual(['pi', 'claude']);
        expect(errors.some((line) => line.includes('Escalating: std-exec'))).toBe(true);
        expect(errors.some((line) => line.includes('failed with auth'))).toBe(true);
        expect(errors.some((line) => line.includes('retrying on capable-exec'))).toBe(true);
    });

    test('R7 (0482 R1): a PINNED executor still escalates on resource exhaustion', async () => {
        // The pipeline pins a concrete executor (`agent: ${vars.implementAgent}`),
        // not the literal `auto`. Before 0482 the pin resolved with no stage, so
        // `currentStage`/`maxEscalations` were 0 and the run died instead of
        // recovering. This test dispatches the production mode: a pinned executor
        // name, no `stage` flag — the stage is derived from the prompt phase.
        const { errors, output } = captureOutput();
        const svc = makeService({}, output, escalationConfig);

        // Sequential runner: first dispatch (pi) fails with a 429 quota body,
        // second dispatch (claude) succeeds.
        const results: AgentRunResult[] = [
            makeRunResult({ exitCode: 1, stderr: '429 Usage limit reached for 5 hour' }),
            makeRunResult({ exitCode: 0 }),
        ];
        let callIndex = 0;
        const runPromptCommand = mock((_agent: string) => {
            const idx = Math.min(callIndex++, results.length - 1);
            return Promise.resolve(results[idx] ?? results[results.length - 1]);
        });
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({ name: 'pi', installed: true, version: '1.0.0', channels: [], error: null }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() => Promise.resolve(mockDoctorResult({ usable: true }))),
        } as unknown as AgentRunDeps['doctorRunner'];
        const deps = { runner: { runPromptCommand } as unknown as AgentRunDeps['runner'], detector, doctorRunner };

        // Pinned executor — the stage must come from the explicit `--stage` flag
        // (0536 R4: prompt text never derives a stage; extractPhase is gone).
        const code = await svc.run(
            '/skill:sp-dev-run --mode implement 0482 --auto',
            { agent: 'std-exec', stage: 'implement', json: false },
            deps,
        );

        // Escalation succeeded → exit code 0; two dispatches pi → claude.
        expect(code).toBe(0);
        expect(runPromptCommand).toHaveBeenCalledTimes(2);
        const dispatchedAgents = runPromptCommand.mock.calls.map((c) => c[0] as string);
        expect(dispatchedAgents).toEqual(['pi', 'claude']);
        expect(errors.some((e) => e.includes('Escalating: std-exec'))).toBe(true);
        expect(errors.some((e) => e.includes('retrying on capable-exec'))).toBe(true);
    });

    test('R4/R6: chain exhaustion is reported honestly and bounded', async () => {
        const { errors, output } = captureOutput();
        const svc = makeService({}, output, escalationConfig);

        // Runner always fails with rate-limit → both executors are tried then
        // the chain exhausts (attemptedExecutors dup-check fires before the
        // maxEscalations bound).
        const runPromptCommand = mock(() =>
            Promise.resolve(makeRunResult({ exitCode: 1, stderr: 'Error: 429 Too Many Requests' })),
        );
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({ name: 'pi', installed: true, version: '1.0.0', channels: [], error: null }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() => Promise.resolve(mockDoctorResult({ usable: true }))),
            // 0485 R3: when the stage ladder is exhausted (all executors attempted),
            // resolveAgentAuto falls through to the priority path, which needs runAll.
            runAll: mock(() => Promise.resolve([mockDoctorResult({ usable: true })])),
        } as unknown as AgentRunDeps['doctorRunner'];
        const deps = { runner: { runPromptCommand } as unknown as AgentRunDeps['runner'], detector, doctorRunner };

        const code = await svc.run('Implement the task', { agent: 'auto', stage: 'implement', json: false }, deps);

        // Non-zero exit (the last failed result maps to exit 3).
        expect(code).not.toBe(0);
        // Only two executors in the chain → exactly 2 dispatches.
        expect(runPromptCommand).toHaveBeenCalledTimes(2);
        // R4: honest exhaustion report naming executors attempted.
        expect(errors.some((e) => e.includes('Escalation chain exhausted'))).toBe(true);
        expect(errors.some((e) => e.includes('std-exec') && e.includes('capable-exec'))).toBe(true);
    });

    test('an escalated dispatch error keeps the invocation paired with the returned result', async () => {
        const svc = makeService({}, nullOutput(), escalationConfig);
        const runPromptCommand = mock((agent: string) =>
            agent === 'pi'
                ? Promise.resolve(makeRunResult({ exitCode: 1, stderr: 'Error: 429 Too Many Requests' }))
                : Promise.reject(new Error('dispatch failed')),
        );
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({ name: 'pi', installed: true, version: '1.0.0', channels: [], error: null }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() => Promise.resolve(mockDoctorResult({ usable: true }))),
        } as unknown as AgentRunDeps['doctorRunner'];

        const result = await svc.runTraced(
            'Implement the task',
            { agent: 'auto', stage: 'implement' },
            {
                runner: { runPromptCommand } as unknown as AgentRunDeps['runner'],
                detector,
                doctorRunner,
            },
        );

        expect(result.exitCode).toBe(3);
        expect(result.invocation?.agent).toBe('pi');
    });

    // ── 0485 R1: classifier vocabulary must cover realistic exhaustion signatures ──
    const EXHAUSTION_SIGNATURES = [
        'Claude usage limit reached',
        '5-hour limit reached; resets at 14:00',
        'error: rate_limit_exceeded',
        '{"error":{"type":"rate_limit_error"...}}',
        'out of tokens',
        'Insufficient credits',
        'API Error: 529 Overloaded',
        'usage limit exceeded',
        'rate limit exceeded (429)',
        'exceeded your current quota',
        'HTTP 429 Too Many Requests',
        'request exceeds the maximum context length',
    ];
    const NON_EXHAUSTION_SIGNATURES = [
        'rate of failure is high',
        'token bucket refilled',
        'no issues found',
        'Limited concurrency set to 4',
    ];

    describe.each(EXHAUSTION_SIGNATURES)('0485 R1 classifier signature: %s', (signature) => {
        test('classifies as resource-exhaustion and escalates', async () => {
            const { errors, output } = captureOutput();
            const svc = makeService({}, output, escalationConfig);
            const results: AgentRunResult[] = [
                makeRunResult({ exitCode: 1, stderr: signature }),
                makeRunResult({ exitCode: 0 }),
            ];
            let callIndex = 0;
            const runPromptCommand = mock((_agent: string) => {
                const idx = Math.min(callIndex++, results.length - 1);
                return Promise.resolve(results[idx] ?? results[results.length - 1]);
            });
            const detector = {
                detectOne: mock(() =>
                    Promise.resolve({ name: 'pi', installed: true, version: '1.0.0', channels: [], error: null }),
                ),
            } as unknown as AgentRunDeps['detector'];
            const doctorRunner = {
                runOne: mock(() => Promise.resolve(mockDoctorResult({ usable: true }))),
            } as unknown as AgentRunDeps['doctorRunner'];
            const deps = { runner: { runPromptCommand } as unknown as AgentRunDeps['runner'], detector, doctorRunner };

            const code = await svc.run('Implement the task', { agent: 'auto', stage: 'implement', json: false }, deps);

            expect(code).toBe(0);
            expect(runPromptCommand).toHaveBeenCalledTimes(2);
            expect(errors.some((e) => e.includes('Escalating: std-exec'))).toBe(true);
        });
    });

    describe.each(NON_EXHAUSTION_SIGNATURES)('0485 R1 classifier noise: %s', (signature) => {
        test('does not escalate — the result stands', async () => {
            const { output } = captureOutput();
            const svc = makeService({}, output, escalationConfig);
            const runPromptCommand = mock(() => Promise.resolve(makeRunResult({ exitCode: 1, stderr: signature })));
            const detector = {
                detectOne: mock(() =>
                    Promise.resolve({ name: 'pi', installed: true, version: '1.0.0', channels: [], error: null }),
                ),
            } as unknown as AgentRunDeps['detector'];
            const doctorRunner = {
                runOne: mock(() => Promise.resolve(mockDoctorResult({ usable: true }))),
            } as unknown as AgentRunDeps['doctorRunner'];
            const deps = { runner: { runPromptCommand } as unknown as AgentRunDeps['runner'], detector, doctorRunner };

            const code = await svc.run('Implement the task', { agent: 'auto', stage: 'implement', json: false }, deps);

            expect(code).not.toBe(0);
            expect(runPromptCommand).toHaveBeenCalledTimes(1);
        });
    });

    test('0485 R3+R4: exhaustion fails over sideways to a same-tier different-binary executor before escalating up-tier', async () => {
        const sidewaysConfig: AgentConfig = {
            executors: [
                { name: 'std-a', agent: 'pi', tier: 'standard' },
                // Aliases on an exhausted binary must be skipped run-wide.
                { name: 'std-a-alias', agent: 'pi', model: 'alternate-pi-model', tier: 'standard' },
                { name: 'std-b', agent: 'claude', tier: 'standard' },
                { name: 'std-b-alias', agent: 'claude', model: 'alternate-claude-model', tier: 'standard' },
                { name: 'cap-same-dead-binary', agent: 'pi', tier: 'capable-1' },
                { name: 'cap-exec', agent: 'codex', tier: 'capable-1' },
            ],
        };
        const { errors, output } = captureOutput();
        const svc = makeService({}, output, sidewaysConfig);
        // pi (std-a) exhausted → skip every pi alias → sideways to claude
        // (std-b) → skip every claude alias and the capable pi alias → codex.
        const results: AgentRunResult[] = [
            makeRunResult({ exitCode: 1, stderr: 'rate limit exceeded' }),
            makeRunResult({ exitCode: 1, stderr: 'usage limit reached' }),
            makeRunResult({ exitCode: 0 }),
        ];
        let callIndex = 0;
        const runPromptCommand = mock((_agent: string) => {
            const idx = Math.min(callIndex++, results.length - 1);
            return Promise.resolve(results[idx] ?? results[results.length - 1]);
        });
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({ name: 'pi', installed: true, version: '1.0.0', channels: [], error: null }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() => Promise.resolve(mockDoctorResult({ usable: true }))),
        } as unknown as AgentRunDeps['doctorRunner'];
        const deps = { runner: { runPromptCommand } as unknown as AgentRunDeps['runner'], detector, doctorRunner };

        const code = await svc.run('Implement the task', { agent: 'auto', stage: 'implement', json: false }, deps);

        expect(code).toBe(0);
        const dispatchedAgents = runPromptCommand.mock.calls.map((c) => c[0] as string);
        // Same-tier different-binary failover first (claude), then up-tier (codex);
        // attempted executors (std-a, std-b) are never re-dispatched.
        expect(dispatchedAgents).toEqual(['pi', 'claude', 'codex']);
        expect(errors.some((e) => e.includes('Failover:'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService coordination (ADR-057 wave 1 / G4)
// ---------------------------------------------------------------------------

async function makeDbService(
    env: Record<string, string | undefined> = {},
    output: AgentServiceOutput = nullOutput(),
    agentConfig?: AgentConfig,
) {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    const svc = new AgentService({ cwd: process.cwd(), env, output, agentConfig, getDb: async () => adapter });
    return { svc, adapter, output };
}

/** Minimal deps that dispatch `pi` and return exitCode 0. */
function piDeps(result: AgentRunResult = makeRunResult()): AgentRunDeps {
    const runner = { runPromptCommand: mock(() => Promise.resolve(result)) } as unknown as AgentRunDeps['runner'];
    const detector = {
        detectOne: mock(() =>
            Promise.resolve({ name: 'pi', installed: true, version: '1.0.0', channels: [], error: null }),
        ),
    } as unknown as AgentRunDeps['detector'];
    const doctorRunner = {
        runOne: mock(() => Promise.resolve(mockDoctorResult())),
    } as unknown as AgentRunDeps['doctorRunner'];
    return { runner, detector, doctorRunner };
}

describe('AgentService coordination (G4 / ADR-057 wave 1)', () => {
    test('R1 — spec-id run persists occupant with specId + agentKind + generation', async () => {
        const { svc, adapter } = await makeDbService();

        const exitCode = await svc.run('hello', { agent: 'pi', 'spec-id': 'reviewer' }, piDeps());
        expect(exitCode).toBe(0);

        const occupant = await svc.getOccupant({ specId: 'reviewer' });
        expect(occupant).not.toBeNull();
        expect(occupant?.specId).toBe('reviewer');
        expect(occupant?.agentKind).toBe('pi');
        expect(occupant?.generation).toBeGreaterThanOrEqual(1);
        expect(occupant?.runId).toBeTruthy();

        const run = await svc.getCoordinationRun(occupant?.runId ?? '');
        expect(run).not.toBeNull();
        expect(run?.occupant.specId).toBe('reviewer');
        expect(run?.status).toBe('exited');
        expect(Array.isArray(run?.artifactRefs)).toBe(true);

        adapter.close();
    });

    test('R1 — getOccupant by agentKind alone is rejected', async () => {
        const { svc, adapter } = await makeDbService();
        await expect(svc.getOccupant({ agentKind: 'codex' })).rejects.toThrow('occupant_lookup_kind_rejected');
        adapter.close();
    });

    test('R1 — bare agent run (no spec-id) creates no occupant', async () => {
        const { svc, adapter } = await makeDbService();

        const exitCode = await svc.run('hello', { agent: 'pi' }, piDeps());
        expect(exitCode).toBe(0);

        // No spec-id → no coordination row. A spec-id lookup for 'pi' (never used
        // as a spec here) finds nothing.
        expect(await svc.getOccupant({ specId: 'pi' })).toBeNull();
        adapter.close();
    });

    test('R2 — --json adds occupant + run keys, keeps existing keys', async () => {
        const captured = captureOutput();
        const { svc, adapter } = await makeDbService({}, captured.output);

        const exitCode = await svc.run('hello', { agent: 'pi', 'spec-id': 'reviewer', json: true }, piDeps());
        expect(exitCode).toBe(0);

        const jsonLine = captured.lines.find((l) => l.includes('"occupant"'));
        expect(jsonLine).toBeDefined();
        const parsed = JSON.parse(jsonLine ?? '');
        expect(parsed.exitCode).toBe(0); // existing key retained
        expect(parsed.stdout).toBe('hello from agent');
        expect(parsed.occupant.specId).toBe('reviewer');
        expect(parsed.occupant.agentKind).toBe('pi');
        expect(parsed.run.status).toBe('exited');
        expect(Array.isArray(parsed.run.artifactRefs)).toBe(true);

        adapter.close();
    });

    test('R2 — failed run records errored status', async () => {
        const { svc, adapter } = await makeDbService();
        const failed = makeRunResult({ exitCode: 1, stdout: '', stderr: 'boom' });

        const exitCode = await svc.run('hello', { agent: 'pi', 'spec-id': 'reviewer' }, piDeps(failed));
        expect(exitCode).toBe(3);

        const occupant = await svc.getOccupant({ specId: 'reviewer' });
        const run = await svc.getCoordinationRun(occupant?.runId ?? '');
        expect(run?.status).toBe('errored');

        adapter.close();
    });
});

// ---------------------------------------------------------------------------
// Tests: run→session mapping (feature E6 / task 0557)
// ---------------------------------------------------------------------------

describe('AgentService run→session mapping (E6 / task 0557)', () => {
    /** Deps whose runner writes a session file when dispatched (the agent's own write). */
    function sessionWritingDeps(
        home: string,
        sessionFile: string,
        content: string,
    ): AgentRunDeps & { runner: { runPromptCommand: ReturnType<typeof mock> } } {
        const runner = {
            runPromptCommand: mock(async () => {
                await Bun.write(join(home, sessionFile), content);
                return makeRunResult();
            }),
        } as unknown as AgentRunDeps['runner'];
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({ name: 'pi', installed: true, version: '1.0.0', channels: [], error: null }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() => Promise.resolve(mockDoctorResult())),
        } as unknown as AgentRunDeps['doctorRunner'];
        return { runner, detector, doctorRunner } as unknown as AgentRunDeps & {
            runner: { runPromptCommand: ReturnType<typeof mock> };
        };
    }

    test('R1 — a completed agent run maps its produced session file exactly', async () => {
        const home = mkdtempSync(join(tmpdir(), 'spur-e6-'));
        try {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(adapter);
            const svc = new AgentService({
                cwd: process.cwd(),
                env: {},
                output: nullOutput(),
                getDb: async () => adapter,
            });
            const observerWarnings: string[] = [];
            const deps = sessionWritingDeps(
                home,
                join('.pi', 'agent', 'sessions', '11111111-2222-3333-4444-555555555555.jsonl'),
                '{"id":"11111111-2222-3333-4444-555555555555","type":"user","message":{"role":"user","content":"hi"}}\n',
            );
            deps.sessionObserverFactory = (runId) =>
                new RunSessionObserver({
                    runId,
                    getDb: async () => adapter,
                    output: { error: (m: string) => observerWarnings.push(m) },
                    registry: { active: new Map(), overlapped: new Set() },
                    home,
                });

            const exitCode = await svc.run('hello', { agent: 'pi' }, deps);
            expect(exitCode).toBe(0);

            const dao = new RunSessionDao(adapter);
            const rows = await dao.getBySession('pi', '11111111-2222-3333-4444-555555555555');
            expect(rows, `observer warnings: ${observerWarnings.join(' | ')}`).toHaveLength(1);
            const row = rows[0];
            expect(row?.exactness).toBe('exact');
            expect(row?.mechanism).toBe('observed');
            expect(row?.run_id).toBeTruthy();
            adapter.close();
        } finally {
            rmSync(home, { recursive: true, force: true });
        }
    });

    test('R2 — a supplied --session-id yields the mapping without observation', async () => {
        const home = mkdtempSync(join(tmpdir(), 'spur-e6-'));
        try {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(adapter);
            const svc = new AgentService({
                cwd: process.cwd(),
                env: {},
                output: nullOutput(),
                getDb: async () => adapter,
            });
            const deps = sessionWritingDeps(
                home,
                join('.pi', 'agent', 'sessions', '11111111-2222-3333-4444-555555555555.jsonl'),
                '{"id":"11111111-2222-3333-4444-555555555555"}\n',
            );
            deps.sessionObserverFactory = (runId) =>
                new RunSessionObserver({
                    runId,
                    getDb: async () => adapter,
                    output: nullOutput(),
                    registry: { active: new Map(), overlapped: new Set() },
                    home,
                });

            // The root does not exist under `home` — observation could not find
            // anything, yet the supplied id is authoritative and exact.
            const exitCode = await svc.run('hello', { agent: 'pi', 'session-id': 'supplied-42' }, deps);
            expect(exitCode).toBe(0);

            const dao = new RunSessionDao(adapter);
            const rows = await dao.getBySession('pi', 'supplied-42');
            expect(rows).toHaveLength(1);
            const row = rows[0];
            expect(row?.exactness).toBe('exact');
            expect(row?.mechanism).toBe('supplied');
            expect(row?.run_id).toBeTruthy();
            adapter.close();
        } finally {
            rmSync(home, { recursive: true, force: true });
        }
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService — routing decision attribution (0545 R1/R2/R5)
// ---------------------------------------------------------------------------
// R5: one coverage test per selection source — role, pin, default, escalated —
// each asserting the recorded value, so an unrecorded path fails the suite
// rather than passing silently. Attribution rides the lifecycle started event
// (R1) and the escalation's own record (R2), both emitted from the resolution
// funnel's consumer in executeRun.

describe('AgentService routing decision attribution (0545)', () => {
    const attributionConfig: AgentConfig = {
        executors: [
            { name: 'cheap-exec', agent: 'pi', tier: 'cheap' },
            { name: 'std-exec', agent: 'pi', tier: 'standard' },
            { name: 'capable-exec', agent: 'claude', tier: 'capable-1' },
        ],
    };

    /** Collect lifecycle started events and escalation records from the service bus. */
    function attributionHarness(agentConfig: AgentConfig, env: Record<string, string | undefined> = {}) {
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const started: AgentExecutionStartedEvent[] = [];
        const escalations: Array<Record<string, unknown>> = [];
        bus.on('agent.execution', (event) => {
            const typed = event as AgentExecutionEvent;
            if (typed.kind === 'started') started.push(typed as AgentExecutionStartedEvent);
        });
        bus.on('agent.invoke.escalated', (event) => escalations.push(event as Record<string, unknown>));
        const svc = new AgentService({
            cwd: process.cwd(),
            env,
            output: nullOutput(),
            agentConfig,
            roles: roleMap(),
            events: bus,
        });
        return { bus, started, escalations, svc };
    }

    test('R5 role-resolved: a declared role records role, tier, executor, and source role', async () => {
        const { started, svc } = attributionHarness(attributionConfig);
        const { deps } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'auto', role: 'scribe', json: true }, deps);
        expect(code).toBe(0);
        expect(started[0]?.routing).toEqual({
            role: 'scribe',
            tier: 'cheap',
            executor: 'cheap-exec',
            source: 'role',
        });
    });

    test('R5 pinned: an explicit executor pin records tier, executor, and source explicit', async () => {
        const { started, svc } = attributionHarness(attributionConfig);
        const { deps } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'capable-exec', json: true }, deps);
        expect(code).toBe(0);
        expect(started[0]?.routing).toEqual({
            tier: 'capable-1',
            executor: 'capable-exec',
            source: 'explicit',
        });
    });

    test('R5 defaulted: agent.default routing through a role records source default, not role', async () => {
        const { started, escalations, svc } = attributionHarness({ ...attributionConfig, default: 'scribe' });
        const { deps } = mockResolutionDeps();
        const code = await svc.run('plain prompt', { agent: 'auto', json: true }, deps);
        expect(code).toBe(0);
        // Default-routed role: the selection source is `default`, distinguishable
        // from a declared role resolution (R1); role/tier/executor still recorded.
        expect(started[0]?.routing).toEqual({
            role: 'scribe',
            tier: 'cheap',
            executor: 'cheap-exec',
            source: 'default',
        });
        // A run that never escalates emits no escalation record (R2) — absence,
        // never a null-valued one.
        expect(escalations).toHaveLength(0);
    });

    test('R5 escalated: an objective failure records its own escalation row with both tiers and the trigger', async () => {
        const { started, escalations, svc } = attributionHarness(attributionConfig);
        // First dispatch (std-exec, pi) fails with a rate-limit body; the second
        // (capable-exec, claude) succeeds — the 0407 escalation ladder walks up.
        const results: AgentRunResult[] = [
            makeRunResult({ exitCode: 1, stderr: '5-hour limit reached; resets at 14:00' }),
            makeRunResult({ exitCode: 0 }),
        ];
        let callIndex = 0;
        const runPromptCommand = mock((_agent: string) => {
            const idx = Math.min(callIndex++, results.length - 1);
            return Promise.resolve(results[idx] ?? results[results.length - 1]);
        });
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({ name: 'pi', installed: true, version: '1.0.0', channels: [], error: null }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() => Promise.resolve(mockDoctorResult({ usable: true }))),
        } as unknown as AgentRunDeps['doctorRunner'];
        const deps = { runner: { runPromptCommand } as unknown as AgentRunDeps['runner'], detector, doctorRunner };

        const code = await svc.run('Implement task', { agent: 'std-exec', stage: 'implement', json: true }, deps);
        expect(code).toBe(0);
        expect(runPromptCommand).toHaveBeenCalledTimes(2);

        // The starting decision and the escalation are distinct records (R2):
        // the started event names the starting pin, the escalation names both
        // tiers and the objective trigger that caused it.
        expect(started[0]?.routing).toEqual({ tier: 'standard', executor: 'std-exec', source: 'explicit' });
        expect(escalations).toHaveLength(1);
        const escalation = escalations[0] as Record<string, unknown>;
        expect(escalation.fromExecutor).toBe('std-exec');
        expect(escalation.fromTier).toBe('standard');
        expect(escalation.toExecutor).toBe('capable-exec');
        expect(escalation.toTier).toBe('capable-1');
        expect(escalation.trigger).toBe('resource-exhaustion');
        // Joinable to the history plane over run_id (R1).
        expect(typeof escalation.runId).toBe('string');
        expect((escalation.runId as string).length).toBeGreaterThan(0);
    });

    test('R1: the escalation hop re-stamps routing on the next dispatch invoke payload (0545 review P3)', async () => {
        // Mutation coverage for the re-stamp in the escalation loop
        // (agent-service.ts:1025): the second dispatch's `agent.invoke.*` rows
        // must persist the ESCALATED decision, not the stale starting one. This
        // requires the service-built AiRunner (whose events bus is wrapped by
        // withInvokeRouting) — an injected `deps.runner` would bypass the
        // wrapper entirely and the re-stamp would be dead code.
        const { bus, svc } = attributionHarness(attributionConfig);
        const invokeStarts: Array<Record<string, unknown>> = [];
        bus.on('agent.invoke.start', (event) => {
            invokeStarts.push(event as Record<string, unknown>);
        });

        // Stub the process executor so the real AiRunner never spawns a
        // subprocess: first dispatch fails with a rate-limit body (triggers the
        // resource-exhaustion ladder), the escalated dispatch succeeds.
        const originalRun = RolePropagatingProcessExecutor.prototype.run;
        let processCall = 0;
        RolePropagatingProcessExecutor.prototype.run = mock(async () => {
            if (processCall++ === 0) {
                return {
                    command: 'pi',
                    args: [],
                    exitCode: 1,
                    stdout: '',
                    stderr: '5-hour limit reached',
                    durationMs: 42,
                };
            }
            return { command: 'claude', args: [], exitCode: 0, stdout: 'ok', stderr: '', durationMs: 42 };
        }) as typeof originalRun;
        try {
            const detector = {
                detectOne: mock(() =>
                    Promise.resolve({ name: 'pi', installed: true, version: '1.0.0', channels: [], error: null }),
                ),
            } as unknown as AgentRunDeps['detector'];
            const doctorRunner = {
                runOne: mock(() => Promise.resolve(mockDoctorResult({ usable: true }))),
            } as unknown as AgentRunDeps['doctorRunner'];
            // No deps.runner: the service constructs the real AiRunner with the
            // withInvokeRouting-wrapped events bus (0545 R1 seam).
            const deps = { detector, doctorRunner };

            const code = await svc.run('Implement task', { agent: 'std-exec', stage: 'implement', json: true }, deps);
            expect(code).toBe(0);

            // Two dispatches → two invoke.start rows. The first carries the
            // starting pin's attribution; the second must carry the escalated
            // tier/executor (capable-1 / capable-exec), not the stale starting
            // standard / std-exec — this is the re-stamp's observable contract.
            expect(invokeStarts).toHaveLength(2);
            expect(invokeStarts[0]?.routing).toEqual({ tier: 'standard', executor: 'std-exec', source: 'explicit' });
            expect(invokeStarts[1]?.routing).toEqual({ tier: 'capable-1', executor: 'capable-exec', source: 'stage' });
        } finally {
            RolePropagatingProcessExecutor.prototype.run = originalRun;
        }
    });
});

// ---------------------------------------------------------------------------
// Tests: AgentService — tier fallback and executor exhaustion under real failure (0540)
// ---------------------------------------------------------------------------
// R1–R3 drive the escalation ladder end-to-end through executeRun with real
// failing dispatches — not getNextFallback in isolation (that proof lives in
// the domain schema tests). 0407/0482/0485 covered the resource-exhaustion and
// auth ladders; these add a frozen-four objective signal (timeout), the full
// exhaustion naming (stage + tiers attempted + executors tried), and the
// unreachable-tier distinction for a gap in the tier ladder.

describe('AgentService tier fallback under real failure (0540)', () => {
    /** Deps whose runner returns results[i] for dispatch i+1 (the last repeats). */
    function sequentialDispatchDeps(results: AgentRunResult[]): {
        deps: AgentRunDeps;
        runPromptCommand: ReturnType<typeof mock>;
    } {
        let callIndex = 0;
        const runPromptCommand = mock((_agent: string) => {
            const idx = Math.min(callIndex++, results.length - 1);
            return Promise.resolve(results[idx] ?? results[results.length - 1]);
        });
        const detector = {
            detectOne: mock(() =>
                Promise.resolve({ name: 'pi', installed: true, version: '1.0.0', channels: [], error: null }),
            ),
        } as unknown as AgentRunDeps['detector'];
        const doctorRunner = {
            runOne: mock(() => Promise.resolve(mockDoctorResult({ usable: true }))),
            runAll: mock(() => Promise.resolve([mockDoctorResult({ usable: true })])),
        } as unknown as AgentRunDeps['doctorRunner'];
        return {
            deps: { runner: { runPromptCommand } as unknown as AgentRunDeps['runner'], detector, doctorRunner },
            runPromptCommand,
        };
    }

    /** Service + bus collecting escalation records — the run-record surface for transitions. */
    function escalationHarness(agentConfig: AgentConfig) {
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const escalations: Array<Record<string, unknown>> = [];
        const exhaustions: Array<Record<string, unknown>> = [];
        bus.on('agent.invoke.escalated', (event) => escalations.push(event as Record<string, unknown>));
        bus.on('agent.invoke.exhausted', (event) => exhaustions.push(event as Record<string, unknown>));
        const { errors, output } = captureOutput();
        const svc = new AgentService({ cwd: process.cwd(), env: {}, output, agentConfig, events: bus });
        return { escalations, exhaustions, errors, svc };
    }

    // std-exec (pi, standard) → capable-exec (claude, capable-1); stage
    // `implement` declares min_tier standard with a timeout → capable-1 entry.
    const ladderConfig: AgentConfig = {
        executors: [
            { name: 'std-exec', agent: 'pi', tier: 'standard' },
            { name: 'capable-exec', agent: 'claude', tier: 'capable-1' },
        ],
    };

    test('R1: a timeout on the starting tier escalates by the declared chain and records the transition + trigger', async () => {
        const { escalations, errors, svc } = escalationHarness(ladderConfig);
        // First dispatch exceeds its time budget — killed by signal, which
        // classifyDispatch maps to `timeout` (a frozen-four objective signal);
        // the escalated dispatch succeeds.
        const { deps, runPromptCommand } = sequentialDispatchDeps([
            makeRunResult({ exitCode: null, signal: 'SIGKILL', stderr: '' }),
            makeRunResult({ exitCode: 0 }),
        ]);

        const code = await svc.run('Implement the task', { agent: 'auto', stage: 'implement', json: false }, deps);

        // The next eligible executor by the declared chain ran and succeeded.
        expect(code).toBe(0);
        expect(runPromptCommand.mock.calls.map((c) => c[0] as string)).toEqual(['pi', 'claude']);
        // Transition observable on stderr with the trigger that caused it.
        expect(errors.some((e) => e.includes('Escalating: std-exec (tier standard) failed with timeout'))).toBe(true);
        expect(errors.some((e) => e.includes('retrying on capable-exec (tier capable-1)'))).toBe(true);
        // ... and in the run record: the escalation row carries both ends of the
        // transition and the trigger.
        expect(escalations).toHaveLength(1);
        const escalation = escalations[0] as Record<string, unknown>;
        expect(escalation.trigger).toBe('timeout');
        expect(escalation.fromExecutor).toBe('std-exec');
        expect(escalation.fromTier).toBe('standard');
        expect(escalation.toExecutor).toBe('capable-exec');
        expect(escalation.toTier).toBe('capable-1');
    });

    test('R2: exhaustion exits non-zero naming stage, tiers attempted, and executors tried — no fall-through to agent.default', async () => {
        // A configured agent.default must never receive the exhausted dispatch.
        const { escalations, exhaustions, errors, svc } = escalationHarness({ ...ladderConfig, default: 'std-exec' });
        const { deps, runPromptCommand } = sequentialDispatchDeps([
            makeRunResult({ exitCode: 1, stderr: 'Error: 429 Too Many Requests' }),
        ]);

        const code = await svc.run('Implement the task', { agent: 'auto', stage: 'implement', json: false }, deps);

        // Fails loudly — non-zero exit, never a silent give-up.
        expect(code).not.toBe(0);
        // Exactly the two ladder executors were dispatched — the agent.default
        // fall-through never spawned a dispatch.
        expect(runPromptCommand).toHaveBeenCalledTimes(2);
        expect(runPromptCommand.mock.calls.map((c) => c[0] as string)).toEqual(['pi', 'claude']);
        // The report carries all three: stage, tiers attempted, executors tried.
        const exhausted = errors.find((e) => e.includes('Escalation chain exhausted'));
        expect(exhausted).toBeDefined();
        expect(exhausted).toContain('stage=implement');
        expect(exhausted).toContain('tiers attempted: standard, capable-1');
        expect(exhausted).toContain('executors tried: std-exec, capable-exec');
        // One escalation happened before exhaustion; nothing further.
        expect(escalations).toHaveLength(1);
        // The exhaustion is also a structured event (--json parity with the stderr
        // diagnostic — review 0540 minor): stage, tiers, executors, attempt count.
        expect(exhaustions).toHaveLength(1);
        const exhaustedEvent = exhaustions[0] as Record<string, unknown>;
        expect(exhaustedEvent.stage).toBe('implement');
        expect(exhaustedEvent.tiersAttempted).toEqual(['standard', 'capable-1']);
        expect(exhaustedEvent.executorsTried).toEqual(['std-exec', 'capable-exec']);
        expect(exhaustedEvent.attempts).toBe(2);
        expect(exhaustedEvent.severity).toBe('error');
    });

    test('R3: escalation into an unconfigured fallback tier is reported unreachable and continues to the next reachable tier', async () => {
        // The live `.spur/config.yaml` gap as a fixture: capable-2 is
        // unconfigured while capable-1 and capable-3 are live. Stage `verify`
        // (min_tier capable-1) declares resource-exhaustion → capable-2 — the
        // ladder must walk past the gap to capable-3 instead of terminating
        // as exhausted.
        const gapConfig: AgentConfig = {
            executors: [
                { name: 'omp-deepseek', agent: 'omp', tier: 'capable-1' },
                { name: 'codex-sol', agent: 'codex', tier: 'capable-3' },
            ],
        };
        const { escalations, errors, svc } = escalationHarness(gapConfig);
        const { deps, runPromptCommand } = sequentialDispatchDeps([
            makeRunResult({ exitCode: 1, stderr: '429 Usage limit reached for 5 hour' }),
            makeRunResult({ exitCode: 0 }),
        ]);

        const code = await svc.run('Verify the task', { agent: 'auto', stage: 'verify', json: false }, deps);

        // The run continued past the gap and succeeded — not exhaustion.
        expect(code).toBe(0);
        expect(runPromptCommand.mock.calls.map((c) => c[0] as string)).toEqual(['omp', 'codex']);
        // The gap is reported as unreachable, naming the tier.
        const unreachable = errors.find((e) => e.includes('unreachable'));
        expect(unreachable).toBeDefined();
        expect(unreachable).toContain('capable-2');
        // ...and it is distinguishable from a failed rung: no chain-exhausted report.
        expect(errors.some((e) => e.includes('Escalation chain exhausted'))).toBe(false);
        expect(escalations).toHaveLength(1);
    });

    test('R3: an unreachable starting tier (min_tier gap) also reports and continues', async () => {
        // Stage `plan` floors at capable-2 — unconfigured in the same fixture.
        const gapConfig: AgentConfig = {
            executors: [
                { name: 'omp-deepseek', agent: 'omp', tier: 'capable-1' },
                { name: 'codex-sol', agent: 'codex', tier: 'capable-3' },
            ],
        };
        const { errors, svc } = escalationHarness(gapConfig);
        const { deps, runPromptCommand } = sequentialDispatchDeps([makeRunResult({ exitCode: 0 })]);

        const code = await svc.run('Plan the task', { agent: 'auto', stage: 'plan', json: false }, deps);

        // The run continues from the next reachable tier (capable-3 → codex).
        expect(code).toBe(0);
        expect(runPromptCommand).toHaveBeenCalledTimes(1);
        expect(resolvedAgent({ runPromptCommand })).toBe('codex');
        const unreachable = errors.find((e) => e.includes('unreachable'));
        expect(unreachable).toBeDefined();
        expect(unreachable).toContain("Stage 'plan'");
        expect(unreachable).toContain('capable-2');
    });
});
