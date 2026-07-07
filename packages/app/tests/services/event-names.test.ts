import { describe, expect, test } from 'bun:test';
import {
    PLANNING_EVENT_NAMES,
    SYSTEM_EVENT_CATALOG,
    SYSTEM_EVENT_CATALOG_METADATA,
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

    test('has unique names and derives every consumer list from the catalog', () => {
        expect(SYSTEM_EVENT_CATALOG.length).toBeGreaterThan(0);
        expect(new Set(SYSTEM_EVENT_NAMES).size).toBe(SYSTEM_EVENT_NAMES.length);
        expect(SYSTEM_EVENT_PERSISTED_NAMES).toEqual(SYSTEM_EVENT_NAMES);
        expect(SYSTEM_EVENT_STREAMED_NAMES).toEqual(SYSTEM_EVENT_NAMES);
        expect(PLANNING_EVENT_NAMES).toEqual(SYSTEM_EVENT_NAMES);
    });

    test('exposes prefix and renderer metadata for the board', () => {
        expect(SYSTEM_EVENT_PREFIXES).toContain('task');
        expect(SYSTEM_EVENT_PREFIXES).toContain('workflow');
        expect(SYSTEM_EVENT_CATALOG_METADATA).toContainEqual({
            name: 'workflow.action.started',
            prefix: 'workflow',
            source: 'workflow',
            renderer: 'workflow-action',
        });
        for (const entry of SYSTEM_EVENT_CATALOG) {
            expect(entry.prefix.length).toBeGreaterThan(0);
            expect(entry.renderer.length).toBeGreaterThan(0);
        }
    });
});
