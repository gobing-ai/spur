import { afterEach, describe, expect, mock, test } from 'bun:test';
import { NodeProcessExecutor, type ProcessOptions, type ProcessResult } from '@gobing-ai/ts-runtime';
import { type AgentRunDeps, AgentService } from '../../src/index';

// D3 (task 1323): executor circuit breaker (R1), adaptive per-node budgets (R2)
// and measured ladder ordering (R3), driven through the real dispatch core.
// Behavior-first: a dead executor first in the ladder must cost the run ZERO
// repeat dispatches, and history-derived budgets must be visible in the trace.

const originalRun = NodeProcessExecutor.prototype.run;
afterEach(() => {
    NodeProcessExecutor.prototype.run = originalRun;
});

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

function usableForAllDeps(): AgentRunDeps {
    const probe = { name: 'pi', installed: true, version: '1.0.0', channels: [], error: null };
    return {
        detector: { detectOne: mock(() => Promise.resolve(probe)) } as unknown as AgentRunDeps['detector'],
        doctorRunner: {
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
        } as unknown as AgentRunDeps['doctorRunner'],
    };
}

/** A ladder with a `pi` executor first and a healthy `codex` executor second (same tier). */
function twoExecutorService(
    latency?: Record<string, { meanMs: number; samples: number; successRate?: number }>,
): AgentService {
    return new AgentService({
        cwd: '/tmp',
        env: {},
        output: { write: () => {}, error: () => {} },
        agentConfig: {
            executors: [
                { name: 'pi-flash', agent: 'pi', tier: 'standard', disabled: false },
                { name: 'codex-main', agent: 'codex', tier: 'standard', disabled: false },
            ],
        },
        ...(latency !== undefined
            ? {
                  historyLatency: async (keys: string[]) => {
                      const out: Record<
                          string,
                          { meanMs: number; p95Ms?: number; samples: number; successRate: number }
                      > = {};
                      for (const key of keys) {
                          const hit = latency[key];
                          if (hit !== undefined)
                              out[key] = {
                                  meanMs: hit.meanMs,
                                  samples: hit.samples,
                                  successRate: hit.successRate ?? 1,
                              };
                      }
                      return out;
                  },
              }
            : {}),
    });
}

function d3Flags(runId: string, extra: Record<string, string | boolean> = {}): Record<string, string | boolean> {
    return { agent: 'pi-flash', stage: 'review', 'run-id': runId, ...extra };
}

describe('1323 AC1 — executor circuit breaker (R1)', () => {
    test('a dead first-choice executor is dispatched once, then the run fails over to the next executor', async () => {
        const seen = stubSpawn(async (options) =>
            options.command === 'pi'
                ? { ...ok(options), exitCode: 2, stderr: 'dispatch result carried no usage' }
                : ok(options, 'backup finished the work'),
        );
        const svc = twoExecutorService();
        const traced = await svc.runTraced('do the stage work', d3Flags('d3-run-1'), usableForAllDeps(), {
            heartbeatMs: 0,
        });
        // Exactly ONE dispatch against the dead executor, then failover — no retries of the dead one.
        const piDispatches = seen.filter((options) => options.command === 'pi');
        expect(piDispatches).toHaveLength(1);
        expect(traced.exitCode).toBe(0);
        expect(traced.invocation?.executor).toBe('codex-main');
        // AC3: the breaker trip and the failover are recorded as ladder decisions.
        const kinds = (traced.ladder ?? []).map((decision) => decision.kind);
        expect(kinds).toContain('breaker-trip');
        expect((traced.ladder ?? []).some((d) => d.kind === 'breaker-trip' && d.executor === 'pi-flash')).toBe(true);
    });

    test('a retry-bound node in the same run performs zero dispatches against the already-dead executor', async () => {
        const seen = stubSpawn(async (options) =>
            options.command === 'pi'
                ? { ...ok(options), exitCode: 2, stderr: 'dispatch result carried no usage' }
                : ok(options, 'backup finished the work'),
        );
        const svc = twoExecutorService();
        // First node: dead executor trips the breaker, run fails over.
        await svc.runTraced('first node', d3Flags('d3-run-2'), usableForAllDeps(), { heartbeatMs: 0 });
        // Second node (retry-bound / next step), same workflow run id: the breaker
        // must skip the dead executor BEFORE resolution — zero new pi dispatches.
        const traced = await svc.runTraced('retry-bound node', d3Flags('d3-run-2'), usableForAllDeps(), {
            heartbeatMs: 0,
        });
        expect(seen.filter((options) => options.command === 'pi')).toHaveLength(1);
        expect(traced.exitCode).toBe(0);
        expect(traced.invocation?.executor).toBe('codex-main');
        expect((traced.ladder ?? []).some((d) => d.kind === 'breaker-skip' && d.executor === 'pi-flash')).toBe(true);
    });

    test('a breaker-exhausted run fails honestly instead of dispatching a dead executor', async () => {
        stubSpawn(async (options) =>
            options.command === 'pi'
                ? { ...ok(options), exitCode: 2, stderr: 'dispatch result carried no usage' }
                : { ...ok(options), exitCode: 2, stderr: 'dispatch result carried no usage' },
        );
        const svc = twoExecutorService();
        await svc.runTraced('first node', d3Flags('d3-run-3'), usableForAllDeps(), { heartbeatMs: 0 });
        // Second node: both executors breaker-dead → honest failure naming the breaker.
        const traced = await svc.runTraced('retry-bound node', d3Flags('d3-run-3'), usableForAllDeps(), {
            heartbeatMs: 0,
        });
        expect(traced.exitCode).toBe(2);
        expect(traced.message ?? '').toContain('circuit breaker');
    });
});

