/**
 * Unit tests for `makePlanningEmitter` (task 0249) — the lazy CLI emitter
 * factory that wraps {@link SystemEventEmitter} with warn-and-swallow
 * semantics so file mutations never roll back on a sink failure (R5).
 *
 * The integration test (`planning-system-events.test.ts`) covers the happy
 * path against a real SQLite ledger; this file covers the failure paths that
 * the per-file 90/90 gate requires: lazy DB resolution failure and the warn
 * logger routing.
 */
import { describe, expect, test } from 'bun:test';
import type { EventEmitter, PlanningEvent } from '@gobing-ai/spur-app';
import { makePlanningEmitter } from '../../src/planning-emitter';
import { type CapturedOutput, createCapturedOutput } from '../helpers';

/** Minimal fake CliContext — only `output` and `getDb` are touched by the emitter. */
function fakeContext(opts: { getDb?: () => Promise<unknown> } = {}): {
    context: { output: CapturedOutput; getDb: () => Promise<unknown> };
    output: CapturedOutput;
} {
    const output = createCapturedOutput();
    return {
        output,
        context: {
            output,
            getDb:
                opts.getDb ??
                (async () => {
                    throw new Error('no getDb configured');
                }),
        },
    };
}

function makeEvent(): PlanningEvent {
    return {
        event: 'task.created',
        entity: { kind: 'task', id: '0001' },
        at: new Date().toISOString(),
    };
}

describe('makePlanningEmitter', () => {
    test('emit swallows a lazy DB resolution failure and routes to output.error (R5)', async () => {
        const { context, output } = fakeContext({
            getDb: async () => {
                throw new Error('unmigrated workspace');
            },
        });
        const emitter: EventEmitter = makePlanningEmitter(context as never);

        // Must not throw — the file mutation has already succeeded upstream.
        await emitter.emit(makeEvent());

        expect(output.errors.length).toBeGreaterThanOrEqual(1);
        expect(output.errors.some((m) => m.includes('system_events emitter'))).toBe(true);
        expect(output.errors.some((m) => m.includes('unmigrated workspace'))).toBe(true);
    });

    test('emit logs a warn message when the DAO insert fails (R5 warn logger path)', async () => {
        // SystemEventDao calls db.run; a throwing run surfaces inside
        // SystemEventEmitter.emit, which logs via its warn logger (routed to
        // output.error) and swallows — then makePlanningEmitter's catch also fires.
        const throwingAdapter = {
            run: async () => {
                throw new Error('sqlite locked');
            },
        };
        const { context, output } = fakeContext({
            getDb: async () => throwingAdapter,
        });
        const emitter: EventEmitter = makePlanningEmitter(context as never);

        await emitter.emit(makeEvent());

        // SystemEventEmitter logs via its warn logger (routed to output.error),
        // then makePlanningEmitter's catch also fires for the same failure.
        expect(output.errors.length).toBeGreaterThanOrEqual(1);
        expect(output.errors.some((m) => m.includes('sqlite locked'))).toBe(true);
    });

    test('emit resolves lazily — getDb is not called until the first emit (R4 lazy)', async () => {
        let calls = 0;
        const { context } = fakeContext({
            getDb: async () => {
                calls++;
                return { run: async () => {}, all: async () => [], get: async () => undefined };
            },
        });
        const emitter: EventEmitter = makePlanningEmitter(context as never);

        expect(calls).toBe(0);
        await emitter.emit(makeEvent());
        expect(calls).toBe(1);
        // Second emit reuses the cached emitter — getDb stays at 1.
        await emitter.emit(makeEvent());
        expect(calls).toBe(1);
    });
});
