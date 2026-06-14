import { describe, expect, test } from 'bun:test';
import type { EntityRef } from '../../src/services/planning-write-service';
import { FeatureLifecycleAdapter } from '../../src/workflow/feature-lifecycle-adapter';

describe('FeatureLifecycleAdapter', () => {
    const makeRef = (id: string): EntityRef => ({
        kind: 'feature',
        id,
        filePath: `/features/${id}.md`,
        folder: '/features',
    });

    const featureStatuses: string[] = ['backlog', 'active', 'verifying', 'blocked', 'done', 'cancelled'];

    test('allows valid status transitions (schema fallback)', () => {
        const adapter = new FeatureLifecycleAdapter();
        const result = adapter.requestTransition(makeRef('F1'), 'backlog', 'active');
        expect(result.allowed).toBe(true);
        expect(result.from).toBe('backlog');
        expect(result.to).toBe('active');
    });

    test('denies same-status transition', () => {
        const adapter = new FeatureLifecycleAdapter();
        const result = adapter.requestTransition(makeRef('F1'), 'active', 'active');
        expect(result.allowed).toBe(false);
        expect(result.report).toBe('already in this status');
    });

    test('denies unknown target status', () => {
        const adapter = new FeatureLifecycleAdapter();
        const result = adapter.requestTransition(makeRef('F1'), 'backlog', 'nonexistent');
        expect(result.allowed).toBe(false);
        expect(result.report).toContain('unknown feature status');
        expect(result.report).toContain('nonexistent');
    });

    test('allows all canonical feature status transitions (vocabulary gate only)', () => {
        const adapter = new FeatureLifecycleAdapter();
        for (const to of featureStatuses) {
            const result = adapter.requestTransition(makeRef('F1'), 'backlog', to);
            if (to === 'backlog') {
                expect(result.allowed).toBe(false);
                expect(result.report).toBe('already in this status');
            } else {
                expect(result.allowed).toBe(true);
            }
        }
    });

    test('rehydrateIfNeeded is a no-op without engine', async () => {
        const adapter = new FeatureLifecycleAdapter();
        // Should not throw
        await adapter.rehydrateIfNeeded(makeRef('F1'), 'active');
    });

    test('constructs without options', () => {
        const adapter = new FeatureLifecycleAdapter();
        expect(adapter).toBeInstanceOf(FeatureLifecycleAdapter);
    });

    test('constructs with empty options', () => {
        const adapter = new FeatureLifecycleAdapter({});
        expect(adapter).toBeInstanceOf(FeatureLifecycleAdapter);
    });

    test('implements LifecyclePort interface', () => {
        const adapter = new FeatureLifecycleAdapter();
        expect(typeof adapter.requestTransition).toBe('function');
        expect(typeof adapter.rehydrateIfNeeded).toBe('function');
    });

    test('rehydrateIfNeeded accepts valid feature statuses', async () => {
        const adapter = new FeatureLifecycleAdapter();
        for (const status of featureStatuses) {
            await adapter.rehydrateIfNeeded(makeRef('F1'), status);
        }
    });
});
