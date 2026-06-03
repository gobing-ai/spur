import { beforeEach, describe, expect, it } from 'bun:test';
import { getLogger } from '@gobing-ai/ts-infra';
import { PluginCollisionError } from '../../src/plugin';
import type { Provider } from '../../src/registries/provider';
import { ProviderRegistry } from '../../src/registries/provider';
import { TrustEngine } from '../../src/trust';

// ── Helpers ──────────────────────────────────────────────────────────

function ctx(pluginName = 'test-plugin', trustLevel: 'bundled' | 'curated' | 'local' | 'untrusted' = 'curated') {
    return {
        source: trustLevel as 'bundled' | 'curated' | 'local',
        pluginName,
        trustLevel,
    };
}

function makeProvider(id: string): Provider {
    const store = new Map<string, unknown>([['id', id]]);
    return {
        provide: <T>(key: string): T => store.get(key) as T,
    };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ProviderRegistry', () => {
    let trust: TrustEngine;
    let registry: ProviderRegistry;

    beforeEach(() => {
        trust = new TrustEngine();
        registry = new ProviderRegistry(trust, getLogger('provider-registry'));
    });

    describe('register / get', () => {
        it('registers and retrieves a provider', () => {
            const provider = makeProvider('auth');
            registry.register('auth', provider, ctx());

            const resolved = registry.get('auth');
            expect(resolved).toBeDefined();
            expect(resolved?.provide<string>('id')).toBe('auth');
        });

        it('returns undefined for unknown name', () => {
            expect(registry.get('missing')).toBeUndefined();
        });
    });

    describe('collision', () => {
        it('throws PluginCollisionError on duplicate name', () => {
            registry.register('auth', makeProvider('first'), ctx('plugin-a'));
            expect(() => {
                registry.register('auth', makeProvider('second'), ctx('plugin-b'));
            }).toThrow(PluginCollisionError);
        });
    });

    describe('list', () => {
        it('returns all registered providers with name and source', () => {
            registry.register('auth', makeProvider('a'), ctx('plugin-a'));
            registry.register('db', makeProvider('d'), ctx('plugin-b', 'bundled'));

            const list = registry.list();
            expect(list).toHaveLength(2);
            expect(list).toEqual([
                { name: 'auth', source: 'curated' },
                { name: 'db', source: 'bundled' },
            ]);
        });

        it('returns empty list when nothing registered', () => {
            expect(registry.list()).toEqual([]);
        });
    });

    describe('unregister', () => {
        it('removes a registered provider', () => {
            registry.register('auth', makeProvider('a'), ctx());
            expect(registry.get('auth')).toBeDefined();

            registry.unregister('auth');
            expect(registry.get('auth')).toBeUndefined();
        });

        it('is a no-op for unknown names', () => {
            expect(() => registry.unregister('nope')).not.toThrow();
        });
    });
});
