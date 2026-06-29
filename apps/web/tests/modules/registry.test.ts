import { describe, expect, test } from 'bun:test';
import {
    createRegistry,
    disableModule,
    enableModule,
    getEnabledModules,
    getModule,
    registerModuleRoot,
} from '../../src/modules/registry';
import type { WebModule } from '../../src/modules/types';

/** Hand-built fixture — registry logic is pure, no Vite glob needed. */
function fixture(id: string, route: string = id): WebModule {
    return {
        id,
        name: id,
        icon: '▪',
        route,
        component: () => null,
    };
}

describe('createRegistry', () => {
    test('modules / defaultModule / getModule resolve from an injected list', () => {
        const reg = createRegistry([fixture('a'), fixture('b')]);
        expect(reg.modules.map((m) => m.id)).toEqual(['a', 'b']);
        expect(reg.defaultModule?.id).toBe('a');
        expect(reg.getModule('b')?.id).toBe('b');
        expect(reg.getModule('zzz')).toBeUndefined();
    });

    test('disableModule removes a module from all three consumer views', () => {
        const reg = createRegistry([fixture('a'), fixture('b')]);
        reg.disableModule('a');
        expect(reg.modules.map((m) => m.id)).toEqual(['b']);
        expect(reg.getModule('a')).toBeUndefined();
        expect(reg.defaultModule?.id).toBe('b'); // default is never a disabled module
        expect(reg.getEnabledModules()).toEqual(['b']);
    });

    test('enableModule restores a disabled module to its original position', () => {
        const reg = createRegistry([fixture('a'), fixture('b'), fixture('c')]);
        reg.disableModule('b');
        reg.enableModule('b');
        expect(reg.modules.map((m) => m.id)).toEqual(['a', 'b', 'c']);
        expect(reg.getModule('b')?.id).toBe('b');
    });

    test('initial disabled option drops modules at construction', () => {
        const reg = createRegistry([fixture('a'), fixture('b')], { disabled: ['a'] });
        expect(reg.modules.map((m) => m.id)).toEqual(['b']);
    });

    test('duplicate id throws a loud error naming the colliding id', () => {
        expect(() => createRegistry([fixture('notes'), fixture('notes')])).toThrow(/Duplicate module id "notes"/);
    });

    test('duplicate route throws a loud error naming the colliding route', () => {
        expect(() => createRegistry([fixture('a', 'x'), fixture('b', 'x')])).toThrow(/Duplicate module route "x"/);
    });

    test('ordering is stable regardless of input order (discovery-sorted)', () => {
        const reg = createRegistry([fixture('z'), fixture('a'), fixture('m')]);
        // discoverModules sorts within root by directory name; createRegistry preserves discovered order,
        // so callers are expected to pre-sort. Here we verify the registry does not reorder.
        expect(reg.modules.map((m) => m.id)).toEqual(['z', 'a', 'm']);
    });

    test('an empty discovered list is harmless (no throw, no modules)', () => {
        const reg = createRegistry([]);
        expect(reg.modules).toEqual([]);
        expect(reg.defaultModule).toBeUndefined();
        expect(reg.getModule('anything')).toBeUndefined();
    });

    test('registerModuleRoot is a no-op on a registry instance', () => {
        const reg = createRegistry([fixture('x')]);
        expect(() => reg.registerModuleRoot('')).not.toThrow();
        expect(reg.modules.map((m) => m.id)).toEqual(['x']);
    });
});

/**
 * The module-level singleton wrappers (the re-exported registry instance).
 * These exist so non-Preact entry points can toggle/inspect modules without
 * holding a handle from the Preact context. Coverage: lines 119/124/129.
 */
describe('singleton registry instance', () => {
    test('getEnabledModules lists ids of all enabled modules', () => {
        // The singleton is seeded from the real discoverModules() fallback under bun test,
        // so it contains at least the `tasks` module.
        const ids = getEnabledModules();
        expect(Array.isArray(ids)).toBe(true);
        expect(ids).toContain('tasks');
    });

    test('disableModule removes a module id from getEnabledModules', () => {
        const before = getEnabledModules();
        disableModule('tasks');
        expect(getEnabledModules()).not.toContain('tasks');
        // restore for any subsequent tests
        enableModule('tasks');
        expect(getEnabledModules()).toEqual(before);
    });

    test('enableModule is idempotent on an already-enabled module', () => {
        enableModule('tasks');
        enableModule('tasks');
        expect(getEnabledModules()).toContain('tasks');
    });

    test('getModule resolves via the singleton instance', () => {
        const mod = getModule('tasks');
        expect(mod?.id).toBe('tasks');
        expect(mod?.name).toBe('Tasks');
    });

    test('registerModuleRoot module export is a no-op stub that returns without throwing', () => {
        // The single-root architecture is fixed for v0; the export exists for API
        // stability. Assert it does nothing harmful.
        expect(() => registerModuleRoot('')).not.toThrow();
    });
});
