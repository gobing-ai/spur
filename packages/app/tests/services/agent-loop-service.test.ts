/**
 * Task 0968 — the self-draining agent loop as an application service (feature G67 R1/R2).
 * The CLI behavior lock lives in `apps/cli/tests/commands/agent-loop-*.test.ts`; these tests
 * drive the service directly (no `CliContext`, no spawned CLI) so the moved mechanics are
 * unit-covered: the wake wait, the idle-hold dedupe, the not-accepted persistent send, and
 * ownership loss.
 */
import { describe, expect, test, vi } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InboxClaim } from '@gobing-ai/spur-domain';
import {
    CoordinationRunDao,
    createMigratedDb,
    type DbAdapter,
    ProjectClaimDao,
    SystemEventDao,
} from '@gobing-ai/spur-domain';
import { type AgentName, AiRunner } from '@gobing-ai/ts-ai-runner';
import { createFakeTurnSessionDriver } from '@gobing-ai/ts-ai-runner/testing';
import { EventBus } from '@gobing-ai/ts-infra';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import type { AgentLoopDeps } from '../../src/services/agent-loop-service';
import {
    createWriteSlotHeartbeat,
    ORCHESTRATOR_REPLY_INSTRUCTION,
    recordIdleHold,
    runAgentLoopCore,
    waitForWake,
} from '../../src/services/agent-loop-service';
import type { FleetService } from '../../src/services/fleet-service';
import { normalizeProjectPath } from '../../src/services/project-registry';
import type { StrategyRuntime } from '../../src/services/strategy-runtime';
import { writeFleetWorkItem } from '../../src/workflow/fleet-work-item';

async function memDb(): Promise<DbAdapter> {
    return createMigratedDb({ url: ':memory:' });
}

/** Insert one ledger row and return it. */
async function emit(db: DbAdapter, eventName: string, actor = 'human'): Promise<void> {
    await new SystemEventDao(db).insert({
        id: crypto.randomUUID(),
        event_name: eventName,
        occurred_at: new Date().toISOString(),
        actor,
        payload_json: JSON.stringify({ eventName }),
    });
}

describe('0968 waitForWake', () => {
    test('returns on the first wake event after consuming non-wake rows, and never replays', async () => {
        const db = await memDb();
        const dao = new SystemEventDao(db);
        await emit(db, 'agent.invoke.start'); // non-wake: consumed, cursor advances past it
        await emit(db, 'message.sent'); // wake
        await emit(db, 'agent.invoke.exit'); // after the wake: must NOT be consumed

        const result = await waitForWake(dao, 0, 5000);
        expect(result.source).toBe('message.sent');
        // The wake row and the row before it are behind the returned cursor; the row after is not.
        const remaining = await dao.follow(result.sequence, 512);
        expect(remaining.map((r) => r.event_name)).toEqual(['agent.invoke.exit']);
    });

    test('falls back to backstop-timeout at the deadline', async () => {
        const db = await memDb();
        const result = await waitForWake(new SystemEventDao(db), 0, 30);
        expect(result.source).toBe('backstop-timeout');
    });

    test('falls back to backstop-timeout when the signal is already aborted', async () => {
        const db = await memDb();
        const result = await waitForWake(new SystemEventDao(db), 0, 5000, AbortSignal.abort());
        expect(result.source).toBe('backstop-timeout');
    });
});

describe('0968 idle hold', () => {
    test('writes one row per distinct hold key and resets after a non-empty drain', async () => {
        const db = await memDb();
        const makes = [0];
        const deps = {
            cwd: '/tmp/does-not-matter',
            getDb: async () => db,
            makeStrategyRuntime: async () =>
                ({
                    selectNext: async () => ({ holds: [{ wbs: '0001', reason: 'blocked' }] }),
                }) as unknown as StrategyRuntime,
        } as unknown as AgentLoopDeps;
        const dao = new SystemEventDao(db);

        const first = await recordIdleHold(deps, 'member-1', 'backstop-timeout', '');
        const second = await recordIdleHold(deps, 'member-1', 'backstop-timeout', first);
        expect(second).toBe(first); // same key: no new row
        // The loop resets the key after a non-empty drain (lastHoldKey = '').
        await recordIdleHold(deps, 'member-1', 'backstop-timeout', '');
        const rows = await dao.query({ names: ['fleet.idle-hold'] });
        expect(rows.length).toBe(2);
        expect(makes[0]).toBe(0);
    });
});

