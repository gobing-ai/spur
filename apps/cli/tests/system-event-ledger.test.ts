/**
 * Unit tests for `attachSystemEventLedger` (task 0370) — the CLI EventBus →
 * SystemEventDao bridge. Complements the workflow integration test; this file
 * covers attach failure isolation, diagnostic-tier gating, and correlation
 * column population without driving a full workflow run.
 */
import { describe, expect, test } from 'bun:test';
import type { SystemEventBus } from '@gobing-ai/spur-app';
import { SystemEventDao } from '@gobing-ai/spur-domain';
import { EventBus } from '@gobing-ai/ts-infra';
import { createMigratedDbAdapter } from '../src/context';
import { attachSystemEventLedger } from '../src/system-event-ledger';
import { type CapturedOutput, createCapturedOutput } from './helpers';

/** Minimal CliContext surface used by the ledger attach helper. */
function fakeContext(opts: { getDb?: () => Promise<unknown>; output?: CapturedOutput }): {
    context: { output: CapturedOutput; getDb: () => Promise<unknown> };
    output: CapturedOutput;
} {
    const output = opts.output ?? createCapturedOutput();
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

describe('attachSystemEventLedger', () => {
    test('swallows a getDb failure and returns a no-op handle (R5)', async () => {
        const { context, output } = fakeContext({
            getDb: async () => {
                throw new Error('unmigrated workspace');
            },
        });
        const bus = new EventBus() as SystemEventBus;

        const ledger = await attachSystemEventLedger(bus, context as never);
        // Must not throw on flush/unsubscribe — callers use finally unconditionally.
        await ledger.flush();
        ledger.unsubscribe();

        expect(output.errors.some((m) => m.includes('system_events ledger attach'))).toBe(true);
        expect(output.errors.some((m) => m.includes('unmigrated workspace'))).toBe(true);
    });

    test('stringifies a non-Error attach failure (R5)', async () => {
        const { context, output } = fakeContext({
            getDb: async () => {
                throw 'bare-string-failure';
            },
        });
        const bus = new EventBus() as SystemEventBus;
        const ledger = await attachSystemEventLedger(bus, context as never);
        await ledger.flush();
        ledger.unsubscribe();
        expect(output.errors.some((m) => m.includes('bare-string-failure'))).toBe(true);
    });

    test('persists a default-tier workflow event with run_id correlation (R1/R3)', async () => {
        const db = await createMigratedDbAdapter(undefined, undefined, ':memory:');
        try {
            const { context } = fakeContext({ getDb: async () => db });
            const bus = new EventBus() as SystemEventBus;
            const ledger = await attachSystemEventLedger(bus, context as never);

            bus.emit('workflow.run.started', {
                schemaVersion: 1,
                eventId: 'evt-1',
                sequence: 1,
                runId: 'run-corr-1',
                workflowName: 'cli-test-flow',
                at: '2026-07-28T12:00:00.000Z',
            });
            await ledger.flush();

            const rows = await new SystemEventDao(db).query({ limit: 50 });
            const started = rows.find((r) => r.event_name === 'workflow.run.started');
            expect(started).toBeDefined();
            expect(started?.run_id).toBe('run-corr-1');
            expect(started?.payload_json).toContain('cli-test-flow');

            ledger.unsubscribe();
        } finally {
            await db.close();
        }
    });

    test('diagnostic-tier workflow.agent is skipped when toggle is off (R6)', async () => {
        const db = await createMigratedDbAdapter(undefined, undefined, ':memory:');
        try {
            const { context } = fakeContext({ getDb: async () => db });
            const bus = new EventBus() as SystemEventBus;
            const ledger = await attachSystemEventLedger(bus, context as never, { diagnosticEnabled: false });

            bus.emit('workflow.agent', {
                schemaVersion: 1,
                eventId: 'evt-agent',
                sequence: 1,
                runId: 'run-diag',
                executionId: 'exec-1',
                kind: 'started',
                agent: 'pi',
                invocation: 'pi prompt',
                at: '2026-07-28T12:00:00.000Z',
            });
            await ledger.flush();

            const rows = await new SystemEventDao(db).query({ limit: 50 });
            expect(rows.some((r) => r.event_name === 'workflow.agent')).toBe(false);
            ledger.unsubscribe();
        } finally {
            await db.close();
        }
    });

    test('diagnostic-tier workflow.agent is persisted when toggle is on (R6)', async () => {
        const db = await createMigratedDbAdapter(undefined, undefined, ':memory:');
        try {
            const { context } = fakeContext({ getDb: async () => db });
            const bus = new EventBus() as SystemEventBus;
            const ledger = await attachSystemEventLedger(bus, context as never, { diagnosticEnabled: true });

            bus.emit('workflow.agent', {
                schemaVersion: 1,
                eventId: 'evt-agent-on',
                sequence: 1,
                runId: 'run-diag-on',
                executionId: 'exec-on',
                kind: 'started',
                agent: 'pi',
                invocation: 'pi prompt',
                at: '2026-07-28T12:00:00.000Z',
            });
            await ledger.flush();

            const rows = await new SystemEventDao(db).query({ limit: 50 });
            const agent = rows.find((r) => r.event_name === 'workflow.agent');
            expect(agent).toBeDefined();
            expect(agent?.run_id).toBe('run-diag-on');
            ledger.unsubscribe();
        } finally {
            await db.close();
        }
    });

    test('persists default-tier agent.invoke.start with run_id correlation (R1/R3)', async () => {
        // Direct `spur agent run` path: cataloged agent.* must land with run identity.
        const db = await createMigratedDbAdapter(undefined, undefined, ':memory:');
        try {
            const { context } = fakeContext({ getDb: async () => db });
            const bus = new EventBus() as SystemEventBus;
            const ledger = await attachSystemEventLedger(bus, context as never);

            bus.emit('agent.invoke.start', {
                schemaVersion: 1,
                eventId: 'evt-invoke-1',
                sequence: 1,
                runId: 'agent-run-corr',
                agent: 'pi',
                at: '2026-07-28T12:00:00.000Z',
            });
            await ledger.flush();

            const rows = await new SystemEventDao(db).query({ limit: 50 });
            const started = rows.find((r) => r.event_name === 'agent.invoke.start');
            expect(started).toBeDefined();
            expect(started?.run_id).toBe('agent-run-corr');
            ledger.unsubscribe();
        } finally {
            await db.close();
        }
    });

    test('persist failure is logged via the attach logger and does not throw (R5)', async () => {
        // Adapter that accepts open/migration-ish calls but fails on insert so the
        // SystemEventDao → tap → logger.warn path is exercised through attach.
        const adapter = {
            run: async () => {
                throw new Error('sqlite locked');
            },
            all: async () => [],
            get: async () => undefined,
            close: async () => {},
        };
        const { context, output } = fakeContext({ getDb: async () => adapter });
        const bus = new EventBus() as SystemEventBus;
        const ledger = await attachSystemEventLedger(bus, context as never);

        // Emit must not throw — the workflow run continues regardless.
        bus.emit('workflow.run.finalized', {
            schemaVersion: 1,
            eventId: 'evt-2',
            sequence: 2,
            runId: 'run-fail',
            status: 'done',
            at: '2026-07-28T12:00:01.000Z',
        });
        await ledger.flush();
        expect(output.errors.some((m) => m.includes('system_events tap: persist failed'))).toBe(true);
        expect(output.errors.some((m) => m.includes('sqlite locked'))).toBe(true);
        ledger.unsubscribe();
    });
});