describe('1323 AC2 — adaptive timeout budgets (R2)', () => {
    test('a slow executor with history exceeding the static budget is skipped pre-dispatch', async () => {
        const seen = stubSpawn(async (options) => ok(options, 'fast executor finished'));
        const svc = twoExecutorService({
            'pi-flash': { meanMs: 5000, samples: 12, successRate: 0.95 },
        });
        const traced = await svc.runTraced('stage work', d3Flags('d3-run-4', { timeout: '1000' }), usableForAllDeps(), {
            heartbeatMs: 0,
        });
        // The slow executor never burned its guaranteed timeout: zero pi dispatches.
        expect(seen.filter((options) => options.command === 'pi')).toHaveLength(0);
        expect(traced.exitCode).toBe(0);
        expect(traced.invocation?.executor).toBe('codex-main');
        const skip = (traced.ladder ?? []).find((d) => d.kind === 'timeout-exhausted-skip');
        expect(skip?.executor).toBe('pi-flash');
        // The derived budget is visible in the decision (30s derived — 15s of
        // headroom lifted by the floor — vs 1s static cap).
        expect(skip?.detail).toContain('30000');
        expect(skip?.detail).toContain('1000');
    });

    test('with no alternative executor the node dispatches under the static cap with the derived budget visible', async () => {
        stubSpawn(async (options) => ok(options, 'slow executor got it done anyway'));
        const svc = new AgentService({
            cwd: '/tmp',
            env: {},
            output: { write: () => {}, error: () => {} },
            agentConfig: { executors: [{ name: 'pi-flash', agent: 'pi', tier: 'standard', disabled: false }] },
            historyLatency: async (keys: string[]) => ({
                [keys[0] ?? '']: { meanMs: 5000, samples: 12, successRate: 0.95 },
            }),
        });
        const traced = await svc.runTraced('stage work', d3Flags('d3-run-5', { timeout: '1000' }), usableForAllDeps(), {
            heartbeatMs: 0,
        });
        expect(traced.exitCode).toBe(0);
        const budget = traced.invocation?.timeoutBudget;
        expect(budget?.fits).toBe(false);
        expect(budget?.appliedMs).toBe(1000);
        expect(budget?.derivedMs).toBe(30000);
        expect(budget?.staticMs).toBe(1000);
    });

    test('without history the static budget applies unchanged', async () => {
        stubSpawn(async (options) => ok(options, 'done'));
        const svc = twoExecutorService();
        const traced = await svc.runTraced('stage work', d3Flags('d3-run-6', { timeout: '1000' }), usableForAllDeps(), {
            heartbeatMs: 0,
        });
        expect(traced.exitCode).toBe(0);
        expect(traced.invocation?.timeoutBudget?.source).toBe('static');
        expect(traced.invocation?.timeoutBudget?.appliedMs).toBe(1000);
        expect(traced.invocation?.timeoutBudget?.fits).toBe(true);
    });
});

