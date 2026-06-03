import { beforeEach, describe, expect, it } from 'bun:test';
import { getLogger } from '@gobing-ai/ts-infra';
import { PluginCollisionError } from '../../src/plugin';
import { type WorkerImpl, WorkerRegistry } from '../../src/registries/worker';
import { TrustEngine } from '../../src/trust';

// ── Helpers ──────────────────────────────────────────────────────────

function ctx(pluginName = 'test-plugin', trustLevel: 'bundled' | 'curated' | 'local' | 'untrusted' = 'curated') {
    return { pluginName, trustLevel, source: trustLevel as 'bundled' | 'curated' | 'local' | 'untrusted' };
}

function makeImpl(label: string): WorkerImpl {
    return { process: async (payload: unknown) => ({ worker: label, result: payload }) };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('WorkerRegistry', () => {
    let trust: TrustEngine;
    let registry: WorkerRegistry;

    beforeEach(() => {
        trust = new TrustEngine();
        registry = new WorkerRegistry(trust, getLogger('worker-registry-test'));
    });

    describe('register / get', () => {
        it('stores and retrieves an impl', () => {
            const impl = makeImpl('compress');
            registry.register('compress', impl, ctx());
            const got = registry.get('compress');
            expect(got).toBe(impl);
        });

        it('returns undefined for missing entry', () => {
            expect(registry.get('nonexistent')).toBeUndefined();
        });
    });

    describe('collision', () => {
        it('throws PluginCollisionError on duplicate name', () => {
            registry.register('compress', makeImpl('first'), ctx('plugin-a'));
            expect(() => registry.register('compress', makeImpl('second'), ctx('plugin-b'))).toThrow(
                PluginCollisionError,
            );
        });
    });

    describe('list', () => {
        it('returns all registered entries with name and source', () => {
            registry.register('compress', makeImpl('c'), ctx('plugin-a'));
            registry.register('transform', makeImpl('t'), ctx('plugin-b'));
            const entries = registry.list();
            expect(entries).toHaveLength(2);
            expect(entries).toContainEqual({ name: 'compress', source: 'curated' });
            expect(entries).toContainEqual({ name: 'transform', source: 'curated' });
        });

        it('returns empty array when nothing registered', () => {
            expect(registry.list()).toEqual([]);
        });
    });

    describe('preRegister (built-in seeding)', () => {
        it('seeds a built-in and retrieves it via get()', () => {
            const impl = makeImpl('builtin-worker');
            registry.seedBuiltin('builtin-worker', impl);
            expect(registry.get('builtin-worker')).toBe(impl);
        });

        it('built-in appears as source builtin in list', () => {
            registry.seedBuiltin('core', makeImpl('core'));
            expect(registry.list()).toEqual([{ name: 'core', source: 'builtin' }]);
        });

        it('plugin registration on top of built-in throws collision', () => {
            registry.seedBuiltin('core', makeImpl('core'));
            expect(() => registry.register('core', makeImpl('override'), ctx())).toThrow(PluginCollisionError);
        });

        it('duplicate built-in names collide', () => {
            registry.seedBuiltin('only', makeImpl('first'));
            expect(() => registry.seedBuiltin('only', makeImpl('second'))).toThrow(PluginCollisionError);
        });
    });
});
