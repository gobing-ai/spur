/**
 * Task 1274 (G74 R2) — the orchestrator's scheduling tick never waits on its own conversation.
 *
 * Failure cases enumerated before the change:
 * - a held conversation blocks observe/tick, so a newly runnable task waits for the chat to end;
 * - wakes arriving during the held conversation run ticks concurrently or are lost;
 * - a second drain starts while the first conversation is still in flight;
 * - an inbox message that arrived during the held conversation waits for the `--poll` backstop;
 * - shutdown during a held conversation hangs on the chat (unbounded) or skips the claim release;
 * - ownership lost during a held conversation keeps ticking under a stale owner epoch.
 *
 * The loop runs against a real in-memory ledger, so every wake is a real `system_events` row the
 * loop follows; only the agent and the strategy are scripted.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InboxClaim } from '@gobing-ai/spur-domain';
import { createMigratedDb, type DbAdapter, ProjectClaimDao, SystemEventDao } from '@gobing-ai/spur-domain';
import type { AgentLoopDeps } from '../../src/services/agent-loop-service';
import { runAgentLoopCore } from '../../src/services/agent-loop-service';
import type { FleetService } from '../../src/services/fleet-service';
import { normalizeProjectPath } from '../../src/services/project-registry';
import type { StrategyRuntime } from '../../src/services/strategy-runtime';

async function emit(db: DbAdapter, eventName: string): Promise<void> {
    await new SystemEventDao(db).insert({
        id: crypto.randomUUID(),
        event_name: eventName,
        occurred_at: new Date().toISOString(),
        actor: 'human',
        payload_json: JSON.stringify({ eventName }),
    });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() > deadline) return false;
        await sleep(5);
    }
    return true;
}

/** Emit wakes until the loop (whose ledger cursor is set asynchronously at start) reacts. */
async function kickUntil(db: DbAdapter, predicate: () => boolean): Promise<boolean> {
    for (let i = 0; i < 40 && !predicate(); i++) {
        await emit(db, 'message.sent');
        await until(predicate, 50);
    }
    return predicate();
}

/** A manually released gate standing in for a long orchestrator conversation turn. */
function heldTurn() {
    let release: () => void = () => {};
    const done = new Promise<void>((resolve) => {
        release = resolve;
    });
    return { done, release };
}

interface Harness {
    deps: AgentLoopDeps;
    runnable: string[];
    dispatched: Map<string, number>;
    dispatchedAt: Map<string, number>;
    drainCalls: () => number;
    runCalls: () => number;
    maxConcurrentTicks: () => number;
    ticks: () => number;
    settled: string[];
    errors: string[];
}

