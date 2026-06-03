import { beforeEach, describe, expect, it } from 'bun:test';
import { getLogger } from '@gobing-ai/ts-infra';
import { PluginCollisionError } from '../../src/plugin';
import type { ApiImpl } from '../../src/registries/api';
import { ApiRegistry } from '../../src/registries/api';
import { TrustEngine } from '../../src/trust';

// ── Helpers ──────────────────────────────────────────────────────────

function ctx(pluginName = 'test-plugin', trustLevel: 'bundled' | 'curated' | 'local' | 'untrusted' = 'curated') {
    return { source: trustLevel, pluginName, trustLevel };
}

function makeImpl(name: string): ApiImpl {
    return {
        handler: (_req: Request) => new Response(name),
    };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ApiRegistry', () => {
    let trust: TrustEngine;
    let registry: ApiRegistry;

    beforeEach(() => {
        trust = new TrustEngine();
        registry = new ApiRegistry(trust, getLogger('test-api'));
    });

    describe('register / get', () => {
        it('stores and retrieves an implementation', () => {
            const impl = makeImpl('echo');
            registry.register('echo', impl, ctx('p1'));
            expect(registry.get('echo')).toBe(impl);
        });

        it('returns undefined for unknown names', () => {
            expect(registry.get('nope')).toBeUndefined();
        });

        it('stores multiple entries independently', () => {
            const a = makeImpl('a');
            const b = makeImpl('b');
            registry.register('a', a, ctx());
            registry.register('b', b, ctx());
            expect(registry.get('a')).toBe(a);
            expect(registry.get('b')).toBe(b);
        });
    });

    describe('collision', () => {
        it('throws PluginCollisionError on duplicate name', () => {
            registry.register('dup', makeImpl('first'), ctx('p1'));
            expect(() => {
                registry.register('dup', makeImpl('second'), ctx('p2'));
            }).toThrow(PluginCollisionError);
        });
    });

    describe('list', () => {
        it('returns empty list when nothing registered', () => {
            expect(registry.list()).toEqual([]);
        });

        it('returns all registered names with sources', () => {
            registry.register('a', makeImpl('a'), ctx('p1'));
            registry.register('b', makeImpl('b'), ctx('p2', 'local'));
            const list = registry.list();
            expect(list).toHaveLength(2);
            expect(list).toContainEqual({ name: 'a', source: 'curated' });
            expect(list).toContainEqual({ name: 'b', source: 'local' });
        });
    });

    describe('preRegister', () => {
        // ApiRegistry doesn't publicly expose preRegister, but we test via
        // the fact that built-in entries behave identically to registered ones.

        it('can seed a builtin entry (test via subclass hook)', () => {
            // Use a test-only subclass that exposes preRegister
            class TestApiRegistry extends ApiRegistry {
                public seed(name: string, impl: ApiImpl) {
                    this.preRegister(name, impl);
                }
            }

            const r = new TestApiRegistry(new TrustEngine(), getLogger('test-api'));
            const impl = makeImpl('builtin-echo');
            r.seed('builtin-echo', impl);
            expect(r.get('builtin-echo')).toBe(impl);
            // builtin entries show source='builtin' in list
            expect(r.list()).toContainEqual({ name: 'builtin-echo', source: 'builtin' });
        });

        it('throws PluginCollisionError on double preRegister', () => {
            class TestApiRegistry extends ApiRegistry {
                public seed(name: string, impl: ApiImpl) {
                    this.preRegister(name, impl);
                }
            }

            const r = new TestApiRegistry(new TrustEngine(), getLogger('test-api'));
            r.seed('dup', makeImpl('first'));
            expect(() => {
                r.seed('dup', makeImpl('second'));
            }).toThrow(PluginCollisionError);
        });
    });
});
