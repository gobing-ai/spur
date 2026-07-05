import { describe, expect, test } from 'bun:test';
import { PLANNING_EVENT_NAMES } from '../../../src/modules/events/event-names';

describe('PLANNING_EVENT_NAMES', () => {
    test('includes the core task lifecycle events', () => {
        expect(PLANNING_EVENT_NAMES).toContain('task.created');
        expect(PLANNING_EVENT_NAMES).toContain('task.updated');
        expect(PLANNING_EVENT_NAMES).toContain('task.transitioned');
    });

    test('includes the core feature lifecycle events', () => {
        expect(PLANNING_EVENT_NAMES).toContain('feature.created');
        expect(PLANNING_EVENT_NAMES).toContain('feature.updated');
        expect(PLANNING_EVENT_NAMES).toContain('feature.transitioned');
    });

    test('includes queue and scheduler lifecycle events', () => {
        expect(PLANNING_EVENT_NAMES).toContain('queue.job.enqueued');
        expect(PLANNING_EVENT_NAMES).toContain('queue.job.completed');
        expect(PLANNING_EVENT_NAMES).toContain('queue.job.failed');
        expect(PLANNING_EVENT_NAMES).toContain('scheduler.job.executed');
    });

    test('is a non-empty array of planning event names', () => {
        expect(Array.isArray(PLANNING_EVENT_NAMES)).toBe(true);
        expect(PLANNING_EVENT_NAMES.length).toBeGreaterThan(0);
        for (const name of PLANNING_EVENT_NAMES) {
            expect(typeof name).toBe('string');
            expect(name.length).toBeGreaterThan(0);
        }
    });
});
