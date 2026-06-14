import { describe, expect, test } from 'bun:test';
import type { EntityRef } from '../../src/services/planning-write-service';
import { LifecycleAdapter } from '../../src/workflow/lifecycle-adapter';

describe('LifecycleAdapter', () => {
    const makeRef = (wbs: string): EntityRef => ({
        kind: 'task',
        id: wbs,
        filePath: `/tasks/${wbs}.md`,
        folder: '/tasks',
    });

    test('allows valid status transitions (schema fallback)', () => {
        const adapter = new LifecycleAdapter();
        const result = adapter.requestTransition(makeRef('0001'), 'todo', 'wip');
        expect(result.allowed).toBe(true);
        expect(result.from).toBe('todo');
        expect(result.to).toBe('wip');
    });

    test('denies same-status transition', () => {
        const adapter = new LifecycleAdapter();
        const result = adapter.requestTransition(makeRef('0001'), 'todo', 'todo');
        expect(result.allowed).toBe(false);
        expect(result.report).toBe('already in this status');
    });

    test('rehydrateIfNeeded is a no-op without engine', async () => {
        const adapter = new LifecycleAdapter();
        // Should not throw
        await adapter.rehydrateIfNeeded(makeRef('0001'), 'wip');
    });

    test('constructs without options', () => {
        const adapter = new LifecycleAdapter();
        expect(adapter).toBeInstanceOf(LifecycleAdapter);
    });
});
