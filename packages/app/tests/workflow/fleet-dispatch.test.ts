import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentFleet } from '@gobing-ai/spur-config';
import type { FleetDispatcher, FleetDispatchRequest, FleetReceipt } from '../../src/services/fleet-dispatcher';
import type { FleetService, ResolvedFleet, ResolvedFleetMember } from '../../src/services/fleet-service';
import { dispatchToFleet, type FleetDispatchDeps, fleetUnavailableOutcome } from '../../src/workflow/fleet-dispatch';

/** Enabled coder/reviewer member fixture — desired state only, no liveness (R5). */
function member(overrides: Partial<ResolvedFleetMember> = {}): ResolvedFleetMember {
    return {
        instanceId: 'proj-m1',
        role: 'coder',
        executor: 'claude',
        enabled: true,
        writeCapable: true,
        capabilityState: 'enforced',
        ...overrides,
    };
}

/** Declaration fixture — dispatch reads only `enabled`/`strategy`; members come from `resolve`. */
function declaration(enabled = true, strategy: 'rest' | 'gtd' = 'rest'): AgentFleet {
    return { enabled, strategy, members: [] } as unknown as AgentFleet;
}

function fleetSvc(
    decl: AgentFleet | null,
    members: ResolvedFleetMember[],
    missing: string[] = [],
    projectPath = '/proj',
): FleetService {
    const resolved: ResolvedFleet = { projectPath, enabled: decl?.enabled === true, members, missing };
    return {
        load: async () => decl,
        resolve: async () => resolved,
    } as unknown as FleetService;
}

/**
 * Recording fake for the two dispatch seams the adapter uses. `sendFails` throws from the
 * enqueue; `failWait` throws from the receipt wait AFTER a successful enqueue — the
 * double-execution regression case (a landed message whose wait failed).
 */
function dispatcher(receipt: FleetReceipt | Error, opts: { failWait?: boolean } = {}) {
    const calls: { request: FleetDispatchRequest; timeoutMs: number }[] = [];
    let queued: FleetDispatchRequest | undefined;
    const fake = {
        enqueue: async (request: FleetDispatchRequest): Promise<{ messageId: string; replayed: boolean }> => {
            if (receipt instanceof Error) throw receipt;
            queued = request;
            return { messageId: 'msg-1', replayed: false };
        },
        awaitReceipt: async (
            _messageId: string,
            _member: string,
            waitOpts: { timeoutMs: number },
        ): Promise<FleetReceipt> => {
            if (opts.failWait === true) throw new Error('coordination receipt read failed');
            if (queued !== undefined) calls.push({ request: queued, timeoutMs: waitOpts.timeoutMs });
            if (receipt instanceof Error) throw receipt;
            return receipt;
        },
    };
    return { dispatcher: fake as unknown as Pick<FleetDispatcher, 'enqueue' | 'awaitReceipt'>, calls };
}

function deps(fleet: FleetService, dispatch: Pick<FleetDispatcher, 'enqueue' | 'awaitReceipt'>): FleetDispatchDeps {
    let tick = 0;
    return { fleet, dispatcher: dispatch, now: () => (tick += 10) };
}

const completed: FleetReceipt = { status: 'completed', messageId: 'msg-1', runId: 'run-1' };

