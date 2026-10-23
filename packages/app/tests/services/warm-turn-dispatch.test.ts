/**
 * Task 1275 — the correlated warm-turn dispatcher (G74 R1–R5).
 *
 * Failure-first: every test pins one way the seam could silently corrupt a keyed run —
 * a fresh role sharing a conversation, an unsupported agent falling back UNNAMED, a busy
 * worker replaying a write (R4's never-again), stale frames certifying a turn, or a
 * never-started turn double-executing on resume. The session side is REAL: the
 * `@gobing-ai/ts-ai-runner/testing` fake driver spawns an actual child process and the
 * dispatcher talks to the real `TurnSession` implementation across it — only the member
 * slot is a stub (the loop owns that seam in production).
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AgentName, AiRunner, type TurnOutcomeKind } from '@gobing-ai/ts-ai-runner';
import { createFakeTurnSessionDriver, type FakeTurnAction } from '@gobing-ai/ts-ai-runner/testing';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import type { WarmTurnContext, WarmTurnDispatch } from '../../src/observability/agent-execution';
import {
    createWarmTurnDispatcher,
    type TurnReceipt,
    type WarmTurnDiagnostic,
    type WarmTurnSessionHolder,
} from '../../src/services/warm-turn-dispatch';
import { FRESH_SESSION_ROLES } from '../../src/workflow/fleet-dispatch';

const workspaces: string[] = [];
afterEach(() => {
    while (workspaces.length > 0) {
        const dir = workspaces.pop();
        if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    }
});

function workspace(): string {
    const dir = mkdtempSync(join(tmpdir(), 'warm-turn-'));
    workspaces.push(dir);
    return dir;
}

/** In-memory member slot: the same minimal surface `MemberSession` implements. */
function fakeHolder(): WarmTurnSessionHolder & {
    closed: number;
} {
    let session: WarmTurnSessionHolder['turnSession'] extends () => infer S ? S : never;
    let binding: Parameters<WarmTurnSessionHolder['adoptTurnSession']>[1] | undefined;
    return {
        closed: 0,
        turnSession: () => session,
        turnBinding: () => binding,
        adoptTurnSession(opened, adopted) {
            session = opened;
            binding = adopted;
        },
        async closeTurnSession() {
            if (session !== undefined) {
                await session.close();
                session = undefined;
                binding = undefined;
            }
            this.closed++;
        },
    } as WarmTurnSessionHolder & { closed: number };
}

interface Rig {
    openCalls: number;
    diagnostics: Array<{ event: string; reason: string; turn: TurnReceipt }>;
}

interface Rig {
    openCalls: number;
    diagnostics: Array<{ event: string; reason: string; turn: TurnReceipt }>;
    dispatcher: ReturnType<typeof createWarmTurnDispatcher>;
    holder: ReturnType<typeof fakeHolder>;
    dispatch(overrides?: Partial<WarmTurnContext>): Promise<WarmTurnDispatch>;
}

function makeDispatcher(
    actions: FakeTurnAction[],
    options: {
        role?: string;
        holder?: ReturnType<typeof fakeHolder>;
        qualify?: () => { qualified: true } | { qualified: false; reason: string };
        withDriver?: boolean;
    } = {},
): Rig {
    const holder = options.holder ?? fakeHolder();
    const rig: Rig = {
        openCalls: 0,
        diagnostics: [],
        holder,
        dispatcher: undefined as never,
        dispatch: undefined as never,
    };
    const runner = new AiRunner({ processExecutor: new NodeProcessExecutor() });
    const driver = createFakeTurnSessionDriver(actions, {
        ...(options.qualify !== undefined ? { qualify: options.qualify } : {}),
    });
    const diagnose: WarmTurnDiagnostic = (detail) => rig.diagnostics.push(detail);
    rig.dispatcher = createWarmTurnDispatcher({
        openSession: async (agent, policy) => {
            rig.openCalls++;
            return runner.openTurnSession(agent as AgentName, {
                policy,
                // The empty 0.x registry path is its own test; a driver is injected otherwise.
                ...(options.withDriver === false ? {} : { driver }),
                binary: { path: '/fake/bin/pi', version: '9.9.9-fake' },
                handshakeTimeoutMs: 2_000,
            });
        },
        holder,
        binding: { memberId: 'member', ownerEpoch: 1, occupantGeneration: 7 },
        freshRoles: FRESH_SESSION_ROLES,
        diagnose,
    });
    const base: WarmTurnContext = {
        agent: 'pi',
        prompt: 'implement the task',
        cwd: workspace(),
        role: options.role ?? 'build',
        correlation: { runId: 'run-1', executionId: 'exec-1', requestId: 'req-1', attempt: 1 },
    };
    rig.dispatch = (overrides = {}) => rig.dispatcher.dispatchTurn({ ...base, ...overrides });
    return rig;
}

