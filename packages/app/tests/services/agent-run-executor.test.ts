import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { TurnOutcome } from '@gobing-ai/ts-ai-runner';
import { NodeProcessExecutor, type ProcessOptions, type ProcessResult } from '@gobing-ai/ts-runtime';
import { type AgentExecutionEvent, type AgentRunDeps, AgentService } from '../../src/index';
import {
    PidObservingProcessExecutor,
    RolePropagatingProcessExecutor,
    TURN_OUTCOME_UNKNOWN_SIGNAL,
} from '../../src/services/agent-run-executor';

// AgentRunExecutor (the `spur agent run` dispatch core) and the two process executors it dispatches
// through. The executor tests run real (tiny) subprocesses: the behaviour under test is the spawn
// hook and the child env.

const buffered = { output: { mode: 'buffered' as const } };

describe('PidObservingProcessExecutor', () => {
    test('publishes the spawned pid and still runs the caller onSpawn', async () => {
        const published: number[] = [];
        const callerSeen: number[] = [];
        const executor = new PidObservingProcessExecutor(buffered, (pid) => published.push(pid));
        const result = await executor.run({
            command: 'sh',
            args: ['-c', 'exit 0'],
            onSpawn: (pid) => callerSeen.push(pid),
        });
        expect(result.exitCode).toBe(0);
        expect(published).toHaveLength(1);
        expect(published[0]).toBeGreaterThan(0);
        expect(callerSeen).toEqual(published);
    });
});

describe('RolePropagatingProcessExecutor', () => {
    const printEnv = { command: 'sh', args: ['-c', 'printf "%s|%s" "$SPUR_ROLE" "$SPUR_SPEC_ID"'] };

    test('stamps SPUR_ROLE and SPUR_SPEC_ID into the child env, keeping caller env', async () => {
        const executor = new RolePropagatingProcessExecutor(buffered, () => {});
        executor.setRoleEnv('reviewer');
        executor.setSpecIdEnv('member-7');
        const result = await executor.run({
            command: 'sh',
            args: ['-c', 'printf "%s|%s|%s" "$SPUR_ROLE" "$SPUR_SPEC_ID" "$KEEP_ME"'],
            env: { KEEP_ME: 'kept', SPUR_ROLE: 'stale-parent-role' },
        });
        expect(result.stdout).toBe('reviewer|member-7|kept');
    });

    test('an undefined role/spec id strips a stale parent value to empty', async () => {
        const executor = new RolePropagatingProcessExecutor(buffered, () => {});
        executor.setRoleEnv('coder');
        executor.setRoleEnv(undefined);
        executor.setSpecIdEnv(undefined);
        const result = await executor.run({ ...printEnv, env: { SPUR_ROLE: 'parent', SPUR_SPEC_ID: 'parent' } });
        expect(result.stdout).toBe('|');
    });
});

// ---------------------------------------------------------------------------
// AgentRunExecutor wiring through the real AiRunner → dispatch executor chain.
// Only the bottom NodeProcessExecutor.run is stubbed, so the pid/role executors
// and every closure executeRun hands them run for real.
// ---------------------------------------------------------------------------

const originalRun = NodeProcessExecutor.prototype.run;
afterEach(() => {
    NodeProcessExecutor.prototype.run = originalRun;
});

function resolutionDeps(): AgentRunDeps {
    const probe = { name: 'pi', installed: true, version: '1.0.0', channels: [], error: null };
    return {
        detector: { detectOne: mock(() => Promise.resolve(probe)) } as unknown as AgentRunDeps['detector'],
        doctorRunner: {
            runOne: mock(() =>
                Promise.resolve({
                    agent: 'pi',
                    installed: true,
                    version: '1.0.0',
                    authenticated: 'authenticated',
                    usable: true,
                    tier: 1,
                    channels: [],
                    error: null,
                }),
            ),
        } as unknown as AgentRunDeps['doctorRunner'],
    };
}

function stubSpawn(behave: (options: ProcessOptions) => Promise<ProcessResult>): ProcessOptions[] {
    const seen: ProcessOptions[] = [];
    NodeProcessExecutor.prototype.run = async (options: ProcessOptions) => {
        seen.push(options);
        return behave(options);
    };
    return seen;
}

function ok(options: ProcessOptions, stdout = ''): ProcessResult {
    return { command: options.command, args: options.args ?? [], exitCode: 0, stdout, stderr: '', durationMs: 1 };
}

