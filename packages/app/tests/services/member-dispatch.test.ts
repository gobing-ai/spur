import { describe, expect, test } from 'bun:test';
import type { FleetDispatchRequest, FleetReceipt } from '../../src/services/fleet-dispatcher';
import { FleetDispatcher } from '../../src/services/fleet-dispatcher';
import type { ResolvedFleetMember } from '../../src/services/fleet-service';
import {
    DEFAULT_MEMBER_WAIT_MS,
    dispatchToNamedMember,
    memberDelivery,
    resolveMemberAddress,
} from '../../src/services/member-dispatch';

function member(overrides: Partial<ResolvedFleetMember> = {}): ResolvedFleetMember {
    return {
        instanceId: 'proj-coder',
        localId: 'coder',
        role: 'coder',
        executor: 'codex',
        enabled: true,
        writeCapable: true,
        capabilityState: 'enforced',
        ...overrides,
    };
}

function deps(opts: {
    members?: ResolvedFleetMember[];
    live?: boolean;
    receipt?: FleetReceipt;
    withDispatcher?: boolean;
}) {
    const sent: FleetDispatchRequest[] = [];
    return {
        sent,
        dispatchDeps: {
            members: async () => opts.members ?? [member()],
            live: async () => opts.live === true,
            ...(opts.withDispatcher === false
                ? {}
                : {
                      dispatcher: {
                          dispatch: async (req: FleetDispatchRequest) => {
                              sent.push(req);
                              return opts.receipt ?? { status: 'completed', messageId: 'msg-1', runId: 'run-1' };
                          },
                      },
                  }),
        },
    };
}

