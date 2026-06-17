import { describe, expect, test } from 'bun:test';
import { defaultModule, getModule, modules } from '../../src/modules/registry';

describe('registry', () => {
    test('modules is a non-empty array', () => {
        expect(Array.isArray(modules)).toBe(true);
        expect(modules.length).toBeGreaterThan(0);
    });

    test('defaultModule is the first entry', () => {
        expect(defaultModule).toBeDefined();
        expect(defaultModule?.id).toBe(modules[0]?.id);
    });

    test('getModule returns correct module by id', () => {
        const mod = getModule('tasks');
        expect(mod).toBeDefined();
        expect(mod?.id).toBe('tasks');
        expect(mod?.name).toBe('Tasks');
    });

    test('getModule returns undefined for unknown id', () => {
        expect(getModule('nonexistent')).toBeUndefined();
    });

    test('all modules have required fields', () => {
        for (const mod of modules) {
            expect(typeof mod.id).toBe('string');
            expect(typeof mod.name).toBe('string');
            expect(typeof mod.icon).toBe('string');
            expect(typeof mod.route).toBe('string');
            expect(typeof mod.component).toBeDefined();
        }
    });
});
