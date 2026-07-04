import { describe, expect, test } from 'bun:test';

import { OBSERVABILITY_TABS } from '../../../src/modules/observability/tabs';

describe('OBSERVABILITY_TABS', () => {
    test('is a non-empty readonly array', () => {
        expect(Array.isArray(OBSERVABILITY_TABS)).toBe(true);
        expect(OBSERVABILITY_TABS.length).toBeGreaterThan(0);
    });

    test('every tab has the required fields', () => {
        for (const tab of OBSERVABILITY_TABS) {
            expect(typeof tab.id).toBe('string');
            expect(tab.id.length).toBeGreaterThan(0);
            expect(typeof tab.label).toBe('string');
            expect(tab.label.length).toBeGreaterThan(0);
            expect(typeof tab.component).toBe('function');
        }
    });

    test('tab ids are unique (append-only contract)', () => {
        const ids = OBSERVABILITY_TABS.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('contains the built-in v1 tabs', () => {
        const ids = OBSERVABILITY_TABS.map((t) => t.id);
        expect(ids).toContain('system-events');
        expect(ids).toContain('inbox');
    });

    test('component fields are resolvable React component types', () => {
        for (const tab of OBSERVABILITY_TABS) {
            // ComponentType is a function (class or functional component).
            // A falsy value or non-function would break React rendering.
            expect(tab.component).toBeTruthy();
        }
    });
});