describe('named-member delivery ladder (1333, ADR-148 §3.2)', () => {
    test('R1: the local id and the full instance id both address the member', () => {
        expect(resolveMemberAddress([member()], 'coder')).toEqual({ member: member() });
        expect(resolveMemberAddress([member()], 'proj-coder')).toEqual({ member: member() });
    });

    test('R1: an unknown address names the declared members', () => {
        const resolution = resolveMemberAddress([member()], 'nope');
        expect('unavailable' in resolution && resolution.unavailable).toContain('no declared fleet member "nope"');
        expect('unavailable' in resolution && resolution.unavailable).toContain('proj-coder');
    });

    test('a local id matching two members is an ambiguity, never a silent pick', () => {
        const resolution = resolveMemberAddress(
            [member(), member({ instanceId: 'other-coder', localId: 'coder' })],
            'coder',
        );
        expect('unavailable' in resolution && resolution.unavailable).toContain('matches 2 declared fleet members');
        expect('unavailable' in resolution && resolution.addressMatched).toBe(true);
    });

    test('P3: a FRAGMENT of an id never matches — only the exact local id does', () => {
        expect(resolveMemberAddress([member()], 'der')).toMatchObject({ addressMatched: false });
        expect(resolveMemberAddress([member()], 'oder')).toMatchObject({ addressMatched: false });
        expect(resolveMemberAddress([member()], 'proj-code')).toMatchObject({ addressMatched: false });
    });

    test('R5: a DISABLED member does not resolve — the same refusal the role path makes', () => {
        const resolution = resolveMemberAddress([member({ enabled: false })], 'coder');
        expect('unavailable' in resolution && resolution.addressMatched).toBe(true);
        expect('unavailable' in resolution && resolution.unavailable).toContain('member "proj-coder"');
        expect('unavailable' in resolution && resolution.unavailable).toContain('disabled');
    });

    test('P2: an unavailable member reports that the address matched, so the CLI refuses instead of re-targeting', async () => {
        const disabled = await dispatchToNamedMember(
            'coder',
            'x',
            deps({ members: [member({ enabled: false })] }).dispatchDeps,
        );
        expect(disabled).toMatchObject({ delivery: 'unavailable', addressMatched: true });
        const executorless = await dispatchToNamedMember(
            'coder',
            'x',
            deps({ members: [member({ executor: '' })] }).dispatchDeps,
        );
        expect(executorless).toMatchObject({ delivery: 'unavailable', addressMatched: true });
        expect(executorless.delivery === 'unavailable' && executorless.reason).toContain('no resolved executor');
        const unknown = await dispatchToNamedMember('nope', 'x', deps({}).dispatchDeps);
        expect(unknown).toMatchObject({ delivery: 'unavailable', addressMatched: false });
    });

    test('R6/AC4: delivery and reason for live, cold, disabled and executor-less members', () => {
        expect(memberDelivery(member(), true).delivery).toBe('warm');
        const cold = memberDelivery(member(), false);
        expect(cold.delivery).toBe('cold');
        expect(cold.reason).toContain("executor 'codex'");
        expect(memberDelivery(member({ enabled: false }), true).delivery).toBe('unavailable');
        expect(memberDelivery(member({ executor: '' }), false).reason).toContain('no resolved executor');
    });

    test('AC1: no daemon running → cold rung on the member executor, nothing dispatched', async () => {
        const { dispatchDeps, sent } = deps({ live: false });
        const result = await dispatchToNamedMember('coder', 'do the thing', dispatchDeps);
        expect(result.delivery).toBe('cold');
        expect(result.delivery === 'cold' && result.member.executor).toBe('codex');
        expect(sent).toHaveLength(0);
    });

    test('AC2: a live member takes one keyed inbox request with the prompt as the body', async () => {
        const { dispatchDeps, sent } = deps({ live: true });
        const result = await dispatchToNamedMember('coder', 'do the thing', dispatchDeps);
        expect(result.delivery).toBe('warm');
        expect(result.delivery === 'warm' && result.status).toBe('completed');
        expect(sent).toHaveLength(1);
        // P3: the sender is the human operator's real inbox id, never the `spur` system address.
        expect(sent[0]).toMatchObject({ member: 'proj-coder', fromId: 'operator', body: 'do the thing' });
    });

    test('R4: an outcome-unknown warm dispatch is reported, never re-run cold', async () => {
        const { dispatchDeps, sent } = deps({
            live: true,
            receipt: { status: 'outcome-unknown', messageId: 'msg-1' },
        });
        const result = await dispatchToNamedMember('coder', 'do the thing', dispatchDeps);
        expect(result.delivery).toBe('warm');
        expect(result.delivery === 'warm' && result.status).toBe('outcome-unknown');
        expect(sent).toHaveLength(1);
    });

    test('a live member with no dispatcher wired still runs cold, and the reason says why', async () => {
        const { dispatchDeps } = deps({ live: true, withDispatcher: false });
        const result = await dispatchToNamedMember('coder', 'do the thing', dispatchDeps);
        expect(result.delivery).toBe('cold');
    });

    test('P3: the warm wait is bounded — a stuck member ends as outcome-unknown, never re-run cold', async () => {
        let clock = 0;
        const dispatcher = new FleetDispatcher({
            coordination: {
                sendMessage: async () => ({ msgId: 'msg-1', toId: 'proj-coder', status: 'queued', injected: false }),
                getMessage: async () => null,
            },
            runs: { listByMessageId: async () => [] },
            now: () => clock,
            sleep: async (ms) => {
                clock += ms;
            },
        });
        const result = await dispatchToNamedMember('coder', 'do the thing', {
            members: async () => [member()],
            live: async () => true,
            dispatcher,
        });
        expect(result.delivery).toBe('warm');
        expect(result.delivery === 'warm' && result.status).toBe('outcome-unknown');
        // The deadline is the exported default, not an infinite wait.
        expect(clock).toBe(DEFAULT_MEMBER_WAIT_MS);
    });

    test('P3: an aborted signal ends a REAL receipt wait at once — never a re-dispatch', async () => {
        let clock = 0;
        let sleeps = 0;
        const abort = new AbortController();
        abort.abort();
        const dispatcher = new FleetDispatcher({
            coordination: {
                sendMessage: async () => ({ msgId: 'msg-1', toId: 'proj-coder', status: 'queued', injected: false }),
                getMessage: async () => null,
            },
            runs: { listByMessageId: async () => [] },
            now: () => clock,
            sleep: async (ms) => {
                sleeps += 1;
                clock += ms;
            },
        });
        const result = await dispatchToNamedMember(
            'coder',
            'do the thing',
            { members: async () => [member()], live: async () => true, dispatcher },
            { signal: abort.signal },
        );
        expect(result.delivery === 'warm' && result.status).toBe('outcome-unknown');
        // The aborted wait never slept a full poll interval: it stops before the first poll.
        expect(sleeps).toBe(0);
    });

    test('P3: an abort signal stops the warm wait as outcome-unknown', async () => {
        const abort = new AbortController();
        const sent: FleetDispatchRequest[] = [];
        const result = await dispatchToNamedMember(
            'coder',
            'do the thing',
            {
                members: async () => [member()],
                live: async () => true,
                dispatcher: {
                    dispatch: async (req: FleetDispatchRequest) => {
                        sent.push(req);
                        abort.abort();
                        return { status: 'outcome-unknown', messageId: 'msg-1' };
                    },
                },
            },
            { timeoutMs: 50, signal: abort.signal },
        );
        expect(result.delivery === 'warm' && result.status).toBe('outcome-unknown');
        expect(sent).toHaveLength(1);
    });

    test('an undeclared address is unavailable with the fix named', async () => {
        const { dispatchDeps } = deps({});
        const result = await dispatchToNamedMember('ghost', 'do the thing', dispatchDeps);
        expect(result.delivery).toBe('unavailable');
    });
});