describe('AgentRunExecutor dispatch wiring', () => {
    test('the spawned pid and streamed output reach the execution observer', async () => {
        const seen = stubSpawn(async (options) => {
            options.onSpawn?.(4242);
            options.onOutput?.({ stream: 'stdout', chunk: 'hello from child\n', timestamp: new Date().toISOString() });
            return ok(options, 'hello from child\n');
        });
        const events: AgentExecutionEvent[] = [];
        const svc = new AgentService({ cwd: '/tmp', env: {}, output: { write: () => {}, error: () => {} } });
        const traced = await svc.runTraced('work', { agent: 'pi' }, resolutionDeps(), {
            observer: (event) => events.push(event),
            heartbeatMs: 0,
        });
        expect(traced.exitCode).toBe(0);
        expect(seen).toHaveLength(1);
        // SPUR_ROLE / SPUR_SPEC_ID are always stamped (stripped to '' with no role / spec id).
        expect(seen[0]?.env?.SPUR_ROLE).toBe('');
        expect(seen[0]?.env?.SPUR_SPEC_ID).toBe('');
        const output = events.find((event) => event.kind === 'output');
        expect(output?.kind === 'output' ? output.chunk : '').toContain('hello from child');
        const finished = events.find((event) => event.kind === 'finished');
        expect(finished?.outcome).toBe('done');
        expect((finished as { pid?: number } | undefined)?.pid).toBe(4242);
    });

    test('an external abort mid-dispatch cancels the run', async () => {
        const external = new AbortController();
        const seen = stubSpawn(async (options) => {
            external.abort();
            expect(options.signal?.aborted).toBe(true);
            throw new Error('aborted');
        });
        const events: AgentExecutionEvent[] = [];
        const svc = new AgentService({ cwd: '/tmp', env: {}, output: { write: () => {}, error: () => {} } });
        const traced = await svc.runTraced('work', { agent: 'pi' }, resolutionDeps(), {
            signal: external.signal,
            observer: (event) => events.push(event),
            heartbeatMs: 0,
        });
        expect(seen).toHaveLength(1);
        expect(traced.exitCode).toBe(2);
        expect(events.find((event) => event.kind === 'finished')?.outcome).toBe('cancelled');
    });

    test('1275 R5: a named fallback spawns the one-shot path exactly once', async () => {
        const seen = stubSpawn(async (options) => ok(options, 'one-shot work'));
        const svc = new AgentService({ cwd: '/tmp', env: {}, output: { write: () => {}, error: () => {} } });
        let dispatches = 0;
        const traced = await svc.runTraced('work', { agent: 'pi' }, resolutionDeps(), {
            dispatchTurn: async () => {
                dispatches++;
                return { kind: 'fallback', reason: 'unsupported-agent' } as const;
            },
            heartbeatMs: 0,
        });
        expect(traced.exitCode).toBe(0);
        expect(dispatches).toBe(1);
        // The fallback continued on today's path — exactly one fresh spawn, no warm shortcut.
        expect(seen).toHaveLength(1);
    });

    test('1275 R1: a warm outcome decides the process outcome without spawning', async () => {
        const seen = stubSpawn(async () => {
            throw new Error('a warm terminal must never spawn a fresh process');
        });
        const svc = new AgentService({ cwd: '/tmp', env: {}, output: { write: () => {}, error: () => {} } });
        const warm: TurnOutcome = {
            kind: 'success',
            turnId: 'turn-1',
            correlation: { runId: 'run-1', executionId: 'exec-1', requestId: 'req-1', attempt: 1 },
            startedAt: new Date().toISOString(),
            terminalAt: new Date().toISOString(),
            finalText: 'done',
        };
        const traced = await svc.runTraced('work', { agent: 'pi' }, resolutionDeps(), {
            dispatchTurn: async (context) => {
                // Warm stdout streams through the same lifecycle observer as a spawn.
                context.onOutput?.('warm stdout chunk\n');
                return { kind: 'warm', outcome: warm };
            },
            heartbeatMs: 0,
        });
        // Native success maps to exit 0; the action contract above stays the sole success authority.
        expect(traced.exitCode).toBe(0);
        expect(seen).toHaveLength(0);
    });

    test('1275 R4: a warm outcome-unknown stays uncertain — exit 3 with the reconcile marker, never a respawn', async () => {
        const seen = stubSpawn(async () => {
            throw new Error('an uncertain turn must never respawn');
        });
        const svc = new AgentService({ cwd: '/tmp', env: {}, output: { write: () => {}, error: () => {} } });
        const unknown: TurnOutcome = {
            kind: 'outcome-unknown',
            turnId: 'turn-2',
            correlation: { runId: 'run-1', executionId: 'exec-1', requestId: 'req-1', attempt: 1 },
            reason: 'child died after acceptance',
            startedAt: new Date().toISOString(),
            terminalAt: new Date().toISOString(),
        };
        const traced = await svc.runTraced('work', { agent: 'pi' }, resolutionDeps(), {
            dispatchTurn: async () => ({ kind: 'warm', outcome: unknown }),
            heartbeatMs: 0,
        });
        // No retry: the work is uncertain, not failed (R4). The marker is what tells the two apart.
        expect(seen).toHaveLength(0);
        expect(traced.exitCode).toBe(3);
        expect(traced.signal).toBe(TURN_OUTCOME_UNKNOWN_SIGNAL);
    });
});
