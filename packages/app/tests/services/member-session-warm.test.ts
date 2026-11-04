/**
 * Task 1275 — the member-owned warm turn-session slot.
 *
 * Failure-first: the slot must start EMPTY (no warm reuse until a session is adopted), adopt
 * exactly what the dispatcher opened under the loop-lifetime binding, survive a broken
 * underlying close (a dead worker must never fail the caller's drain), and be idempotent —
 * a shutdown racing a reset must not double-close.
 */
import { describe, expect, test } from 'bun:test';
import type { TurnSession } from '@gobing-ai/ts-ai-runner';
import { MemberSession } from '../../src/services/member-session';

function fakeTurnSession(state: 'ready' | 'busy' | 'closed' = 'ready'): TurnSession & { closeCalls: number } {
    const fake = {
        closeCalls: 0,
        agent: 'pi',
        policyDigest: 'digest',
        state,
        startTurn: () => {
            throw new Error('fake session admits no turns');
        },
        close: async () => {
            fake.closeCalls++;
        },
    };
    return fake as never;
}

function harness(): { session: MemberSession } {
    const session = new MemberSession(
        {
            executors: [],
            env: {},
            getDb: async () => {
                throw new Error('no ledger in this test');
            },
            warn: () => undefined,
        },
        'member',
    );
    return { session };
}

describe('MemberSession warm turn slot (task 1275)', () => {
    test('the slot starts empty and adopts a session under its binding', () => {
        const { session } = harness();
        expect(session.turnSession()).toBeUndefined();
        expect(session.turnBinding()).toBeUndefined();
        const fake = fakeTurnSession();
        const binding = { memberId: 'member', ownerEpoch: 1, occupantGeneration: 3 };
        session.adoptTurnSession(fake, binding);
        expect(session.turnSession()).toBe(fake);
        expect(session.turnBinding()).toEqual(binding);
    });

    test('closeTurnSession closes the underlying session and forgets it — even when close rejects', async () => {
        const { session } = harness();
        const broken = fakeTurnSession();
        (broken as { close: () => Promise<void> }).close = async () => {
            broken.closeCalls++;
            throw new Error('worker already dead');
        };
        session.adoptTurnSession(broken, { memberId: 'member', ownerEpoch: 1, occupantGeneration: 3 });
        await expect(session.closeTurnSession()).resolves.toBeUndefined();
        expect(broken.closeCalls).toBe(1);
        expect(session.turnSession()).toBeUndefined();
        expect(session.turnBinding()).toBeUndefined();
    });

    test('closeTurnSession is idempotent — a second close is a no-op', async () => {
        const { session } = harness();
        const fake = fakeTurnSession();
        (fake as { close: () => Promise<void> }).close = async () => {
            fake.closeCalls++;
        };
        session.adoptTurnSession(fake, { memberId: 'member', ownerEpoch: 1, occupantGeneration: 3 });
        await session.closeTurnSession();
        await session.closeTurnSession();
        expect(fake.closeCalls).toBe(1);
        expect(session.turnSession()).toBeUndefined();
    });

    test('adopting a session makes hasLiveState true even without a process or resume id', () => {
        const { session } = harness();
        session.adoptTurnSession(fakeTurnSession(), { memberId: 'member', ownerEpoch: 1, occupantGeneration: 3 });
        expect(session.hasLiveState()).toBe(true);
    });

    test('resumeId mirrors the session-id flag condition, not a bare id (R2 receipt mode)', () => {
        const { session } = harness();
        session.mode = 'one-shot';
        session.id = 'stale-id';
        expect(session.resumeId()).toBeUndefined();
        session.mode = 'resume';
        expect(session.resumeId()).toBe('stale-id');
    });
});
