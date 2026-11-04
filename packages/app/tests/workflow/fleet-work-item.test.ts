import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import type { AgentRunDeps, AgentService } from '../../src/services/agent-service';
import type { TurnReceipt, WarmTurnDispatcher } from '../../src/services/warm-turn-dispatch';
import { runFleetWorkItem, writeFleetWorkItem } from '../../src/workflow/fleet-work-item';

// Failure modes: answer capture disappears at the fleet boundary; requireDiff is dropped;
// stage capabilities/identity flags vanish; malformed or foreign envelopes are accepted.
function service(stdout: string) {
    const invocations: Record<string, string | boolean>[] = [];
    const svc = {
        runTraced: async (_input: string, flags: Record<string, string | boolean>) => {
            invocations.push(flags);
            return {
                exitCode: 0,
                stdout,
                invocation: {
                    agent: 'claude',
                    source: 'default',
                    command: 'claude',
                    argv: [],
                    cwd: '/tmp',
                    mode: 'text',
                    outputMode: 'buffered',
                    continue: false,
                    stdinInteractive: false,
                },
            };
        },
    } as unknown as AgentService;
    return { svc, invocations };
}

test('fleet member captures the answer through the shared action contract', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fleet-contract-'));
    const db = await createMigratedDb({ url: ':memory:' });
    await writeFleetWorkItem(
        cwd,
        'parent',
        'review',
        {
            role: 'coder',
            session: 'reuse',
            input: 'Review the task',
            answerFile: '.spur/run/answer.txt',
            requiresCapabilities: { fsWrite: 'available' },
        },
        { wbs: '1232', sessionAffinity: 'true', '__session.coder.dir': join(cwd, 'existing-session') },
    );
    const { svc, invocations } = service('Verdict: PASS');
    const result = await runFleetWorkItem({
        cwd,
        recipient: 'member-1',
        key: 'parent/review',
        messageId: 'msg-1',
        flags: { agent: 'claude', 'run-id': 'child' },
        service: svc,
        getDb: async () => db,
    });
    expect(result?.ok).toBe(true);
    expect(readFileSync(join(cwd, '.spur/run/answer.txt'), 'utf8')).toContain('Verdict: PASS');
    expect(invocations[0]?.requiresCapabilities).toContain('fsWrite');
    expect(invocations[0]?.['run-id']).toBe('child');
    expect(invocations[0]?.['request-message']).toBeUndefined();
    expect(invocations[0]?.sessionDir).toBe(join(cwd, 'existing-session'));
    expect(result?.setVars?.['__session.coder.dir']).toBe(join(cwd, 'existing-session'));
});

test('fleet member enforces requireDiff instead of treating exit zero as completion', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fleet-contract-diff-'));
    const db = await createMigratedDb({ url: ':memory:' });
    await writeFleetWorkItem(cwd, 'parent', 'implement', { role: 'coder', input: 'Implement', requireDiff: true }, {});
    const result = await runFleetWorkItem({
        cwd,
        recipient: 'member-1',
        key: 'parent/implement',
        messageId: 'msg-1',
        flags: { agent: 'claude', 'run-id': 'child' },
        service: service('').svc,
        getDb: async () => db,
    });
    expect(result?.ok).toBe(false);
    expect(result?.data?.outcome).toBe('contract-violation');
});

test('1275 R1/R2: the turn dispatcher rides the deps bag and its receipt stays outside the contract verdict', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fleet-contract-turn-'));
    const db = await createMigratedDb({ url: ':memory:' });
    // requireDiff fails the contract while the turn reports a native `success`: AC1 requires the
    // two verdicts to be recorded SEPARATELY, never merged into one.
    await writeFleetWorkItem(cwd, 'parent', 'review', { role: 'reviewer', input: 'Review', requireDiff: true }, {});
    const receipt: TurnReceipt = {
        mode: 'warm',
        policyDigest: 'digest-1',
        acceptedAt: '2026-10-23T00:00:00.000Z',
        nativeOutcome: 'success',
        requestId: 'msg-1',
        attempt: 1,
        memberId: 'member-1',
        ownerEpoch: 4,
        occupantGeneration: 9,
    };
    const turn: WarmTurnDispatcher = {
        // The stub service never dispatches; this value only has to arrive intact.
        dispatchTurn: async () => ({ kind: 'fallback', reason: 'unsupported-agent' }),
        lastTurn: () => receipt,
    };
    let seenDeps: AgentRunDeps | undefined;
    let seenFlags: Record<string, string | boolean> | undefined;
    const svc = {
        runTraced: async (_input: string, flags: Record<string, string | boolean>, deps: AgentRunDeps) => {
            seenFlags = flags;
            seenDeps = deps;
            return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 };
        },
    } as unknown as AgentService;
    const phases: Array<{ phase: string; payload: Record<string, unknown> }> = [];

    const result = await runFleetWorkItem({
        cwd,
        recipient: 'member-1',
        key: 'parent/review',
        messageId: 'msg-1',
        flags: { agent: 'claude', 'run-id': 'child' },
        service: svc,
        getDb: async () => db,
        emitPhase: (phase, payload) => phases.push({ phase, payload }),
        turn,
    });

    // R1: the dispatcher reached the executor, and the declared role rides the flags so the
    // fresh-role guard (ADR-121) sees `reviewer` rather than an empty string.
    expect(seenDeps?.dispatchTurn).toBe(turn.dispatchTurn);
    expect(seenFlags?.role).toBe('reviewer');
    // AC1/R2: the native success is recorded, the contract verdict is separate and decides.
    expect(result?.ok).toBe(false);
    expect(result?.data?.outcome).toBe('contract-violation');
    expect(result?.data?.turn).toEqual(receipt);
    // R2: the phase timeline carries the settled turn as its own row, joined on the run ids.
    const settled = phases.find((entry) => entry.phase === 'turn-settled');
    expect(settled?.payload.turn).toEqual(receipt);
    expect(settled?.payload.runId).toBe('child');
});

test('ordinary and foreign keys do not read arbitrary work-item paths', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fleet-contract-key-'));
    const db = await createMigratedDb({ url: ':memory:' });
    for (const key of ['fleet:task:1232:1', '../outside/review']) {
        expect(
            await runFleetWorkItem({
                cwd,
                recipient: 'member-1',
                key,
                messageId: 'msg-1',
                flags: {},
                service: service('').svc,
                getDb: async () => db,
            }),
        ).toBeNull();
    }
});
