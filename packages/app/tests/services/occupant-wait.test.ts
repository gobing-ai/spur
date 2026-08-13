import { describe, expect, test } from 'bun:test';
import type { OccupantRef } from '@gobing-ai/spur-domain';
import {
    type InvokeEventSnapshot,
    type OccupantPin,
    type OccupantWaitDeps,
    projectLifecycle,
    satisfies,
    snapshotOccupant,
    WaitError,
    type WaitErrorCode,
    waitForOccupant,
} from '../../src/services/occupant-wait';

// ── Pure projector (R6) ───────────────────────────────────────────────────

describe('projectLifecycle (R6)', () => {
    test('latest agent.invoke.start → working', () => {
        const state = projectLifecycle({
            latestInvokeEvent: { eventName: 'agent.invoke.start', sequence: 3 },
            pendingCount: 2,
        });
        expect(state).toBe('working');
    });

    test('latest agent.invoke.exit + empty inbox → idle', () => {
        const state = projectLifecycle({
            latestInvokeEvent: { eventName: 'agent.invoke.exit', sequence: 4 },
            pendingCount: 0,
        });
        expect(state).toBe('idle');
    });

    test('latest agent.invoke.exit + pending inbox → unknown (will re-invoke)', () => {
        const state = projectLifecycle({
            latestInvokeEvent: { eventName: 'agent.invoke.exit', sequence: 4 },
            pendingCount: 1,
        });
        expect(state).toBe('unknown');
    });

    test('no events → unknown', () => {
        expect(projectLifecycle({ latestInvokeEvent: null, pendingCount: 0 })).toBe('unknown');
    });

    test('never returns blocked (no first-class signal in wave 2)', () => {
        const states = [
            projectLifecycle({ latestInvokeEvent: null, pendingCount: 5 }),
            projectLifecycle({
                latestInvokeEvent: { eventName: 'agent.invoke.start', sequence: 1 },
                pendingCount: 5,
            }),
        ];
        for (const s of states) expect(s).not.toBe('blocked');
    });
});

describe('satisfies', () => {
    test('idle satisfied only by idle', () => {
        expect(satisfies('idle', 'idle')).toBe(true);
        expect(satisfies('working', 'idle')).toBe(false);
    });

    test('working satisfied only by working', () => {
        expect(satisfies('working', 'working')).toBe(true);
        expect(satisfies('idle', 'working')).toBe(false);
    });

    test('blocked is never satisfiable in wave 2', () => {
        expect(satisfies('working', 'blocked')).toBe(false);
        expect(satisfies('idle', 'blocked')).toBe(false);
    });
});

// ── waitForOccupant (R4) with fakes ───────────────────────────────────────

/** Build a fake deps whose occupant/event/pending state advances over ticks. */
function buildFakeDeps(opts: {
    startOccupant: OccupantRef;
    startPending?: number;
    startLatest?: InvokeEventSnapshot | null;
    clock: { ms: number };
    events: InvokeEventSnapshot[]; // pushed to by the test to advance state
    pending: { n: number };
    /** Per-tick occupant; `null` means "gone". `undefined` falls back to start. */
    occupantOverrides?: (OccupantRef | null)[];
    /** When `true`, the fake follow terminates (mirrors the real helper's abort). */
    followAborted?: () => boolean;
    sleepCalls?: number[];
}): OccupantWaitDeps {
    let tick = 0;
    const deps: OccupantWaitDeps = {
        async getOccupant() {
            const override = opts.occupantOverrides?.[tick];
            tick++;
            return override === undefined ? opts.startOccupant : override;
        },
        async countPending() {
            return opts.pending.n;
        },
        async latestInvokeEvent() {
            const latest = opts.events.length > 0 ? opts.events[opts.events.length - 1] : (opts.startLatest ?? null);
            return latest ?? null;
        },
        // Snapshot-then-follow fake: yields events with sequence > afterSequence,
        // polling on the same injected sleep so tests advance time/state.
        async *follow(afterSequence: number) {
            for (;;) {
                if (opts.followAborted?.() === true) return;
                for (const e of opts.events) {
                    if ((e.sequence ?? 0) <= afterSequence) continue;
                    afterSequence = e.sequence ?? 0;
                    yield {
                        id: `evt-${e.sequence}`,
                        event_name: e.eventName,
                        occurred_at: '',
                        actor: null,
                        payload_json: null,
                        run_id: opts.startOccupant.runId,
                        entity_kind: null,
                        entity_id: null,
                        sequence: e.sequence,
                    };
                }
                await deps.sleep(100);
            }
        },
        now() {
            return opts.clock.ms;
        },
        async sleep(ms: number) {
            opts.sleepCalls?.push(ms);
            // advance the fake clock so stall/timeout budgets elapse
            opts.clock.ms += ms;
            // Real macrotask pacing: the follow-driven loop waits on the follow
            // generator's poll timer, which a synchronously-resolving sleep would
            // starve (the loop's own microtask chain would never yield to timers).
            await new Promise((resolve) => setTimeout(resolve, ms));
        },
    };
    return deps;
}

function pin(over: Partial<OccupantPin> = {}): OccupantPin {
    return { specId: 'reviewer', runId: 'R', generation: 1, ...over };
}

function occupant(over: Partial<OccupantRef> = {}): OccupantRef {
    return { specId: 'reviewer', agentKind: 'claude', processId: null, runId: 'R', generation: 1, ...over };
}