describe('1323 review finding 1 — escalation walk excludes run-scoped breaker-dead executors', () => {
    /**
     * A capable-1 ladder on the `implement` stage (whose model_policy carries the
     * `timeout` fallback tier): the dispatch pin drives node 1/2 onto DIFFERENT
     * first choices, which is what strands a breaker-dead executor mid-ladder.
     */
    function capableLadderService(executors: Array<{ name: string; agent: 'pi' | 'codex' | 'claude' }>): AgentService {
        return new AgentService({
            cwd: '/tmp',
            env: {},
            output: { write: () => {}, error: () => {} },
            agentConfig: {
                executors: executors.map((executor) => ({
                    name: executor.name,
                    agent: executor.agent,
                    tier: 'capable-1',
                    disabled: false,
                })),
            },
        });
    }

    test('node 2 escalation on a timeout picks the next live executor, never the breaker-dead one', async () => {
        let codexDispatches = 0;
        const seen = stubSpawn(async (options) => {
            if (options.command === 'pi') {
                return { ...ok(options), exitCode: 2, stderr: 'dispatch result carried no usage' };
            }
            if (options.command === 'codex') {
                codexDispatches += 1;
                // Node 1's codex dispatch succeeds; node 2's dies on a NON-unavailability
                // signal (timeout) so only the post-failure escalation walk re-resolves.
                return codexDispatches === 1
                    ? ok(options, 'codex finished node 1')
                    : { ...ok(options), exitCode: null, signal: 'timeout' };
            }
            return ok(options, 'claude finished the work');
        });
        const svc = capableLadderService([
            { name: 'pi-flash', agent: 'pi' },
            { name: 'codex-main', agent: 'codex' },
            { name: 'claude-main', agent: 'claude' },
        ]);
        // Node 1: pi-flash trips the breaker (exit 2, no usage); the run lands on codex-main.
        const first = await svc.runTraced(
            'first node',
            d3Flags('d3-run-7', { stage: 'implement' }),
            usableForAllDeps(),
            { heartbeatMs: 0 },
        );
        expect(first.exitCode).toBe(0);
        expect(first.invocation?.executor).toBe('codex-main');
        // Node 2: pinned to codex-main on the SAME run id — pi-flash now sits mid-ladder.
        // codex-main times out (no breaker trip), so the escalation walk re-resolves.
        const traced = await svc.runTraced(
            'second node',
            d3Flags('d3-run-7', { agent: 'codex-main', stage: 'implement' }),
            usableForAllDeps(),
            { heartbeatMs: 0 },
        );
        // The breaker-dead executor received ZERO further dispatches: the only pi
        // dispatch in the whole run is node 1's trip.
        expect(seen.filter((options) => options.command === 'pi')).toHaveLength(1);
        // The walk failed over to the next LIVE executor and finished the node.
        expect(traced.exitCode).toBe(0);
        expect(traced.invocation?.executor).toBe('claude-main');
        expect((traced.ladder ?? []).some((d) => d.kind === 'escalation' && d.toExecutor === 'claude-main')).toBe(true);
    });

    test('node 2 escalation with every ladder candidate dead records chain-exhausted, never a dead re-dispatch', async () => {
        let codexDispatches = 0;
        const seen = stubSpawn(async (options) => {
            if (options.command === 'pi') {
                return { ...ok(options), exitCode: 2, stderr: 'dispatch result carried no usage' };
            }
            codexDispatches += 1;
            // Node 1's codex dispatch succeeds; node 2's dies on a NON-unavailability
            // signal (timeout) so only the post-failure escalation walk re-resolves.
            return codexDispatches === 1
                ? ok(options, 'codex finished node 1')
                : { ...ok(options), exitCode: null, signal: 'timeout' };
        });
        const svc = capableLadderService([
            { name: 'pi-flash', agent: 'pi' },
            { name: 'codex-main', agent: 'codex' },
        ]);
        // Node 1: pi-flash trips the breaker; codex-main finishes the node.
        const first = await svc.runTraced(
            'first node',
            d3Flags('d3-run-8', { stage: 'implement' }),
            usableForAllDeps(),
            { heartbeatMs: 0 },
        );
        expect(first.exitCode).toBe(0);
        expect(first.invocation?.executor).toBe('codex-main');
        // Node 2: codex-main times out (non-unavailability). pi-flash is breaker-dead and
        // codex-main is already attempted — the ladder minus both is empty, so the walk
        // must report honest exhaustion instead of re-dispatching the dead executor.
        const traced = await svc.runTraced(
            'second node',
            d3Flags('d3-run-8', { agent: 'codex-main', stage: 'implement' }),
            usableForAllDeps(),
            { heartbeatMs: 0 },
        );
        expect(seen.filter((options) => options.command === 'pi')).toHaveLength(1);
        expect(traced.exitCode).toBe(3);
        expect((traced.ladder ?? []).some((d) => d.kind === 'chain-exhausted' && d.executor === 'codex-main')).toBe(
            true,
        );
        expect((traced.ladder ?? []).some((d) => d.kind === 'escalation' && d.toExecutor === 'pi-flash')).toBe(false);
    });
});
