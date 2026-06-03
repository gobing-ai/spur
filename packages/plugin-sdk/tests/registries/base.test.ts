import { beforeEach, describe, expect, it } from 'bun:test';
import { getLogger } from '@gobing-ai/ts-infra';
import { PluginCollisionError } from '../../src/plugin';
import { Registry } from '../../src/registries/base';
import { TrustEngine } from '../../src/trust';

// ── Concrete subclass for testing ────────────────────────────────────

interface TestImpl {
    id: string;
    run(): string;
}

class TestRegistry extends Registry<TestImpl> {
    constructor(trust: TrustEngine) {
        super('commands', trust, getLogger('test-registry'));
    }

    // Expose preRegister for tests
    public seedBuiltin(name: string, impl: TestImpl): void {
        this.preRegister(name, impl);
    }
}

// ── Helpers ──────────────────────────────────────────────────────────

function ctx(pluginName = 'test-plugin', trustLevel: 'bundled' | 'curated' | 'local' | 'untrusted' = 'curated') {
    return {
        source: trustLevel as 'bundled' | 'curated' | 'local',
        pluginName,
        trustLevel,
    };
}

function makeImpl(id: string): TestImpl {
    return { id, run: () => `ran ${id}` };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Registry base', () => {
    let trust: TrustEngine;
    let registry: TestRegistry;

    beforeEach(() => {
        trust = new TrustEngine();
        registry = new TestRegistry(trust);
    });

    describe('register / get', () => {
        it('register then get returns the implementation', () => {
            const impl = makeImpl('a');
            registry.register('test.a', impl, ctx());
            expect(registry.get('test.a')).toBe(impl);
        });

        it('get returns undefined for unknown name', () => {
            expect(registry.get('nonexistent')).toBeUndefined();
        });
    });

    describe('collision', () => {
        it('throws PluginCollisionError on duplicate name', () => {
            registry.register('test.a', makeImpl('a'), ctx('plugin-a'));
            expect(() => registry.register('test.a', makeImpl('b'), ctx('plugin-b'))).toThrow(PluginCollisionError);
        });

        it('collision error names the existing source', () => {
            registry.register('test.a', makeImpl('a'), ctx('plugin-a'));
            try {
                registry.register('test.a', makeImpl('b'), ctx('plugin-b'));
            } catch (e) {
                expect(e).toBeInstanceOf(PluginCollisionError);
                const msg = (e as Error).message;
                expect(msg).toContain('test.a');
            }
        });
    });

    describe('unregister', () => {
        it('removes a registered entry', () => {
            const impl = makeImpl('a');
            registry.register('test.a', impl, ctx());
            registry.unregister('test.a');
            expect(registry.get('test.a')).toBeUndefined();
        });

        it('is a no-op for unknown names', () => {
            expect(() => registry.unregister('nonexistent')).not.toThrow();
        });
    });

    describe('list', () => {
        it('returns empty list when nothing registered', () => {
            expect(registry.list()).toEqual([]);
        });

        it('returns registered entries with name and source', () => {
            registry.register('test.a', makeImpl('a'), ctx('plugin-a'));
            registry.register('test.b', makeImpl('b'), ctx('plugin-b', 'local'));
            const list = registry.list();
            expect(list).toHaveLength(2);
            expect(list.map((e) => e.name).sort()).toEqual(['test.a', 'test.b']);
            expect(list.map((e) => e.source).sort()).toEqual(['curated', 'local']);
        });
    });

    describe('preRegister (built-in seeding)', () => {
        it('seeds a builtin entry resolvable through get', () => {
            const impl = makeImpl('builtin-a');
            registry.seedBuiltin('builtin.a', impl);
            expect(registry.get('builtin.a')).toBe(impl);
        });

        it('builtin entry shows source: builtin in list', () => {
            registry.seedBuiltin('builtin.a', makeImpl('builtin-a'));
            const list = registry.list();
            expect(list).toHaveLength(1);
            expect(list[0]?.source).toBe('builtin');
        });

        it('builtin occupies name — plugin cannot shadow', () => {
            registry.seedBuiltin('shared.name', makeImpl('builtin'));
            expect(() => registry.register('shared.name', makeImpl('plugin'), ctx())).toThrow(PluginCollisionError);
        });
    });
});
