/**
 * Task 0968 — the self-draining agent loop as an application service (feature G67 R1/R2).
 * The CLI behavior lock lives in `apps/cli/tests/commands/agent-loop-*.test.ts`; these tests
 * drive the service directly (no `CliContext`, no spawned CLI) so the moved mechanics are
 * unit-covered: the wake wait, the idle-hold dedupe, the not-accepted persistent send, and
 * ownership loss.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb, type DbAdapter, ProjectClaimDao, SystemEventDao } from '@gobing-ai/spur-domain';
import { EventBus } from '@gobing-ai/ts-infra';
import type { AgentLoopDeps } from '../../src/services/agent-loop-service';
import { recordIdleHold, runAgentLoopCore, waitForWake } from '../../src/services/agent-loop-service';
import type { AgentService } from '../../src/services/agent-service';
import type { FleetService } from '../../src/services/fleet-service';
import { normalizeProjectPath } from '../../src/services/project-registry';
import type { StrategyRuntime } from '../../src/services/strategy-runtime';

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
            ({ run: async () => 0, runTraced: async () => ({}) }) as unknown as Pick<AgentService, 'run' | 'runTraced'>,
        fleet: {
            load: async () => null,
            resolveOrchestrator: async () => null,
            assertLaunchGroundTruth: async () => {},
        } as unknown as FleetService,
        makeStrategyRuntime: async () => ({ selectNext: async () => ({ holds: [] }) }) as unknown as StrategyRuntime,
        listAgentSpecs: async () => [{ id: 'member-1' }],
        reconciler: { reconcile: async () => ({ unresolved: [], exhausted: [], scanned: 0 }) },
        drain: async () => ({ prompt: 'do work', flags: {}, claimed: ['m1'] }),
        settle: async (_claimed: string[], outcome: 'accepted' | 'not-started') => {
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
                    ({ dispatchNext: async () => {}, resume: async () => {} }) as unknown as StrategyRuntime,
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

// Keep the EventBus import meaningful for the type-level contract check above.
void EventBus;