/** Writable project dir for dispatches that reach the prompt-artifact write. */
const tempDirs: string[] = [];
function tempProject(): string {
    const dir = mkdtempSync(join(tmpdir(), 'fleet-'));
    tempDirs.push(dir);
    return dir;
}
afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('dispatchToFleet', () => {
    test('R1/R2: resolves the role-matching member, persists the prompt artifact and sends one keyed dispatch', async () => {
        const project = tempProject();
        const { dispatcher: dispatch, calls } = dispatcher(completed);
        const result = await dispatchToFleet(
            { role: 'coder', prompt: 'implement task 0942', projectPath: project, runId: 'run-1', state: 'impl' },
            deps(
                fleetSvc(declaration(), [
                    member({ instanceId: 'p-coder', role: 'coder' }),
                    member({ role: 'reviewer', instanceId: 'p-rev' }),
                ]),
                dispatch,
            ),
        );
        expect(result.status).toBe('completed');
        if (result.status !== 'completed') return;
        expect(result.memberId).toBe('p-coder');
        expect(result.messageId).toBe('msg-1');
        expect(result.runId).toBe('run-1');
        expect(result.durationMs).toBeGreaterThan(0);
        // The durable artifact carries the step prompt itself (ADR-057).
        expect(readFileSync(result.promptPath, 'utf8')).toBe('implement task 0942');
        expect(calls.length).toBe(1);
        // The sender is the dispatching RUN, never null: a member's reply needs a real fromId.
        expect(calls[0]?.request.fromId).toBe('workflow:run-1');
        expect(calls[0]?.request.member).toBe('p-coder');
        expect(calls[0]?.request.requestKey).toBe('run-1/impl');
        expect(calls[0]?.request.body).toContain('state: impl');
        expect(calls[0]?.request.body).toContain('role: coder');
        expect(calls[0]?.request.body).toContain(result.promptPath);
    });

    test('R1: an undeclared timeout waits unbounded rather than inventing a budget', async () => {
        const { dispatcher: dispatch, calls } = dispatcher(completed);
        await dispatchToFleet(
            { role: 'coder', prompt: 'x', projectPath: tempProject(), runId: 'r', state: 's' },
            deps(fleetSvc(declaration(), [member()]), dispatch),
        );
        expect(calls[0]?.timeoutMs).toBe(Number.POSITIVE_INFINITY);
    });

    test('R2: a declared expectFile that never appeared after completion is failed(missing-artifact)', async () => {
        const project = tempProject();
        const { dispatcher: dispatch } = dispatcher(completed);
        const result = await dispatchToFleet(
            { role: 'coder', prompt: 'x', projectPath: project, expectFile: 'out/verdict.md', runId: 'r', state: 's' },
            deps(fleetSvc(declaration(), [member()]), dispatch),
        );
        expect(result).toEqual({
            status: 'failed',
            memberId: 'proj-m1',
            messageId: 'msg-1',
            reason: 'missing-artifact',
            runId: 'run-1',
        });
    });

    test('R2: an errored receipt is failed(errored)', async () => {
        const { dispatcher: dispatch } = dispatcher({ status: 'failed', messageId: 'msg-1', runId: 'run-2' });
        const result = await dispatchToFleet(
            { role: 'coder', prompt: 'x', projectPath: tempProject(), runId: 'r', state: 's' },
            deps(fleetSvc(declaration(), [member()]), dispatch),
        );
        expect(result).toEqual({
            status: 'failed',
            memberId: 'proj-m1',
            messageId: 'msg-1',
            reason: 'errored',
            runId: 'run-2',
        });
    });

    test('R2: a not-started receipt is reported as such, never as a failure', async () => {
        const { dispatcher: dispatch } = dispatcher({ status: 'not-started', messageId: 'msg-1' });
        const result = await dispatchToFleet(
            { role: 'coder', prompt: 'x', projectPath: tempProject(), runId: 'r', state: 's' },
            deps(fleetSvc(declaration(), [member()]), dispatch),
        );
        expect(result).toEqual({ status: 'not-started', memberId: 'proj-m1', messageId: 'msg-1' });
    });

    test('R2: an outcome-unknown wait is neither failed nor re-dispatched', async () => {
        const { dispatcher: dispatch, calls } = dispatcher({ status: 'outcome-unknown', messageId: 'msg-1' });
        const result = await dispatchToFleet(
            { role: 'coder', prompt: 'x', projectPath: tempProject(), runId: 'r', state: 's' },
            deps(fleetSvc(declaration(), [member()]), dispatch),
        );
        expect(result).toEqual({ status: 'outcome-unknown', memberId: 'proj-m1', messageId: 'msg-1' });
        expect(calls.length).toBe(1);
    });

    test('R1: no enabled member for the role is an unavailable value naming the role, not an exception', async () => {
        const { dispatcher: dispatch, calls } = dispatcher(completed);
        const result = await dispatchToFleet(
            { role: 'reviewer', prompt: 'review', projectPath: '/proj', runId: 'r', state: 's' },
            deps(fleetSvc(declaration(), [member({ role: 'coder' })], ['no-enabled-members']), dispatch),
        );
        expect(result).toEqual({ status: 'unavailable', reason: expect.stringContaining("role 'reviewer'") });
        expect(calls.length).toBe(0);
    });

    test('R1: a disabled fleet is unavailable before any send', async () => {
        const { dispatcher: dispatch, calls } = dispatcher(completed);
        const result = await dispatchToFleet(
            { role: 'coder', prompt: 'x', projectPath: '/proj', runId: 'r', state: 's' },
            deps(fleetSvc(declaration(false), [member()]), dispatch),
        );
        expect(result).toEqual({ status: 'unavailable', reason: expect.stringContaining('disabled') });
        expect(calls.length).toBe(0);
    });

    test('R1: no agent.fleet declaration is unavailable with the fix named', async () => {
        const { dispatcher: dispatch, calls } = dispatcher(completed);
        const result = await dispatchToFleet(
            { role: 'coder', prompt: 'x', projectPath: '/proj', runId: 'r', state: 's' },
            deps(fleetSvc(null, [], ['no-declaration']), dispatch),
        );
        expect(result).toEqual({ status: 'unavailable', reason: expect.stringContaining('agent.fleet') });
        expect(calls.length).toBe(0);
    });

    test('ADR-121: a reviewer dispatch rejects every member carrying a reusable session BEFORE send', async () => {
        const { dispatcher: dispatch, calls } = dispatcher(completed);
        const result = await dispatchToFleet(
            { role: 'reviewer', prompt: 'review', projectPath: '/proj', runId: 'r', state: 's' },
            deps(
                fleetSvc(declaration(), [
                    member({ instanceId: 'p-rev', role: 'reviewer', session: { mode: 'persistent' } }),
                    member({ instanceId: 'p-rev2', role: 'reviewer', session: { mode: 'resume' } }),
                ]),
                dispatch,
            ),
        );
        expect(result).toEqual({ status: 'unavailable', reason: expect.stringContaining('ADR-121') });
        expect(calls.length).toBe(0);
    });

    test('ADR-121: a one-shot member counts as fresh for a reviewer dispatch', async () => {
        const { dispatcher: dispatch, calls } = dispatcher(completed);
        const result = await dispatchToFleet(
            { role: 'reviewer', prompt: 'review', projectPath: tempProject(), runId: 'r', state: 's' },
            deps(fleetSvc(declaration(), [member({ role: 'reviewer', session: { mode: 'one-shot' } })]), dispatch),
        );
        expect(result.status).toBe('completed');
        expect(calls.length).toBe(1);
    });

    test('R1: gtd prefers the member without a session in flight; rest keeps declaration order', async () => {
        const busy = member({ instanceId: 'p-busy', session: { mode: 'persistent' } });
        const fresh = member({ instanceId: 'p-idle' });
        const a = dispatcher(completed);
        await dispatchToFleet(
            { role: 'coder', prompt: 'x', projectPath: tempProject(), runId: 'r', state: 's' },
            deps(fleetSvc(declaration(true, 'gtd'), [busy, fresh]), a.dispatcher),
        );
        expect(a.calls[0]?.request.member).toBe('p-idle');
        const b = dispatcher(completed);
        await dispatchToFleet(
            { role: 'coder', prompt: 'x', projectPath: tempProject(), runId: 'r', state: 's' },
            deps(fleetSvc(declaration(true, 'rest'), [busy, fresh]), b.dispatcher),
        );
        expect(b.calls[0]?.request.member).toBe('p-busy');
    });

    test('R2: a receipt wait that throws AFTER a landed send is outcome-unknown — never a fallback-eligible unavailable', async () => {
        const { dispatcher: dispatch } = dispatcher(completed, { failWait: true });
        const result = await dispatchToFleet(
            { role: 'coder', prompt: 'x', projectPath: tempProject(), runId: 'r', state: 's' },
            deps(fleetSvc(declaration(), [member()]), dispatch),
        );
        // The message is queued and the member may already be working: reporting
        // `unavailable` here would let `executorFallback: traditional` re-run the stage
        // and execute the same request twice.
        expect(result).toEqual({ status: 'outcome-unknown', memberId: 'proj-m1', messageId: 'msg-1' });
    });

    test('R3: a failing send reads as an unavailable value naming the member, never a throw', async () => {
        const { dispatcher: dispatch } = dispatcher(new Error('inbox db locked'));
        const result = await dispatchToFleet(
            { role: 'coder', prompt: 'x', projectPath: tempProject(), runId: 'r', state: 's' },
            deps(fleetSvc(declaration(), [member()]), dispatch),
        );
        expect(result).toEqual({ status: 'unavailable', reason: expect.stringContaining('inbox db locked') });
    });
});

describe('fleetUnavailableOutcome', () => {
    test('falls back ONLY when executorFallback is declared traditional', () => {
        expect(fleetUnavailableOutcome('fleet is disabled', 'traditional')).toEqual({
            mode: 'fallback',
            fallbackReason: 'fleet is disabled',
        });
    });

    test('otherwise fails explicitly with the 0937 failed-agent reason', () => {
        const outcome = fleetUnavailableOutcome('fleet is disabled', undefined);
        expect(outcome.mode).toBe('fail');
        if (outcome.mode !== 'fail') return;
        expect(outcome.error).toContain('failed-agent');
        expect(outcome.error).toContain('fleet is disabled');
    });
});
