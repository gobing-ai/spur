import { describe, expect, test } from 'bun:test';
import { parseSteeringPolicy, type SteeringCommand, WorkflowSteeringController } from '../../src/workflow/steering';

function command(
    controller: WorkflowSteeringController,
    operation: SteeringCommand['operation'],
    overrides: Partial<SteeringCommand> = {},
): SteeringCommand {
    const snapshot = controller.snapshot;
    if (snapshot === undefined) throw new Error('expected active steering snapshot');
    return {
        commandId: crypto.randomUUID(),
        runId: snapshot.runId,
        actionId: snapshot.actionId,
        expectedState: snapshot.state,
        expectedVersion: snapshot.version,
        operation,
        actor: 'operator',
        deadlineAt: new Date(Date.now() + 1000).toISOString(),
        ...overrides,
    };
}

describe('WorkflowSteeringController', () => {
    test('acknowledges one safe boundary command and rejects its duplicate', async () => {
        const controller = new WorkflowSteeringController();
        controller.begin('run-1', 'action-1', { boundary: true, timeoutMs: 1000 });
        const decision = controller.boundary(true);
        const continueCommand = command(controller, 'continue');

        expect(controller.submit(continueCommand)).toMatchObject({
            accepted: true,
            operation: 'continue',
            actor: 'operator',
        });
        expect(await decision).toEqual({ operation: 'continue' });
        expect(controller.submit(continueCommand)).toMatchObject({
            accepted: false,
            reason: 'duplicate command',
        });
    });

    test('acknowledgement retains only the redacted note and actor for durable audit', async () => {
        const controller = new WorkflowSteeringController(undefined, ['known-secret']);
        controller.begin('run-note', 'action-note', { boundary: true, timeoutMs: 1000 });
        const decision = controller.boundary(true);

        expect(
            controller.submit(
                command(controller, 'note', {
                    note: 'checkpoint token=known-secret',
                }),
            ),
        ).toMatchObject({
            accepted: true,
            actor: 'operator',
            note: 'checkpoint [REDACTED]',
        });
        expect(await decision).toEqual({ operation: 'note', note: 'checkpoint [REDACTED]' });
    });

    test('rejects stale, unauthorized, expired, mistargeted, and unsafe retry requests', async () => {
        const controller = new WorkflowSteeringController();
        controller.begin('run-2', 'action-2', { boundary: true, timeoutMs: 1000 });
        const decision = controller.boundary(false);

        expect(controller.submit(command(controller, 'retry', { expectedVersion: 1 }))).toMatchObject({
            accepted: false,
            reason: 'stale state or version',
        });
        expect(controller.submit(command(controller, 'retry', { actor: 'remote' }))).toMatchObject({
            accepted: false,
            reason: 'unauthorized actor',
        });
        expect(
            controller.submit(command(controller, 'retry', { deadlineAt: '2020-01-01T00:00:00.000Z' })),
        ).toMatchObject({ accepted: false, reason: 'command deadline elapsed' });
        expect(controller.submit(command(controller, 'retry', { deadlineAt: 'not-a-date' }))).toMatchObject({
            accepted: false,
            reason: 'invalid command deadline',
        });
        expect(controller.submit(command(controller, 'retry', { actionId: 'other' }))).toMatchObject({
            accepted: false,
            reason: 'target does not match the active action',
        });
        expect(controller.submit(command(controller, 'retry'))).toMatchObject({
            accepted: false,
            reason: 'unsafe retry: no explicit idempotent retry policy',
        });
        controller.submit(command(controller, 'continue'));
        await decision;
    });

    test('rejects empty command identity, empty notes, and mutation after completion', async () => {
        const controller = new WorkflowSteeringController();
        controller.begin('run-safe', 'action-safe', { boundary: true, timeoutMs: 1000 });
        const decision = controller.boundary(true);

        expect(controller.submit(command(controller, 'continue', { commandId: ' ' }))).toMatchObject({
            accepted: false,
            reason: 'command id is required',
        });
        expect(controller.submit(command(controller, 'note', { note: '   ' }))).toMatchObject({
            accepted: false,
            reason: 'note text is required',
        });
        controller.submit(command(controller, 'continue'));
        await decision;
        controller.complete();

        expect(controller.submit(command(controller, 'abort'))).toMatchObject({
            accepted: false,
            reason: 'completed action history is immutable',
        });
    });

    test('permits explicitly idempotent retry without mutating the completed attempt', async () => {
        const controller = new WorkflowSteeringController();
        controller.begin('run-3', 'action-3', {
            boundary: true,
            timeoutMs: 1000,
            retry: { idempotent: true, maxAttempts: 2 },
        });
        const decision = controller.boundary(false);

        expect(controller.submit(command(controller, 'retry'))).toMatchObject({ accepted: true });
        expect(await decision).toEqual({ operation: 'retry' });
        const nextSignal = controller.nextAttempt();
        expect(nextSignal.aborted).toBe(false);
        expect(controller.snapshot).toMatchObject({ state: 'running', version: 3 });
    });

    test('abort propagates immediately to the active child signal', async () => {
        const controller = new WorkflowSteeringController();
        const signal = controller.begin('run-4', 'action-4', { boundary: true, timeoutMs: 1000 });

        expect(controller.submit(command(controller, 'abort'))).toMatchObject({ accepted: true });
        expect(signal.aborted).toBe(true);
        expect(await controller.boundary(false)).toEqual({ operation: 'abort' });
    });

    test('boundary timeout defaults deterministically to continue', async () => {
        const acks: Array<{ actor: string; reason?: string }> = [];
        const controller = new WorkflowSteeringController((ack) =>
            acks.push({ actor: ack.actor, ...(ack.reason !== undefined ? { reason: ack.reason } : {}) }),
        );
        controller.begin('run-5', 'action-5', { boundary: true, timeoutMs: 5 });

        await expect(controller.boundary(true)).resolves.toEqual({ operation: 'continue' });
        expect(acks).toContainEqual({
            actor: 'system-timeout',
            reason: 'boundary timeout defaulted to continue',
        });
    });
});

describe('parseSteeringPolicy', () => {
    test('accepts only explicit idempotent retry declarations', () => {
        expect(
            parseSteeringPolicy({
                steeringBoundary: true,
                steeringTimeoutMs: 100,
                retryPolicy: { idempotent: true, maxAttempts: 3 },
            }),
        ).toEqual({
            boundary: true,
            timeoutMs: 100,
            retry: { idempotent: true, maxAttempts: 3 },
        });
        expect(parseSteeringPolicy({ retryPolicy: { idempotent: false, maxAttempts: 3 } }).retry).toBeUndefined();
    });

    test('bounds timeout and retry policy values and rejects non-finite timers', () => {
        expect(
            parseSteeringPolicy({
                steeringBoundary: true,
                steeringTimeoutMs: Number.POSITIVE_INFINITY,
                retryPolicy: { idempotent: true, maxAttempts: Number.POSITIVE_INFINITY },
            }),
        ).toEqual({ boundary: true, timeoutMs: 30_000 });
        expect(
            parseSteeringPolicy({
                steeringTimeoutMs: 999_999,
                retryPolicy: { idempotent: true, maxAttempts: 999 },
            }),
        ).toEqual({
            boundary: false,
            timeoutMs: 300_000,
            retry: { idempotent: true, maxAttempts: 10 },
        });
    });
});