/** Orchestrator-owner deps: the loop's recipient IS the declared orchestrator. */
function orchestratorHarness(
    db: DbAdapter,
    opts: { prompts: string[]; run: (body: string) => Promise<number> },
): Harness {
    const runnable: string[] = [];
    const dispatched = new Map<string, number>();
    const dispatchedAt = new Map<string, number>();
    const settled: string[] = [];
    const errors: string[] = [];
    const prompts = [...opts.prompts];
    let drainCalls = 0;
    let runCalls = 0;
    let ticking = 0;
    let maxConcurrentTicks = 0;
    let ticks = 0;
    const deps = {
        cwd: mkdtempSync(join(tmpdir(), 'loop-orch-tick-')),
        getDb: async () => db,
        write: () => {},
        error: (message: string) => errors.push(message),
        agentService: (bus: { emit(name: string, payload: unknown): void }) =>
            ({
                run: async (body: string) => {
                    runCalls++;
                    // The real runner announces the accepted prompt before the turn proceeds.
                    bus.emit('agent.invoke.start', { operation: 'prompt' });
                    return opts.run(body);
                },
                runTraced: async () => ({}),
            }) as unknown as ReturnType<AgentLoopDeps['agentService']>,
        fleet: {
            load: async () => ({ enabled: true }),
            resolveOrchestrator: async () => ({ instanceId: 'orch-1' }),
            assertLaunchGroundTruth: async () => {},
        } as unknown as FleetService,
        makeStrategyRuntime: async () =>
            ({
                resume: async () => {},
                selectNext: async () => ({ holds: [] }),
                observe: async () => ({ released: [] }),
                tick: async () => {
                    ticking++;
                    ticks++;
                    maxConcurrentTicks = Math.max(maxConcurrentTicks, ticking);
                    try {
                        await sleep(2);
                        const fresh = runnable.filter((wbs) => !dispatched.has(wbs));
                        for (const wbs of fresh) {
                            dispatched.set(wbs, (dispatched.get(wbs) ?? 0) + 1);
                            dispatchedAt.set(wbs, Date.now());
                        }
                        return { dispatched: fresh.map((wbs) => ({ wbs })), holds: [] };
                    } finally {
                        ticking--;
                    }
                },
                stop: () => {},
            }) as unknown as StrategyRuntime,
        listAgentSpecs: async () => [],
        reconciler: { reconcile: async () => ({ unresolved: [], exhausted: [], scanned: 0 }) },
        drain: async () => {
            drainCalls++;
            const prompt = prompts.shift();
            return prompt === undefined
                ? { flags: {}, claimed: [] }
                : { prompt, flags: {}, claimed: [{ id: `m-${drainCalls}`, attempts: 1 }] };
        },
        settle: async (_claimed: InboxClaim[], outcome: 'accepted' | 'not-started') => {
            settled.push(outcome);
        },
        attachLedger: async () => ({ flush: async () => {}, unsubscribe: () => {} }),
        memberSession: {
            executors: [],
            env: {},
            getDb: async () => db,
            warn: () => {},
            sessionCapability: () => ({ mode: 'one-shot', supportsSessionDir: false }) as never,
        },
    } as unknown as AgentLoopDeps;
    return {
        deps,
        runnable,
        dispatched,
        dispatchedAt,
        drainCalls: () => drainCalls,
        runCalls: () => runCalls,
        maxConcurrentTicks: () => maxConcurrentTicks,
        ticks: () => ticks,
        settled,
        errors,
    };
}

function p95(samples: number[]): number {
    const sorted = [...samples].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? Number.POSITIVE_INFINITY;
}

