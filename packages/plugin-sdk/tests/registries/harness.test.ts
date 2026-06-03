import { beforeEach, describe, expect, it } from 'bun:test';
import { getLogger } from '@gobing-ai/ts-infra';
import { PluginCollisionError } from '../../src/plugin';
import { type HarnessImpl, HarnessRegistry } from '../../src/registries/harness';
import { TrustEngine } from '../../src/trust';

// ── Constructor ──────────────────────────────────────────────────────────

function ctx(pluginName = 'test-plugin', trustLevel: 'bundled' | 'curated' | 'local' | 'untrusted' = 'curated') {
    return { source: trustLevel, pluginName, trustLevel };
}

function makeImpl(id: string): HarnessImpl {
    return {
        detect: () => true,
        execute: async (prompt: string) => `${id}: ${prompt}`,
    };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('HarnessRegistry', () => {
    let trust: TrustEngine;
    let registry: HarnessRegistry;

    beforeEach(() => {
        trust = new TrustEngine();
        registry = new HarnessRegistry(trust, getLogger('harness-registry'));
    });

    describe('register / get', () => {
        it('registers and retrieves an implementation', () => {
            const impl = makeImpl('openai');
            registry.register('openai', impl, ctx('p1'));
            expect(registry.get('openai')?.execute).toBe(impl.execute);
        });

        it('returns undefined for missing name', () => {
            expect(registry.get('nope')).toBeUndefined();
        });
    });

    describe('collision', () => {
        it('throws PluginCollisionError on duplicate name', () => {
            registry.register('claude', makeImpl('claude'), ctx('p1'));
            expect(() => registry.register('claude', makeImpl('claude-v2'), ctx('p2'))).toThrow(PluginCollisionError);
        });
    });

    describe('list', () => {
        it('lists all registered entries', () => {
            registry.register('codex', makeImpl('codex'), ctx('p1'));
            registry.register('claude', makeImpl('claude'), ctx('p2'));
            const list = registry.list();
            expect(list).toHaveLength(2);
            expect(list.map((e) => e.name).sort()).toEqual(['claude', 'codex']);
        });

        it('returns empty list when nothing registered', () => {
            expect(registry.list()).toEqual([]);
        });
    });

    describe('unregister', () => {
        it('removes a registered entry', () => {
            registry.register('gemini', makeImpl('gemini'), ctx('p1'));
            expect(registry.get('gemini')).toBeDefined();
            registry.unregister('gemini');
            expect(registry.get('gemini')).toBeUndefined();
        });

        it('is a no-op for missing name', () => {
            expect(() => registry.unregister('nope')).not.toThrow();
        });
    });

    describe('preRegister (built-in seeding)', () => {
        it('seeds a built-in and retrieves it via get', () => {
            registry.seedBuiltin('codex', makeImpl('codex'));
            expect(registry.get('codex')).toBeDefined();
        });

        it('lists seeded built-in with source builtin', () => {
            registry.seedBuiltin('claude', makeImpl('claude'));
            const list = registry.list();
            expect(list).toHaveLength(1);
            expect(list[0]?.source).toBe('builtin');
        });

        it('preserves built-in name collision', () => {
            registry.seedBuiltin('codex', makeImpl('codex'));
            expect(() => registry.seedBuiltin('codex', makeImpl('codex-v2'))).toThrow(PluginCollisionError);
        });

        it('plugin cannot override built-in', () => {
            registry.seedBuiltin('claude', makeImpl('claude'));
            expect(() => registry.register('claude', makeImpl('claude-v2'), ctx('p1'))).toThrow(PluginCollisionError);
        });
    });
});