/** Minimal member-mode loop deps: no orchestrator declaration, one spec, scripted drain. */
function memberDeps(db: DbAdapter, overrides: Partial<AgentLoopDeps>): AgentLoopDeps {
    const settled: Array<{ outcome: string }> = [];
    const base = {
        cwd: '/tmp/does-not-matter',
        getDb: async () => db,
        write: () => {},
        error: () => {},
        agentService: () =>
            ({ run: async () => 0, runTraced: async () => ({}) }) as unknown as ReturnType<
                AgentLoopDeps['agentService']
            >,
        fleet: {
            load: async () => null,
            resolveOrchestrator: async () => null,
            assertLaunchGroundTruth: async () => {},
        } as unknown as FleetService,
        makeStrategyRuntime: async () =>
            ({
                selectNext: async () => ({ holds: [] }),
                observe: async () => ({ released: [] }),
                tick: async () => ({ dispatched: [], holds: [] }),
                resume: async () => {},
                stop: () => {},
            }) as unknown as StrategyRuntime,
        listAgentSpecs: async () => [{ id: 'member-1' }],
        reconciler: { reconcile: async () => ({ unresolved: [], exhausted: [], scanned: 0 }) },
        drain: async () => ({ prompt: 'do work', flags: {}, claimed: [{ id: 'm1', attempts: 1 }] }),
        settle: async (_claimed: InboxClaim[], outcome: 'accepted' | 'not-started') => {
            settled.push({ outcome });
        },
        attachLedger: async () => ({ flush: async () => {}, unsubscribe: () => {} }),
        memberSession: {
            executors: [{ name: 'e1', agent: 'pi' }],
            env: {},
            getDb: async () => db,
            warn: () => {},
            // A persistent process whose stdin send is REFUSED (0831 not-accepted).
            processFactory: () => ({ send: async () => ({ ok: false }), stop: async () => {} }),
            sessionCapability: () => ({ mode: 'persistent', supportsSessionDir: false }) as never,
        },
        ...overrides,
    };
    return { ...base, __settled: settled } as unknown as AgentLoopDeps & { __settled: unknown };
}

describe('0968 runAgentLoopCore', () => {
    test('a not-accepted persistent send settles the claimed rows not-started', async () => {
        const db = await memDb();
        const deps = memberDeps(db, {});
        const code = await runAgentLoopCore(deps, {
            recipient: 'member-1',
            pollMs: 10,
            flags: {},
            runtime: { maxIterations: 1 },
        });
        expect(code).toBe(0);
        const settled = (deps as unknown as { __settled: Array<{ outcome: string }> }).__settled;
        expect(settled).toEqual([{ outcome: 'not-started' }]);
    });

    test('a refused orchestrator claim exits 2 and never starts the loop', async () => {
        const db = await memDb();
        const cwd = mkdtempSync(join(tmpdir(), 'loop-claim-'));
        // A live claim held by another instance makes this recipient's claim fail.
        await new ProjectClaimDao(db).claim(normalizeProjectPath(cwd), 'orchestrator', 'other-1', 60_000);
        const deps = memberDeps(db, {
            cwd,
            fleet: {
                load: async () => ({}),
                resolveOrchestrator: async () => ({ instanceId: 'orch-1' }),
                assertLaunchGroundTruth: async () => {},
            } as unknown as FleetService,
            makeStrategyRuntime: async () =>
                ({ selectNext: async () => ({ holds: [] }), resume: async () => {} }) as unknown as StrategyRuntime,
        });
        const code = await runAgentLoopCore(deps, { recipient: 'orch-1', pollMs: 10, flags: {}, runtime: {} });
        expect(code).toBe(2);
    });

    test('a heartbeat that loses ownership mid-loop exits 2 and releases the claim', async () => {
        const db = await memDb();
        const cwd = mkdtempSync(join(tmpdir(), 'loop-lost-'));
        const proto = ProjectClaimDao.prototype;
        const { heartbeat, release } = proto;
        const realSetInterval = globalThis.setInterval;
        const released: number[] = [];
        // Another owner took the claim: every renewal is refused. The renewal timer
        // fires every millisecond instead of every CLAIM_TTL_MS / 3.
        proto.heartbeat = async () => false;
        proto.release = async function (this: ProjectClaimDao, ...args: Parameters<typeof release>) {
            released.push(args[3]);
            return release.apply(this, args);
        };
        globalThis.setInterval = ((fn: () => void) => realSetInterval(fn, 1)) as typeof setInterval;
        try {
            const deps = memberDeps(db, {
                cwd,
                fleet: {
                    load: async () => ({}),
                    resolveOrchestrator: async () => ({ instanceId: 'orch-1' }),
                    assertLaunchGroundTruth: async () => {},
                } as unknown as FleetService,
                makeStrategyRuntime: async () =>
                    ({
                        observe: async () => ({ released: [] }),
                        tick: async () => ({ dispatched: [], holds: [] }),
                        resume: async () => {},
                        stop: () => {},
                    }) as unknown as StrategyRuntime,
            });
            const code = await runAgentLoopCore(deps, {
                recipient: 'orch-1',
                pollMs: 10,
                flags: {},
                runtime: { maxIterations: 1_000 },
            });
            expect(code).toBe(2);
            expect(released.length).toBe(1);
        } finally {
            proto.heartbeat = heartbeat;
            proto.release = release;
            globalThis.setInterval = realSetInterval;
        }
    });
});