describe('1334: A2A member delivery rung', () => {
    const remote = () => member({ instanceId: 'proj-remote', localId: 'remote', executor: '', a2a: './card.json' });

    test('memberDelivery names the A2A driver, never an empty local executor', () => {
        expect(memberDelivery(remote(), false)).toMatchObject({
            delivery: 'a2a',
            reason: 'A2A member — remote turn runs in-process (no local executor)',
        });
        expect(memberDelivery(remote(), true)).toMatchObject({
            delivery: 'a2a',
            reason: 'A2A member — live member loop drives the remote turn',
        });
    });

    test('no serve takes the in-process transport and returns artifact text without a warm dispatch', async () => {
        const calls: unknown[][] = [];
        const result = await dispatchToNamedMember('remote', 'read only', {
            members: async () => [remote()],
            live: async () => false,
            dispatcher: {
                enqueue: async () => ({ messageId: 'a2a-1', replayed: false }),
                dispatch: async () => {
                    throw new Error('the warm dispatcher must not run');
                },
            },
            a2a: async (member, prompt, opts) => {
                calls.push([member.instanceId, prompt, opts.fromId]);
                return { status: 'completed', messageId: 'a2a-1', output: 'remote answer' };
            },
        });
        expect(result).toMatchObject({
            delivery: 'a2a',
            status: 'completed',
            messageId: 'a2a-1',
            output: 'remote answer',
        });
        expect(calls).toEqual([['proj-remote', 'read only', 'operator']]);
    });

    test('an A2A not-started is terminal for the rung, never a cold fallback', async () => {
        const result = await dispatchToNamedMember('remote', 'read only', {
            members: async () => [remote()],
            live: async () => false,
            dispatcher: {
                enqueue: async () => ({ messageId: 'a2a-2', replayed: false }),
                dispatch: async () => {
                    throw new Error('unused');
                },
            },
            a2a: async () => ({ status: 'not-started', messageId: 'a2a-2', reason: 'card unreachable' }),
        });
        expect(result).toMatchObject({ delivery: 'a2a', status: 'not-started', reason: 'card unreachable' });
    });

    test('a live A2A member takes one keyed request and reads its result artifact', async () => {
        const sent: FleetDispatchRequest[] = [];
        const result = await dispatchToNamedMember('remote', 'read only', {
            members: async () => [remote()],
            live: async () => true,
            dispatcher: {
                dispatch: async (req: FleetDispatchRequest) => {
                    sent.push(req);
                    return { status: 'completed', messageId: 'a2a-live', runId: 'run-a2a' };
                },
            },
            a2a: async () => {
                throw new Error('the in-process shortcut must not run when live');
            },
            a2aOutput: async (runId) => (runId === 'run-a2a' ? 'warm remote answer' : undefined),
        });
        expect(result).toMatchObject({ delivery: 'a2a', status: 'completed', output: 'warm remote answer' });
        expect(sent).toHaveLength(1);
    });

    test('an unwired A2A turn service is an explicit unavailable, not a cold subprocess', async () => {
        const result = await dispatchToNamedMember('remote', 'read only', {
            members: async () => [remote()],
            live: async () => false,
            dispatcher: {
                enqueue: async () => ({ messageId: 'a2a-3', replayed: false }),
                dispatch: async () => {
                    throw new Error('unused');
                },
            },
        });
        expect(result).toMatchObject({ delivery: 'unavailable', addressMatched: true });
        expect(result.delivery === 'unavailable' && result.reason).toContain('no A2A turn service');
    });
});
