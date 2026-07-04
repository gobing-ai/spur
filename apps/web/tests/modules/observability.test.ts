import { describe, expect, test } from 'bun:test';
import { discoverModules, isWebModule, readModule } from '../../src/modules/discover';
import { module as observabilityModule } from '../../src/modules/observability';
import { OBSERVABILITY_TABS } from '../../src/modules/observability/tabs';

/**
 * The observability web module (task 0189 R5) is auto-discovered by the same
 * `import.meta.glob` / fs-fallback path the `task-kanban` reference module uses.
 * These tests pin the contract:
 *  - the module exports a valid `WebModule` shape (so the discovery's
 *    `isWebModule` runtime guard accepts it),
 *  - the live registry, when scanned with the same `readModule` helper, picks
 *    it up alongside the other modules (so the board's sidebar lists it
 *    without manual wiring),
 *  - the tabs contract (R6) is a non-empty data array — the shell maps over
 *    it without hardcoding children, so a future append (Jobs / Process List)
 *    only needs a new entry here.
 */
describe('observability web module', () => {
    test('exports a valid WebModule shape (id, name, route, component, icon)', () => {
        expect(isWebModule(observabilityModule)).toBe(true);
        expect(observabilityModule.id).toBe('observability');
        expect(observabilityModule.name).toBe('Observability');
        expect(observabilityModule.route).toBe('observability');
        expect(typeof observabilityModule.icon).toBe('string');
        expect(observabilityModule.icon.length).toBeGreaterThan(0);
        expect(typeof observabilityModule.component).toBe('function');
    });

    test('is picked up by the discovery helper alongside the other modules', () => {
        const discovered = discoverModules();
        const ids = discovered.map((m) => m.id);
        expect(ids).toContain('observability');
        expect(ids).toContain('tasks');
    });

    test('readModule accepts both default and named module exports', () => {
        // Default export shape
        expect(readModule({ default: observabilityModule })).toBe(observabilityModule);
        // Named `module` export shape
        expect(readModule({ module: observabilityModule })).toBe(observabilityModule);
        // Neither — null
        expect(readModule({})).toBeNull();
        expect(readModule(null)).toBeNull();
        expect(readModule({ module: {} })).toBeNull();
    });

    test('tabs contract (R6) is a non-empty data array with id/label/component', () => {
        expect(OBSERVABILITY_TABS.length).toBeGreaterThan(0);
        for (const tab of OBSERVABILITY_TABS) {
            expect(typeof tab.id).toBe('string');
            expect(tab.id.length).toBeGreaterThan(0);
            expect(typeof tab.label).toBe('string');
            expect(tab.label.length).toBeGreaterThan(0);
            expect(typeof tab.component).toBe('function');
        }
    });

    test('tab ids are unique — the shell keys selection by id', () => {
        const ids = OBSERVABILITY_TABS.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