describe('1274 conversation-independent orchestrator scheduling tick', () => {
    test('R1/R2/R4: a held conversation still dispatches each newly runnable task (p95 ≤ 1s, no duplicates)', async () => {
        const db = await memDb();
        const turn = heldTurn();
        const h = orchestratorHarness(db, {
            prompts: ['what is the fleet doing?'],
            run: async () => {
                await turn.done;
                return 0;
            },
        });
        const abort = new AbortController();
        // The backstop is far beyond the budget: only real wakes can meet the 1s p95.
        const loop = runAgentLoopCore(h.deps, {
            recipient: 'orch-1',
            pollMs: 60_000,
            flags: {},
            runtime: { signal: abort.signal },
        });
        expect(await kickUntil(db, () => h.runCalls() === 1)).toBe(true);

        const latencies: number[] = [];
        for (let i = 0; i < 20; i++) {
            const wbs = `t-${i}`;
            h.runnable.push(wbs);
            const emittedAt = Date.now();
            await emit(db, 'task.updated');
            expect(await until(() => h.dispatched.has(wbs), 2_000)).toBe(true);
            latencies.push((h.dispatchedAt.get(wbs) ?? Number.POSITIVE_INFINITY) - emittedAt);
        }
        // Double wake: two rows in one burst rerun selection serially, never concurrently.
        h.runnable.push('t-burst');
        await emit(db, 'task.updated');
        await emit(db, 'fleet.capacity.changed');
        expect(await until(() => h.dispatched.has('t-burst'), 2_000)).toBe(true);

        // Still the same, still-held conversation: no second drain while one is in flight.
        expect(h.drainCalls()).toBe(1);
        expect(h.runCalls()).toBe(1);
        expect(h.settled).toEqual([]);

        turn.release();
        expect(await until(() => h.settled.length === 1, 2_000)).toBe(true);
        abort.abort();
        expect(await loop).toBe(0);

        expect(p95(latencies)).toBeLessThanOrEqual(1_000);
        expect([...h.dispatched.values()].every((count) => count === 1)).toBe(true);
        expect(h.dispatched.size).toBe(21);
        expect(h.maxConcurrentTicks()).toBe(1);
        expect(h.settled).toEqual(['accepted']);
    });

    test('R2: an inbox message that arrived during the held conversation drains as soon as it ends', async () => {
        const db = await memDb();
        const turn = heldTurn();
        let calls = 0;
        const h = orchestratorHarness(db, {
            prompts: ['first', 'second'],
            run: async () => {
                calls++;
                if (calls === 1) await turn.done;
                return 0;
            },
        });
        const abort = new AbortController();
        const loop = runAgentLoopCore(h.deps, {
            recipient: 'orch-1',
            pollMs: 60_000,
            flags: {},
            runtime: { signal: abort.signal },
        });
        expect(await kickUntil(db, () => h.runCalls() === 1)).toBe(true);
        await emit(db, 'message.sent');
        expect(await until(() => h.ticks() >= 2, 2_000)).toBe(true);
        expect(h.drainCalls()).toBe(1);
        turn.release();
        // Not the 60s backstop: the settled conversation re-wakes the loop for the queued message.
        expect(await until(() => h.runCalls() === 2, 1_000)).toBe(true);
        expect(await until(() => h.settled.length === 2, 1_000)).toBe(true);
        abort.abort();
        expect(await loop).toBe(0);
        expect(h.settled).toEqual(['accepted', 'accepted']);
    });

    test('R3: shutdown during a held conversation is bounded and still releases the owner claim', async () => {
        const db = await memDb();
        const h = orchestratorHarness(db, {
            prompts: ['never answers'],
            run: () => new Promise<number>(() => {}),
        });
        const abort = new AbortController();
        const loop = runAgentLoopCore(h.deps, {
            recipient: 'orch-1',
            pollMs: 60_000,
            flags: {},
            runtime: { signal: abort.signal, conversationShutdownGraceMs: 50 },
        });
        expect(await kickUntil(db, () => h.runCalls() === 1)).toBe(true);
        const stoppedAt = Date.now();
        abort.abort();
        expect(await loop).toBe(0);
        expect(Date.now() - stoppedAt).toBeLessThan(1_000);
        expect(h.errors.some((message) => message.includes('orchestrator conversation still running'))).toBe(true);
        // Released, not left to expire: a successor can claim the orchestrator slot immediately.
        const successor = await new ProjectClaimDao(db).claim(
            normalizeProjectPath(h.deps.cwd),
            'orchestrator',
            'orch-2',
            60_000,
        );
        expect(successor).not.toBeNull();
    });

    test('R3: ownership lost during a held conversation stops ticking and exits 2', async () => {
        const db = await memDb();
        const proto = ProjectClaimDao.prototype;
        const { heartbeat } = proto;
        const realSetInterval = globalThis.setInterval;
        let lost = false;
        proto.heartbeat = async function (this: ProjectClaimDao, ...args: Parameters<typeof heartbeat>) {
            return lost ? false : heartbeat.apply(this, args);
        };
        globalThis.setInterval = ((fn: () => void, ms?: number) =>
            realSetInterval(fn, Math.min(ms ?? 0, 5))) as typeof setInterval;
        try {
            const h = orchestratorHarness(db, {
                prompts: ['long chat'],
                run: () => new Promise<number>(() => {}),
            });
            const loop = runAgentLoopCore(h.deps, {
                recipient: 'orch-1',
                pollMs: 20,
                flags: {},
                runtime: { conversationShutdownGraceMs: 50 },
            });
            expect(await kickUntil(db, () => h.runCalls() === 1)).toBe(true);
            expect(await until(() => h.ticks() >= 2, 2_000)).toBe(true);
            lost = true;
            expect(await loop).toBe(2);
            const ticksAtExit = h.ticks();
            await sleep(60);
            expect(h.ticks()).toBe(ticksAtExit);
        } finally {
            proto.heartbeat = heartbeat;
            globalThis.setInterval = realSetInterval;
        }
    });
});

async function memDb(): Promise<DbAdapter> {
    return createMigratedDb({ url: ':memory:' });
}
