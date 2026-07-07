import { describe, expect, test } from 'bun:test';
import {
    PLANNING_EVENT_NAMES,
    SYSTEM_EVENT_CATALOG,
    SYSTEM_EVENT_CATALOG_METADATA,
    SYSTEM_EVENT_DEFAULT_NAMES,
    SYSTEM_EVENT_DIAGNOSTIC_NAMES,
    SYSTEM_EVENT_NAMES,
    SYSTEM_EVENT_PERSISTED_NAMES,
    SYSTEM_EVENT_PREFIXES,
    SYSTEM_EVENT_STREAMED_NAMES,
} from '../../src/services/event-names';

describe('SYSTEM_EVENT_CATALOG', () => {
    test('includes the core task lifecycle events', () => {
        expect(SYSTEM_EVENT_NAMES).toContain('task.created');
        expect(SYSTEM_EVENT_NAMES).toContain('task.updated');
        expect(SYSTEM_EVENT_NAMES).toContain('task.transitioned');
    });

    test('includes the core feature lifecycle events', () => {
        expect(SYSTEM_EVENT_NAMES).toContain('feature.created');
        expect(SYSTEM_EVENT_NAMES).toContain('feature.updated');
        expect(SYSTEM_EVENT_NAMES).toContain('feature.transitioned');
    });

    test('includes queue and scheduler lifecycle events', () => {
        expect(SYSTEM_EVENT_NAMES).toContain('queue.job.enqueued');
        expect(SYSTEM_EVENT_NAMES).toContain('queue.job.completed');
        expect(SYSTEM_EVENT_NAMES).toContain('queue.job.failed');
        expect(SYSTEM_EVENT_NAMES).toContain('scheduler.job.executed');
    });

    test('includes message lifecycle events (task 0193/0204 — inbox IPC)', () => {
        // Adding these here flows to BOTH the system_events tap (persistence) and the
        // SSE stream (live board) — one source for both consumers.
        expect(SYSTEM_EVENT_NAMES).toContain('message.sent');
        expect(SYSTEM_EVENT_NAMES).toContain('message.replied');
    });

    test('includes workflow and HITL lifecycle events', () => {
        expect(SYSTEM_EVENT_NAMES).toContain('workflow.run.started');
        expect(SYSTEM_EVENT_NAMES).toContain('workflow.run.finalized');
        expect(SYSTEM_EVENT_NAMES).toContain('workflow.phase');
        expect(SYSTEM_EVENT_NAMES).toContain('workflow.transition');
        expect(SYSTEM_EVENT_NAMES).toContain('workflow.action.started');
        expect(SYSTEM_EVENT_NAMES).toContain('workflow.action.finished');
        expect(SYSTEM_EVENT_NAMES).toContain('workflow.hitl.ask');
        expect(SYSTEM_EVENT_NAMES).toContain('workflow.hitl.response');
    });

    test('has unique names and exposes DEFAULT/DIAGNOSTIC partition from the catalog', () => {
        expect(SYSTEM_EVENT_CATALOG.length).toBeGreaterThan(0);
        expect(new Set(SYSTEM_EVENT_NAMES).size).toBe(SYSTEM_EVENT_NAMES.length);
        // Diagnostic events are excluded from the persisted/streamed sets so the
        // tap and SSE filter them out by default (R5).
        expect(SYSTEM_EVENT_PERSISTED_NAMES.length).toBeLessThan(SYSTEM_EVENT_NAMES.length);
        expect(SYSTEM_EVENT_STREAMED_NAMES).toEqual(SYSTEM_EVENT_PERSISTED_NAMES);
        expect(PLANNING_EVENT_NAMES).toEqual(SYSTEM_EVENT_NAMES);
        // Diagnostic tier names are non-empty and disjoint from defaults.
        expect(SYSTEM_EVENT_DIAGNOSTIC_NAMES.length).toBeGreaterThan(0);
        const defaultSet = new Set(SYSTEM_EVENT_DEFAULT_NAMES);
        for (const name of SYSTEM_EVENT_DIAGNOSTIC_NAMES) expect(defaultSet.has(name)).toBe(false);
    });

    test('exposes prefix / renderer / tier metadata for the board', () => {
        expect(SYSTEM_EVENT_PREFIXES).toContain('task');
        expect(SYSTEM_EVENT_PREFIXES).toContain('workflow');
        expect(SYSTEM_EVENT_PREFIXES).toContain('rule');
        expect(SYSTEM_EVENT_PREFIXES).toContain('agent');
        expect(SYSTEM_EVENT_PREFIXES).toContain('bus');
        expect(SYSTEM_EVENT_CATALOG_METADATA).toContainEqual({
            name: 'workflow.action.started',
            prefix: 'workflow',
            source: 'workflow',
            tier: 'default',
            renderer: 'workflow-action',
        });
        expect(SYSTEM_EVENT_CATALOG_METADATA).toContainEqual({
            name: 'bus.handler.error',
            prefix: 'bus',
            source: 'bus',
            tier: 'diagnostic',
            renderer: 'bus',
        });
        for (const entry of SYSTEM_EVENT_CATALOG) {
            expect(entry.prefix.length).toBeGreaterThan(0);
            expect(entry.renderer.length).toBeGreaterThan(0);
            expect(entry.tier === 'default' || entry.tier === 'diagnostic').toBe(true);
            // `persisted` and `streamed` flags now describe catalog capability
            // (true for any tier that the runtime *can* persist or stream when
            // its tier gate is on). Tier is the runtime switch — diagnostic
            // entries' flags stay `true` so the tap can subscribe when the
            // `SPUR_DIAGNOSTIC_EVENTS` toggle fires.
            expect(entry.persisted).toBe(true);
            expect(entry.streamed).toBe(true);
        }
    });

    test('covers the new agent / rule / workflow engine / diagnostic families (task 0221)', () => {
        // agent.* (R3 producer wiring)
        for (const name of [
            'agent.invoke.start',
            'agent.invoke.exit',
            'agent.started',
            'agent.stopped',
            'agent.message.sent',
        ]) {
            expect(SYSTEM_EVENT_NAMES).toContain(name);
        }
        // rule.* (R3 producer wiring)
        for (const name of [
            'rule.run.start',
            'rule.eval.start',
            'rule.eval.done',
            'rule.eval.error',
            'rule.run.done',
        ]) {
            expect(SYSTEM_EVENT_NAMES).toContain(name);
        }
        // workflow.* native engine names (R4 alias policy)
        for (const name of [
            'workflow.run.started',
            'workflow.run.done',
            'workflow.run.failed',
            'workflow.run.paused',
            'workflow.run.resumed',
            'workflow.run.reseeded',
            'workflow.node.enter',
            'workflow.node.transition',
            'workflow.action.start',
            'workflow.action.done',
            'workflow.action.failed_continue',
            'workflow.guard.evaluated',
            'workflow.transition.requested',
            'workflow.transition.denied',
            'workflow.hitl.note',
            'workflow.custom',
        ]) {
            expect(SYSTEM_EVENT_NAMES).toContain(name);
        }
        // process.started via runtime executor (R3 process wiring)
        expect(SYSTEM_EVENT_NAMES).toContain('process.started');
        // api + bus diagnostic entries
        expect(SYSTEM_EVENT_NAMES).toContain('api.request.error');
        expect(SYSTEM_EVENT_DIAGNOSTIC_NAMES).toContain('bus.handler.error');
        expect(SYSTEM_EVENT_DIAGNOSTIC_NAMES).toContain('bus.emit.done');
        expect(SYSTEM_EVENT_DIAGNOSTIC_NAMES).toContain('bus.emit.noop');
        expect(SYSTEM_EVENT_DIAGNOSTIC_NAMES).toContain('bus.handler.async.enqueued');
    });
});
