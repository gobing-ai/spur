import { beforeEach, describe, expect, it } from 'bun:test';
import { getLogger } from '@gobing-ai/ts-infra';
import type { RegistrationContext } from '../../src/plugin';
import { PluginCollisionError } from '../../src/plugin';
import { type UiImpl, UiRegistry } from '../../src/registries/ui';
import { TrustEngine } from '../../src/trust';

// ── Helpers ──────────────────────────────────────────────────────────

function ctx(
    pluginName = 'test-plugin',
    trustLevel: 'bundled' | 'curated' | 'local' | 'untrusted' = 'curated',
): RegistrationContext {
    return { source: trustLevel, pluginName, trustLevel };
}

function makeImpl(_label: string): UiImpl {
    return {
        mount: (_container: unknown) => {
            /* noop */
        },
    };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('UiRegistry', () => {
    let trust: TrustEngine;
    let registry: UiRegistry;

    beforeEach(() => {
        trust = new TrustEngine();
        registry = new UiRegistry(trust, getLogger('ui-registry'));
    });

    describe('register / get', () => {
        it('returns registered impl by name', () => {
            const impl = makeImpl('button');
            registry.register('button', impl, ctx());
            expect(registry.get('button')).toBe(impl);
        });

        it('returns undefined for unknown name', () => {
            expect(registry.get('nope')).toBeUndefined();
        });
    });

    describe('collision', () => {
        it('throws PluginCollisionError on duplicate name', () => {
            const impl = makeImpl('panel');
            registry.register('panel', impl, ctx('plugin-a'));
            expect(() => {
                registry.register('panel', makeImpl('panel'), ctx('plugin-b'));
            }).toThrow(PluginCollisionError);
        });
    });

    describe('list', () => {
        it('returns empty array initially', () => {
            expect(registry.list()).toEqual([]);
        });
        it('returns registered entries with name and source', () => {
            const impl = makeImpl('sidebar');
            registry.register('sidebar', impl, ctx('my-plugin', 'curated'));
            const items = registry.list();
            expect(items).toHaveLength(1);
            expect(items[0]?.name).toBe('sidebar');
            expect(items[0]?.source).toBe('curated');
        });

        it('includes built-in entries', () => {
            const impl = makeImpl('header');
            registry.registerBuiltin('header', impl);
            const items = registry.list();
            expect(items).toHaveLength(1);
            expect(items[0]?.name).toBe('header');
            expect(items[0]?.source).toBe('builtin');
        });
    });

    describe('preRegister (built-in seeding)', () => {
        it('makes built-in available via get', () => {
            const impl = makeImpl('footer');
            registry.registerBuiltin('footer', impl);
            expect(registry.get('footer')).toBe(impl);
        });

        it('throws collision when built-in name collides with plugin', () => {
            const impl = makeImpl('navbar');
            registry.register('navbar', impl, ctx('plugin-x'));
            expect(() => {
                registry.registerBuiltin('navbar', makeImpl('navbar'));
            }).toThrow(PluginCollisionError);
        });

        it('throws collision when plugin name collides with built-in', () => {
            const impl = makeImpl('modal');
            registry.registerBuiltin('modal', impl);
            expect(() => {
                registry.register('modal', makeImpl('modal'), ctx('plugin-y'));
            }).toThrow(PluginCollisionError);
        });
    });
});