describe('warm-turn-dispatch (task 1275)', () => {
    test('R3/ADR-121: a fresh-session role never opens a warm session', async () => {
        const rig = makeDispatcher([{ op: 'exit', code: 0 }], { role: FRESH_SESSION_ROLES[0] });
        const result = await rig.dispatch();
        expect(result).toMatchObject({ kind: 'fallback', reason: 'fresh-role' });
        expect(rig.openCalls).toBe(0);
        expect(rig.dispatcher.lastTurn()).toMatchObject({ mode: 'one-shot', fallbackReason: 'fresh-role' });
    });

    test('unsupported agent → named fallback, nothing adopted', async () => {
        const rig = makeDispatcher([{ op: 'exit', code: 0 }], { withDriver: false });
        const result = await rig.dispatch();
        expect(result).toMatchObject({ kind: 'fallback', reason: 'unsupported-agent' });
        expect(rig.holder.turnSession()).toBeUndefined();
        expect(rig.dispatcher.lastTurn()?.fallbackReason).toBe('unsupported-agent');
    });

    test('R2/R5: the receipt names the fallback path the executor will really take', async () => {
        const resuming = { ...fakeHolder(), resumeId: () => 'session-from-last-drain' };
        const rig = makeDispatcher([{ op: 'exit', code: 0 }], { withDriver: false, holder: resuming });
        const result = await rig.dispatch();
        expect(result).toMatchObject({ kind: 'fallback', reason: 'unsupported-agent' });
        // A member holding a resume id continues on resume, not one-shot — the receipt says so.
        expect(rig.dispatcher.lastTurn()).toMatchObject({
            mode: 'resume',
            fallbackReason: 'unsupported-agent',
            requestId: 'req-1',
            attempt: 1,
            memberId: 'member',
            ownerEpoch: 1,
            occupantGeneration: 7,
        });
    });

    test('unqualified binary version → named fallback before any spawn', async () => {
        const rig = makeDispatcher([{ op: 'exit', code: 0 }], {
            qualify: () => ({ qualified: false, reason: 'pi >= 2.0 required' }),
        });
        const result = await rig.dispatch();
        expect(result).toMatchObject({ kind: 'fallback', reason: 'unqualified-version' });
        expect(rig.holder.turnSession()).toBeUndefined();
    });

    test('warm path: accepted turn settles warm, session is retained and reused', async () => {
        const rig = makeDispatcher([
            { op: 'accept' },
            { op: 'output', data: 'working' },
            { op: 'terminal', kind: 'success', finalText: 'done' },
        ]);
        const first = await rig.dispatch();
        expect(first.kind).toBe('warm');
        if (first.kind === 'warm') {
            expect(first.outcome.kind).toBe<TurnOutcomeKind>('success');
            expect(first.outcome.correlation).toMatchObject({ requestId: 'req-1', attempt: 1 });
        }
        const receipt = rig.dispatcher.lastTurn();
        expect(receipt).toMatchObject({
            mode: 'warm',
            nativeOutcome: 'success',
            requestId: 'req-1',
            attempt: 1,
            memberId: 'member',
            ownerEpoch: 1,
            occupantGeneration: 7,
        });
        expect(receipt?.acceptedAt).toBeDefined();
        expect(rig.openCalls).toBe(1);

        // The second keyed request reuses the SAME session — no second open, no re-handshake.
        const second = await rig.dispatch({
            correlation: { runId: 'run-1', executionId: 'exec-2', requestId: 'req-2', attempt: 1 },
        });
        expect(second.kind).toBe('warm');
        expect(rig.openCalls).toBe(1);
        expect(rig.dispatcher.lastTurn()?.requestId).toBe('req-2');
    });

    test('R3/AC2: a policy change retires the old session and opens a new one', async () => {
        const rig = makeDispatcher([{ op: 'accept' }, { op: 'terminal', kind: 'success', finalText: 'done' }]);
        await rig.dispatch();
        const firstDigest = rig.dispatcher.lastTurn()?.policyDigest;
        expect(rig.openCalls).toBe(1);

        // A different model is a different policy — the digest covers exactly the fields this seam
        // can observe (workspace/role/model): the old conversation must never carry over into it.
        const second = await rig.dispatch({ model: 'another-model' });
        expect(second.kind).toBe('warm');
        expect(rig.openCalls).toBe(2);
        expect(rig.holder.closed).toBe(1);
        expect(rig.dispatcher.lastTurn()?.policyDigest).not.toBe(firstDigest);
    });

    test('R2: an occupant-generation transfer resets the worker instead of reusing it', async () => {
        const rig = makeDispatcher([{ op: 'accept' }, { op: 'terminal', kind: 'success', finalText: 'done' }]);
        await rig.dispatch();
        const adopted = rig.holder.turnSession();
        expect(adopted).toBeDefined();
        // The slot now belongs to a different occupant generation: nothing the previous
        // occupant accepted may be reused (R2 pinning).
        rig.holder.adoptTurnSession(adopted as NonNullable<typeof adopted>, {
            memberId: 'member',
            ownerEpoch: 1,
            occupantGeneration: 8,
        });
        await rig.dispatch();
        expect(rig.openCalls).toBe(2);
        expect(rig.holder.closed).toBe(1);
        expect(rig.dispatcher.lastTurn()?.occupantGeneration).toBe(7);
    });

    test('R4: a busy worker never replays a write — the new request is outcome-unknown', async () => {
        const rig = makeDispatcher([
            { op: 'accept' },
            { op: 'sleep', ms: 600 },
            { op: 'terminal', kind: 'success', finalText: 'first turn' },
        ]);
        const first = rig.dispatch();
        // The session is busy (turn accepted, terminal pending) — the SECOND dispatch must not
        // queue or start a turn; it settles UNCERTAIN and retires the worker.
        const deadline = Date.now() + 5_000;
        while (rig.holder.turnSession()?.state !== 'busy' && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(rig.holder.turnSession()?.state).toBe('busy');
        const second = await rig.dispatch({
            correlation: { runId: 'run-1', executionId: 'exec-2', requestId: 'req-2', attempt: 1 },
        });
        expect(second.kind).toBe('warm');
        if (second.kind === 'warm') {
            expect(second.outcome.kind).toBe<TurnOutcomeKind>('outcome-unknown');
        }
        expect(rig.dispatcher.lastTurn()?.nativeOutcome).toBe('outcome-unknown');
        expect(rig.holder.turnSession()).toBeUndefined();
        expect((await first).kind).toBe('warm');
    });

    test('R4: a foreign/stale frame is diagnostic evidence, never certification', async () => {
        const rig = makeDispatcher([
            { op: 'accept' },
            // An impostor terminal for another turn arrives first; the facade must route it as a
            // diagnostic and keep waiting for the real terminal.
            { op: 'stray', line: { turn: 'other-turn', type: 'terminal', kind: 'success', finalText: 'impostor' } },
            { op: 'terminal', kind: 'success', finalText: 'real' },
        ]);
        const result = await rig.dispatch();
        expect(result.kind).toBe('warm');
        if (result.kind === 'warm') expect(result.outcome.kind).toBe<TurnOutcomeKind>('success');
        expect(rig.diagnostics.length).toBeGreaterThanOrEqual(1);
        expect(rig.diagnostics[0]?.event).toBe('fleet.turn.stale');
        expect(rig.dispatcher.lastTurn()?.nativeOutcome).toBe('success');
    });

    test('R5: a turn that never started falls back to one-shot exactly once', async () => {
        // Default auto-ready opens the session (with its nativeSessionId); the child then exits
        // the moment the turn arrives — acceptance never happens, so the ONLY allowed
        // post-startTurn fallback fires.
        const rig = makeDispatcher([
            { op: 'sleep', ms: 200 },
            { op: 'exit', code: 3 },
        ]);
        const result = await rig.dispatch();
        expect(result).toMatchObject({ kind: 'fallback', reason: 'not-started' });
        expect(rig.dispatcher.lastTurn()).toMatchObject({ mode: 'one-shot', fallbackReason: 'not-started' });
    });
});