describe('G71 R1/R2/R3 — member drain, keyed run path, slot heartbeat, resume seeding', () => {
    /** Minimal live member process (G66 R2 shape) with a scripted stdin outcome. */
    function fakeProcess(send: (message: string) => Promise<{ ok: boolean }>) {
        return {
            start: async () => {},
            stop: async () => {},
            send,
            getStatus: () => 'running' as const,
            getExitCode: () => null,
        };
    }

    /** A fleet member that is NOT the orchestrator: `owner` is null, so it must drain. */
    function memberOnlyDeps(db: DbAdapter, overrides: Record<string, unknown> = {}): AgentLoopDeps {
        return memberDeps(db, {
            fleet: {
                load: async () => ({ enabled: true }),
                resolveOrchestrator: async () => null,
                assertLaunchGroundTruth: async () => {},
            } as unknown as FleetService,
            ...overrides,
        });
    }

    test('R1: a fleet member drains its inbox and settles the run instead of only holding', async () => {
        const db = await memDb();
        const accepted: string[] = [];
        const deps = memberOnlyDeps(db, {
            // The bus the loop builds is handed to `agentService`; emitting the runner's own
            // `agent.invoke.start` is what marks the invocation accepted (0831).
            agentService: (bus: { emit: (name: string, payload: unknown) => void }) => ({
                run: async () => {
                    bus.emit('agent.invoke.start', { operation: 'prompt' });
                    return 0;
                },
                runTraced: async () => ({}),
            }),
            settle: async (claimed: InboxClaim[], outcome: string) => {
                accepted.push(`${claimed.map((claim) => claim.id).join(',')}:${outcome}`);
            },
            memberSession: {
                executors: [{ name: 'e1', agent: 'pi' }],
                env: {},
                getDb: async () => db,
                warn: () => {},
                // stdin accepted → the drain is a delivery
                processFactory: () => fakeProcess(async () => ({ ok: true })),
                sessionCapability: () => ({ mode: 'persistent', supportsSessionDir: false }) as never,
            },
        });
        const code = await runAgentLoopCore(deps, {
            recipient: 'member-1',
            pollMs: 10,
            flags: {},
            runtime: { maxIterations: 1 },
        });
        expect(code).toBe(0);
        // The claimed row settled as delivered, and no idle hold was written for a skipped inbox.
        expect(accepted).toEqual(['m1:accepted']);
        const holds = await new SystemEventDao(db).query({ names: ['fleet.idle-hold'] });
        expect(holds).toHaveLength(0);
    });

    test.each(['fleet:task:0841:1', 'run-1/work'])(
        'R1: keyed batch %s produces a receipt even for a persistent member',
        async (requestKey) => {
            const db = await memDb();
            const sent: string[] = [];
            const runs: string[] = [];
            const deps = memberOnlyDeps(db, {
                listAgentSpecs: async () => [
                    { id: 'member-1', type: 'pi', executor: 'e1', config: {}, purpose: 'coder', workspace: '/tmp' },
                ],
                agentService: () => ({
                    run: async (prompt: string) => {
                        runs.push(prompt);
                        return 0;
                    },
                    runTraced: async () => ({}),
                }),
                drain: async () => ({
                    prompt: 'dispatch: run the task',
                    flags: {},
                    claimed: [{ id: 'm-keyed', attempts: 1 }],
                    requestKeys: [requestKey],
                }),
                memberSession: {
                    executors: [{ name: 'e1', agent: 'pi' }],
                    env: {},
                    getDb: async () => db,
                    warn: () => {},
                    // A persistent member whose stdin WOULD accept — the keyed batch must not use it.
                    processFactory: () =>
                        fakeProcess(async (text: string) => {
                            sent.push(text);
                            return { ok: true };
                        }),
                    sessionCapability: () => ({ supportsPersistentStdin: true, supportsResumeById: false }) as never,
                },
            });
            await runAgentLoopCore(deps, {
                recipient: 'member-1',
                pollMs: 10,
                flags: {},
                runtime: { maxIterations: 1 },
            });
            expect(runs).toEqual(['dispatch: run the task']);
            expect(sent).toEqual([]);
        },
    );

    test('1275 R1: a keyed drain threads the warm dispatcher — an unregistered agent falls back by name', async () => {
        const db = await memDb();
        const cwd = mkdtempSync(join(tmpdir(), 'loop-warm-'));
        await writeFleetWorkItem(cwd, 'run-1', 'work', { role: 'coder', input: 'Implement the task' }, {});
        const deps = memberOnlyDeps(db, {
            cwd,
            listAgentSpecs: async () => [
                { id: 'member-1', type: 'gemini', executor: 'e1', config: {}, purpose: 'coder', workspace: '/tmp' },
            ],
            agentService: () => ({
                run: async () => 0,
                // Minimal stand-in for the real executor branch (covered directly in
                // agent-run-executor tests): consult the threaded dispatcher, then run one-shot.
                runTraced: async (
                    _input: string,
                    _flags: unknown,
                    deps: { dispatchTurn?: (context: unknown) => Promise<{ kind: string }> },
                ) => {
                    if (deps?.dispatchTurn !== undefined) {
                        await deps.dispatchTurn({
                            agent: 'gemini',
                            prompt: 'Implement the task',
                            cwd,
                            role: 'coder',
                            correlation: {
                                runId: 'run-loop',
                                executionId: 'exec-loop',
                                requestId: 'msg-m-warm',
                                attempt: 1,
                            },
                        });
                    }
                    return {
                        exitCode: 0,
                        stdout: 'ok',
                        invocation: {
                            agent: 'gemini',
                            source: 'default',
                            command: 'gemini',
                            argv: [],
                            cwd,
                            mode: 'text',
                            outputMode: 'buffered',
                            continue: false,
                            stdinInteractive: false,
                        },
                    };
                },
            }),
            // A real runner with no registered Gemini driver: openTurnSession
            // must refuse unsupported-agent and the keyed run must still complete one-shot.
            runDeps: { runner: new AiRunner({ processExecutor: new NodeProcessExecutor() }) } as never,
            drain: async () => ({
                prompt: 'dispatch: run the task',
                flags: {},
                claimed: [{ id: 'm-warm', attempts: 1 }],
                requestKeys: ['run-1/work'],
            }),
            memberSession: {
                executors: [{ name: 'e1', agent: 'gemini' }],
                env: {},
                getDb: async () => db,
                warn: () => {},
                processFactory: () =>
                    fakeProcess(async () => {
                        throw new Error('the keyed run must never touch the persistent stdin');
                    }),
                sessionCapability: () => ({ supportsPersistentStdin: true, supportsResumeById: false }) as never,
            },
        });
        const code = await runAgentLoopCore(deps, {
            recipient: 'member-1',
            pollMs: 10,
            flags: {},
            runtime: { maxIterations: 1 },
        });
        expect(code).toBe(0);
        // The work-item result carries the turn receipt: the warm path refused by NAME and the
        // one-shot fallback completed the run — never an unnamed silent degrade.
        const result = JSON.parse(readFileSync(join(cwd, '.spur/run/run-1/prompts/work.result.json'), 'utf8')) as {
            data?: { turn?: Record<string, unknown> };
        };
        expect(result.data?.turn).toMatchObject({ mode: 'one-shot', fallbackReason: 'unsupported-agent' });
    });

    test('1283: a keyed task drain with no work item still threads the warm dispatcher and records turn-settled', async () => {
        const db = await memDb();
        const cwd = mkdtempSync(join(tmpdir(), 'loop-warm-task-'));
        const settled: Record<string, unknown>[] = [];
        const deps = memberOnlyDeps(db, {
            cwd,
            listAgentSpecs: async () => [
                { id: 'member-1', type: 'gemini', executor: 'e1', config: {}, purpose: 'coder', workspace: '/tmp' },
            ],
            agentService: (bus: Parameters<AgentLoopDeps['agentService']>[0]) => {
                bus.on('fleet.phase.turn-settled', (payload) => {
                    settled.push(payload as Record<string, unknown>);
                });
                return {
                    // The plain path: no work-item file, so the drain runs `svc.run` — which must
                    // still receive the per-drain dispatcher (before 1283 it never did).
                    run: async (
                        _input: string,
                        flags: Record<string, unknown>,
                        runDeps?: { dispatchTurn?: (context: unknown) => Promise<{ kind: string }> },
                    ) => {
                        expect(runDeps?.dispatchTurn).toBeDefined();
                        await runDeps?.dispatchTurn?.({
                            agent: 'gemini',
                            prompt: 'run the task',
                            cwd,
                            role: 'coder',
                            correlation: {
                                runId: String(flags['run-id']),
                                executionId: String(flags['execution-id']),
                                requestId: String(flags['run-id']),
                                attempt: 1,
                            },
                        });
                        return 0;
                    },
                    runTraced: async () => ({}),
                };
            },
            runDeps: { runner: new AiRunner({ processExecutor: new NodeProcessExecutor() }) } as never,
            drain: async () => ({
                prompt: 'dispatch: run the task',
                flags: {},
                claimed: [{ id: 'm-task', attempts: 1 }],
                requestKeys: ['0001'],
            }),
            memberSession: {
                executors: [{ name: 'e1', agent: 'gemini' }],
                env: {},
                getDb: async () => db,
                warn: () => {},
                processFactory: () =>
                    fakeProcess(async () => {
                        throw new Error('the keyed run must never touch the persistent stdin');
                    }),
                sessionCapability: () => ({ supportsPersistentStdin: true, supportsResumeById: false }) as never,
            },
        });
        const code = await runAgentLoopCore(deps, {
            recipient: 'member-1',
            pollMs: 10,
            flags: {},
            runtime: { maxIterations: 1 },
        });
        expect(code).toBe(0);
        expect(settled).toHaveLength(1);
        expect(settled[0]?.runId).toEqual(expect.any(String));
        expect(settled[0]?.turn).toMatchObject({ mode: 'one-shot', fallbackReason: 'unsupported-agent' });
    });

    test('1283: a warm plain task turn settles accepted — never released for a replaying redelivery', async () => {
        const db = await memDb();
        const cwd = mkdtempSync(join(tmpdir(), 'loop-warm-accept-'));
        const outcomes: string[] = [];
        const settled: Record<string, unknown>[] = [];
        const real = new AiRunner({ processExecutor: new NodeProcessExecutor() });
        const driver = createFakeTurnSessionDriver(
            [{ op: 'accept' }, { op: 'terminal', kind: 'success', finalText: 'ok' }],
            { qualify: () => ({ qualified: true }) },
        );
        const deps = memberOnlyDeps(db, {
            cwd,
            listAgentSpecs: async () => [
                { id: 'member-1', type: 'pi', executor: 'e1', config: {}, purpose: 'coder', workspace: '/tmp' },
            ],
            agentService: (bus: Parameters<AgentLoopDeps['agentService']>[0]) => {
                bus.on('fleet.phase.turn-settled', (payload) => {
                    settled.push(payload as Record<string, unknown>);
                });
                return {
                    // Emits no `agent.invoke.start`: a warm turn spawns nothing.
                    run: async (
                        _input: string,
                        flags: Record<string, unknown>,
                        runDeps?: { dispatchTurn?: (context: unknown) => Promise<{ kind: string }> },
                    ) => {
                        const dispatched = await runDeps?.dispatchTurn?.({
                            agent: 'pi',
                            prompt: 'run the task',
                            cwd,
                            role: 'coder',
                            correlation: {
                                runId: String(flags['run-id']),
                                executionId: String(flags['execution-id']),
                                requestId: String(flags['run-id']),
                                attempt: 0,
                            },
                        });
                        return dispatched?.kind === 'warm' ? 0 : 3;
                    },
                    runTraced: async () => ({}),
                };
            },
            drain: async () => ({
                prompt: 'dispatch: run the task',
                flags: {},
                claimed: [{ id: 'm-task', attempts: 1 }],
                requestKeys: ['0001'],
            }),
            settle: async (_claimed: InboxClaim[], outcome: string) => {
                outcomes.push(outcome);
            },
            memberSession: {
                executors: [{ name: 'e1', agent: 'pi' }],
                env: {},
                getDb: async () => db,
                warn: () => {},
                processFactory: () =>
                    fakeProcess(async () => {
                        throw new Error('the keyed run must never touch the persistent stdin');
                    }),
                sessionCapability: () => ({ supportsPersistentStdin: true, supportsResumeById: false }) as never,
            },
        });
        const code = await runAgentLoopCore(deps, {
            recipient: 'member-1',
            pollMs: 10,
            flags: {},
            runtime: { maxIterations: 1 },
            runDeps: {
                runner: {
                    openTurnSession: (agent: AgentName, options: { policy: never }) =>
                        real.openTurnSession(agent, {
                            ...options,
                            driver,
                            binary: { path: '/fake/bin/pi', version: '9.9.9-fake' },
                            handshakeTimeoutMs: 2_000,
                        }),
                },
            } as never,
        });
        expect(code).toBe(0);
        expect(settled[0]?.turn).toMatchObject({ mode: 'warm', nativeOutcome: 'success' });
        expect(outcomes).toEqual(['accepted']);
    });

    test('R1: an unkeyed conversational batch claims and renews no write slot', async () => {
        const db = await memDb();
        const cwd = mkdtempSync(join(tmpdir(), 'loop-unkeyed-'));
        const project = normalizeProjectPath(cwd);
        await new ProjectClaimDao(db).claim(project, 'write', 'member-1', 30_000, 1);
        const before = await new ProjectClaimDao(db).get(project, 'write');
        const runs: string[] = [];
        const deps = memberOnlyDeps(db, {
            cwd,
            agentService: () => ({
                run: async (prompt: string) => {
                    runs.push(prompt);
                    return 0;
                },
                runTraced: async () => ({}),
            }),
            drain: async () => ({
                prompt: 'hello there',
                flags: {},
                claimed: [{ id: 'm-chat', attempts: 1 }],
                requestKeys: [null],
            }),
        });
        await runAgentLoopCore(deps, { recipient: 'member-1', pollMs: 10, flags: {}, runtime: { maxIterations: 1 } });
        // It ran (one-shot falls through to the run path) …
        expect(runs).toEqual(['hello there']);
        // … and it neither claimed nor renewed the slot: only a `fleet:task:*` key does (R2).
        const after = await new ProjectClaimDao(db).get(project, 'write');
        expect(after?.expiresAt).toBe(before?.expiresAt);
    });

    test('R2: the member heartbeat renews the held slot and stops when it is fenced out', async () => {
        const db = await memDb();
        const cwd = mkdtempSync(join(tmpdir(), 'loop-slot-'));
        const project = normalizeProjectPath(cwd);
        const dao = new ProjectClaimDao(db);
        await dao.claim(project, 'write', 'member-1', 30_000, 1);
        const before = await dao.get(project, 'write');
        vi.useFakeTimers();
        try {
            const stop = createWriteSlotHeartbeat({
                projectPath: project,
                recipient: 'member-1',
                getDb: async () => db,
            });
            try {
                for (let i = 0; i < 3; i++) {
                    vi.advanceTimersByTime(10_000);
                    for (let j = 0; j < 30; j++) await Promise.resolve();
                }
            } finally {
                stop();
            }
            const after = await dao.get(project, 'write');
            expect(after?.expiresAt ?? 0).toBeGreaterThan(before?.expiresAt ?? 0);
            // A different holder is not this member's slot to renew: it stops instead of fighting.
            await dao.release(project, 'write', 'member-1', before?.ownerEpoch ?? 1);
            await dao.claim(project, 'write', 'other-1', 30_000, 1);
            const stop2 = createWriteSlotHeartbeat({
                projectPath: project,
                recipient: 'member-1',
                getDb: async () => db,
            });
            const otherBefore = await dao.get(project, 'write');
            try {
                vi.advanceTimersByTime(30_000);
                for (let j = 0; j < 30; j++) await Promise.resolve();
            } finally {
                stop2();
            }
            const otherAfter = await dao.get(project, 'write');
            expect(otherAfter?.expiresAt).toBe(otherBefore?.expiresAt);
        } finally {
            vi.useRealTimers();
        }
    });

    test('R2: a run orphaned by an ungraceful death is finalized at loop start, before the first drain', async () => {
        const db = await memDb();
        const runs = new CoordinationRunDao(db);
        await runs.insertStart({
            specId: 'member-1',
            agentKind: 'claude',
            processId: '9999',
            runId: 'run-killed',
            generation: 1,
            startedAt: new Date().toISOString(),
            messageIds: ['m-keyed'],
            taskId: '1091',
        });
        await runs.insertStart({
            specId: 'other-1',
            agentKind: 'claude',
            processId: '8888',
            runId: 'run-live-other',
            generation: 1,
            startedAt: new Date().toISOString(),
        });
        // The state the row is in when the loop's first drain runs: the reap must have landed
        // BEFORE it (the killed turn needs a definite receipt before anything is classified).
        let statusAtDrain: string | undefined;
        const deps = memberOnlyDeps(db, {
            drain: async () => {
                statusAtDrain = (await runs.getByRunId('run-killed'))?.status;
                return { prompt: undefined, flags: {}, claimed: [] };
            },
        });

        const code = await runAgentLoopCore(deps, {
            recipient: 'member-1',
            pollMs: 10,
            flags: {},
            runtime: { maxIterations: 1 },
        });
        expect(code).toBe(0);
        expect(statusAtDrain).toBe('errored');
        const orphan = await runs.getByRunId('run-killed');
        expect(orphan?.status).toBe('errored');
        expect(orphan?.outcome).toBe('errored');
        expect(orphan?.completed_at).not.toBeNull();
        expect(orphan?.message_ids_json).toBe('["m-keyed"]');
        // F6: the reap wakes the orchestrator instead of waiting for the backstop poll.
        const exits = await new SystemEventDao(db).query({ names: ['agent.invoke.exit'] });
        expect(exits.map((row) => row.actor)).toEqual(['member-1']);
        // The reap is visible to run-scoped ledger queries, not only inside the payload.
        expect(exits.map((row) => row.run_id)).toEqual(['run-killed']);
        // F5: a concurrently running loop's spec is never reaped.
        expect((await runs.getByRunId('run-live-other'))?.status).toBe('running');
        // The instance is idle for the strategy again.
        expect(await runs.hasRunning('member-1')).toBe(false);
    });

    test('R4: the orchestrator answers its inbox with the reply instruction; the drain starts first but never gates the tick (1274)', async () => {
        const db = await memDb();
        const order: string[] = [];
        let runBody = '';
        const deps = memberDeps(db, {
            cwd: mkdtempSync(join(tmpdir(), 'loop-orch-order-')),
            fleet: {
                load: async () => ({ enabled: true }),
                resolveOrchestrator: async () => ({ instanceId: 'member-1' }),
                assertLaunchGroundTruth: async () => {},
            } as unknown as FleetService,
            drain: async () => {
                order.push('drain');
                return { prompt: 'status?', flags: {}, claimed: [{ id: 'm-status', attempts: 1 }] };
            },
            agentService: () =>
                ({
                    run: async (body: string) => {
                        order.push('run');
                        runBody = body;
                        return 0;
                    },
                    runTraced: async () => ({}),
                }) as unknown as ReturnType<AgentLoopDeps['agentService']>,
            makeStrategyRuntime: async () =>
                ({
                    resume: async () => {},
                    observe: async () => {
                        order.push('observe');
                        return { released: [] };
                    },
                    tick: async () => {
                        order.push('tick');
                        return { dispatched: [], holds: [] };
                    },
                    stop: () => {},
                }) as unknown as StrategyRuntime,
        });
        const code = await runAgentLoopCore(deps, {
            recipient: 'member-1',
            pollMs: 10,
            flags: {},
            runtime: { maxIterations: 1 },
        });
        expect(code).toBe(0);
        // 1274: the conversation is started before selection but not awaited — `run` may land
        // after observe/tick; all four still happen in the one wake.
        expect(order[0]).toBe('drain');
        expect([...order].sort()).toEqual(['drain', 'observe', 'run', 'tick']);
        expect(order.indexOf('observe')).toBeLessThan(order.indexOf('tick'));
        expect(runBody.startsWith('status?')).toBe(true);
        expect(runBody.endsWith(ORCHESTRATOR_REPLY_INSTRUCTION)).toBe(true);
    });

    test('R4: a throwing orchestrator drain is logged and does not take the dispatch loop down', async () => {
        const db = await memDb();
        const errors: string[] = [];
        let ticked = 0;
        const cwd = mkdtempSync(join(tmpdir(), 'loop-orch-'));
        const deps = memberDeps(db, {
            cwd,
            error: (message: string) => errors.push(message),
            fleet: {
                load: async () => ({ enabled: true }),
                resolveOrchestrator: async () => ({ instanceId: 'member-1' }),
                assertLaunchGroundTruth: async () => {},
            } as unknown as FleetService,
            drain: async () => {
                throw new Error('inbox unavailable');
            },
            makeStrategyRuntime: async () =>
                ({
                    resume: async () => {},
                    observe: async () => ({ released: [] }),
                    tick: async () => {
                        ticked++;
                        return { dispatched: [], holds: [] };
                    },
                    stop: () => {},
                }) as unknown as StrategyRuntime,
        });
        const code = await runAgentLoopCore(deps, {
            recipient: 'member-1',
            pollMs: 10,
            flags: {},
            runtime: { maxIterations: 1 },
        });
        expect(code).toBe(0);
        // The wake survived the failed drain and still reached the deterministic tick.
        expect(ticked).toBe(1);
        expect(errors.some((message) => message.includes('orchestrator drain failed'))).toBe(true);
    });

    test('R3: loop shutdown does not reset a resume session (the id must survive to the next start)', async () => {
        const db = await memDb();
        const warnings: string[] = [];
        const deps = memberOnlyDeps(db, {
            drain: async () => ({ prompt: undefined, flags: {}, claimed: [] }),
            attachLedger: async () => ({ flush: async () => {}, unsubscribe: () => {} }),
            memberSession: {
                executors: [{ name: 'e1', agent: 'pi' }],
                env: {},
                getDb: async () => db,
                warn: (message: string) => warnings.push(message),
                processFactory: () => fakeProcess(async () => ({ ok: true })),
                sessionCapability: () => ({ mode: 'resume', supportsSessionDir: true }) as never,
            },
        });
        await runAgentLoopCore(deps, { recipient: 'member-1', pollMs: 10, flags: {}, runtime: { maxIterations: 1 } });
        const resets = await new SystemEventDao(db).query({ names: ['fleet.member-session-reset'] });
        expect(resets).toHaveLength(0);
    });
});

// Keep the EventBus import meaningful for the type-level contract check above.
void EventBus;