describe('waitForOccupant (R4)', () => {
    test('satisfied immediately when already idle at snapshot', async () => {
        const deps = buildFakeDeps({
            startOccupant: occupant(),
            startLatest: { eventName: 'agent.invoke.exit', sequence: 5 },
            pending: { n: 0 },
            clock: { ms: 0 },
            events: [{ eventName: 'agent.invoke.exit', sequence: 5 }],
        });
        const result = await waitForOccupant(deps, { pin: pin(), until: 'idle' });
        expect(result.satisfied).toBe('idle');
    });

    test('matches when a later invoke.exit arrives (invoke-exit target)', async () => {
        const clock = { ms: 0 };
        // Start with a start event (working); then an exit arrives at tick 2.
        const events: InvokeEventSnapshot[] = [{ eventName: 'agent.invoke.start', sequence: 5 }];
        const deps = buildFakeDeps({
            startOccupant: occupant(),
            startLatest: events[0],
            pending: { n: 0 },
            clock,
            events,
        });
        // After the first sleep, push an exit event so the next read sees it.
        const sleepDeps = deps;
        const origSleep = sleepDeps.sleep;
        sleepDeps.sleep = async (ms: number) => {
            events.push({ eventName: 'agent.invoke.exit', sequence: 6 });
            return origSleep(ms);
        };
        const result = await waitForOccupant(sleepDeps, { pin: pin(), until: 'invoke-exit' });
        expect(result.satisfied).toBe('invoke-exit');
    });

    test('run_replaced when generation bumps', async () => {
        const clock = { ms: 0 };
        const startOccupant = occupant();
        // tick 0: original occupant (snapshot); tick 1+: bumped generation
        const occupantOverrides = [startOccupant, occupant({ generation: 2 }), occupant({ generation: 2 })];
        const deps = buildFakeDeps({
            startOccupant,
            startLatest: { eventName: 'agent.invoke.start', sequence: 1 },
            pending: { n: 0 },
            clock,
            events: [{ eventName: 'agent.invoke.start', sequence: 1 }],
            occupantOverrides,
        });
        await expect(waitForOccupant(deps, { pin: pin(), until: 'idle', timeoutMs: 10000 })).rejects.toMatchObject({
            code: 'run_replaced',
        });
    });

    test('occupant_gone when occupant disappears', async () => {
        const clock = { ms: 0 };
        const startOccupant = occupant();
        // tick 0: snapshot present; tick 1+: null
        const occupantOverrides: (OccupantRef | null)[] = [startOccupant, null];
        const deps = buildFakeDeps({
            startOccupant,
            startLatest: { eventName: 'agent.invoke.start', sequence: 1 },
            pending: { n: 0 },
            clock,
            events: [{ eventName: 'agent.invoke.start', sequence: 1 }],
            occupantOverrides,
        });
        await expect(waitForOccupant(deps, { pin: pin(), until: 'idle', timeoutMs: 10000 })).rejects.toMatchObject({
            code: 'occupant_gone',
        });
    });

    test('wait_stalled when non-working and no progress within budget', async () => {
        const clock = { ms: 0 };
        // Non-working occupant (only a start? no — start IS working). Make it
        // unknown: no events, pending > 0.
        const deps = buildFakeDeps({
            startOccupant: occupant(),
            startLatest: null,
            pending: { n: 1 },
            clock,
            events: [], // never advances
        });
        await expect(
            waitForOccupant(deps, {
                pin: pin(),
                until: 'idle',
                stallMs: 500,
                timeoutMs: 10000,
            }),
        ).rejects.toMatchObject({ code: 'wait_stalled' });
    });

    test('timeout when caller deadline elapses before any match', async () => {
        const clock = { ms: 0 };
        // Working occupant that never transitions to idle, so stall never fires
        // (wasWorking=true), but the caller timeout does.
        const deps = buildFakeDeps({
            startOccupant: occupant(),
            startLatest: { eventName: 'agent.invoke.start', sequence: 1 },
            pending: { n: 1 },
            clock,
            events: [{ eventName: 'agent.invoke.start', sequence: 1 }],
        });
        await expect(
            waitForOccupant(deps, {
                pin: pin(),
                until: 'idle',
                timeoutMs: 250,
            }),
        ).rejects.toMatchObject({ code: 'timeout' });
    });
});

describe('snapshotOccupant', () => {
    test('throws occupant_gone when no occupant exists', async () => {
        const deps: OccupantWaitDeps = {
            async getOccupant() {
                return null;
            },
            async countPending() {
                return 0;
            },
            async latestInvokeEvent() {
                return null;
            },
            // Unused by snapshotOccupant — required by the deps contract.
            follow() {
                return { async *[Symbol.asyncIterator]() {} };
            },
            now: () => 0,
            async sleep() {},
        };
        await expect(snapshotOccupant(deps, 'ghost', {})).rejects.toBeInstanceOf(WaitError);
        await expect(snapshotOccupant(deps, 'ghost', {})).rejects.toMatchObject({ code: 'occupant_gone' });
    });
});

// Ensure WaitErrorCode exhausts the wave-2 surface (compile-time guard).
const _: WaitErrorCode[] = ['occupant_gone', 'run_replaced', 'wait_stalled', 'timeout'];
void _;
