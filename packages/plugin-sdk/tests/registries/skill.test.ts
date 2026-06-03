import { beforeEach, describe, expect, it } from 'bun:test';
import { getLogger } from '@gobing-ai/ts-infra';
import { PluginCollisionError } from '../../src/plugin';
import { type SkillImpl, SkillRegistry } from '../../src/registries/skill';
import { TrustEngine } from '../../src/trust';

// ── Helpers ──────────────────────────────────────────────────────────

function ctx(pluginName = 'test-plugin', trustLevel: 'bundled' | 'curated' | 'local' | 'untrusted' = 'curated') {
    return { pluginName, trustLevel, source: trustLevel as 'bundled' | 'curated' | 'local' | 'untrusted' };
}

function makeImpl(label: string): SkillImpl {
    return { invoke: async (args: string[]) => `skill:${label} args:${args.join(',')}` };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('SkillRegistry', () => {
    let trust: TrustEngine;
    let registry: SkillRegistry;

    beforeEach(() => {
        trust = new TrustEngine();
        registry = new SkillRegistry(trust, getLogger('skill-registry-test'));
    });

    describe('register / get', () => {
        it('stores and retrieves an impl', () => {
            const impl = makeImpl('echo');
            registry.register('echo', impl, ctx());
            const got = registry.get('echo');
            expect(got).toBe(impl);
        });

        it('returns undefined for missing entry', () => {
            expect(registry.get('nonexistent')).toBeUndefined();
        });
    });

    describe('collision', () => {
        it('throws PluginCollisionError on duplicate name', () => {
            registry.register('echo', makeImpl('first'), ctx('plugin-a'));
            expect(() => registry.register('echo', makeImpl('second'), ctx('plugin-b'))).toThrow(PluginCollisionError);
        });
    });

    describe('list', () => {
        it('returns all registered entries with name and source', () => {
            registry.register('alpha', makeImpl('a'), ctx('plugin-a'));
            registry.register('beta', makeImpl('b'), ctx('plugin-b'));
            const entries = registry.list();
            expect(entries).toHaveLength(2);
            expect(entries).toContainEqual({ name: 'alpha', source: 'curated' });
            expect(entries).toContainEqual({ name: 'beta', source: 'curated' });
        });

        it('returns empty array when nothing registered', () => {
            expect(registry.list()).toEqual([]);
        });
    });

    describe('preRegister (built-in seeding)', () => {
        it('seeds a built-in and retrieves it via get()', () => {
            const impl = makeImpl('builtin-skill');
            registry.seedBuiltin('builtin-skill', impl);
            expect(registry.get('builtin-skill')).toBe(impl);
        });

        it('built-in appears as source builtin in list', () => {
            registry.seedBuiltin('core', makeImpl('core'));
            expect(registry.list()).toEqual([{ name: 'core', source: 'builtin' }]);
        });

        it('built-in can be overwritten by unregister + register (not collision on seed)', () => {
            registry.seedBuiltin('core', makeImpl('core'));
            // A plugin registering same name after built-in is a collision
            expect(() => registry.register('core', makeImpl('override'), ctx())).toThrow(PluginCollisionError);
        });

        it('duplicate built-in names collide', () => {
            registry.seedBuiltin('only', makeImpl('first'));
            expect(() => registry.seedBuiltin('only', makeImpl('second'))).toThrow(PluginCollisionError);
        });
    });
});
