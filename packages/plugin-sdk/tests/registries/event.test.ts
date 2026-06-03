import { beforeEach, describe, expect, it } from 'bun:test';
import { getLogger } from '@gobing-ai/ts-infra';
import { PluginCollisionError } from '../../src/plugin';
import { type EventImpl, EventRegistry } from '../../src/registries/event';
import { TrustEngine } from '../../src/trust';

// ── Helpers ──────────────────────────────────────────────────────────

function ctx(pluginName = 'test-plugin', trustLevel: 'bundled' | 'curated' | 'local' | 'untrusted' = 'curated') {
    return {
        source: trustLevel as 'bundled' | 'curated' | 'local',
        pluginName,
        trustLevel,
    };
}
function makeImpl(_id: string): EventImpl {
    return { subscribe: (_bus) => {} };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('EventRegistry', () => {
    let trust: TrustEngine;
    let registry: EventRegistry;

    beforeEach(() => {
        trust = new TrustEngine();
        registry = new EventRegistry(trust, getLogger('event-registry'));
    });

    describe('register / get', () => {
        it('register then get returns the implementation', () => {
            const impl = makeImpl('e1');
            registry.register('my-event', impl, ctx());
            expect(registry.get('my-event')).toBe(impl);
        });

        it('get returns undefined for unregistered name', () => {
            expect(registry.get('nonexistent')).toBeUndefined();
        });

        it('allows registration at local trust level (events is safe)', () => {
            const impl = makeImpl('local-event');
            registry.register('local-event', impl, ctx('local-plugin', 'local'));
            expect(registry.get('local-event')).toBe(impl);
        });

        it('allows registration at untrusted trust level (events is safe)', () => {
            const impl = makeImpl('untrusted-event');
            registry.register('untrusted-event', impl, ctx('untrusted-plugin', 'untrusted'));
            expect(registry.get('untrusted-event')).toBe(impl);
        });
    });

    describe('collision', () => {
        it('throws PluginCollisionError on duplicate name', () => {
            registry.register('dup', makeImpl('a'), ctx('plugin-a'));
            expect(() => {
                registry.register('dup', makeImpl('b'), ctx('plugin-b'));
            }).toThrow(PluginCollisionError);
        });
    });

    describe('list', () => {
        it('returns empty array when nothing registered', () => {
            expect(registry.list()).toEqual([]);
        });

        it('returns registered entries with name and source', () => {
            registry.register('e1', makeImpl('e1'), ctx('p1', 'curated'));
            registry.register('e2', makeImpl('e2'), ctx('p2', 'bundled'));
            const list = registry.list();
            expect(list).toHaveLength(2);
            expect(list).toContainEqual({ name: 'e1', source: 'curated' });
            expect(list).toContainEqual({ name: 'e2', source: 'bundled' });
        });
    });

    describe('preRegister (subclass-available for built-in seeding)', () => {
        it('preRegister adds a builtin entry resolvable via get', () => {
            // preRegister is protected — call through a test-only subclass
            class TestEventRegistry extends EventRegistry {
                public seed(name: string, impl: EventImpl) {
                    this.preRegister(name, impl);
                }
            }
            const seedable = new TestEventRegistry(trust, getLogger('test'));
            const impl = makeImpl('builtin-event');
            seedable.seed('builtin-event', impl);
            expect(seedable.get('builtin-event')).toBe(impl);
            expect(seedable.list()).toContainEqual({ name: 'builtin-event', source: 'builtin' });
        });

        it('preRegister throws on collision with existing entry', () => {
            class TestEventRegistry extends EventRegistry {
                public seed(name: string, impl: EventImpl) {
                    this.preRegister(name, impl);
                }
            }
            const seedable = new TestEventRegistry(trust, getLogger('test'));
            seedable.seed('dup', makeImpl('a'));
            expect(() => {
                seedable.seed('dup', makeImpl('b'));
            }).toThrow(PluginCollisionError);
        });
    });
});
