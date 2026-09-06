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

    test('tab ids are unique stable selectors', () => {
        const ids = OBSERVABILITY_TABS.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('contains exactly the consolidated telemetry tabs (J92 R4)', () => {
        // J92 consolidation: Observability registers exactly system-events, jobs, and routing.
        // Legacy tasks and tool-using are removed.
        const ids = OBSERVABILITY_TABS.map((t) => t.id);
        expect(ids).toEqual(['summary', 'system-events', 'jobs', 'routing']);
        expect(ids).not.toContain('tasks');
        expect(ids).not.toContain('tool-using');
        expect(ids).not.toContain('inbox');
        expect(ids).not.toContain('process-list');
    });

    test('component fields are resolvable React component types', () => {
        for (const tab of OBSERVABILITY_TABS) {
            // ComponentType is a function (class or functional component).
            // A falsy value or non-function would break React rendering.
            expect(tab.component).toBeTruthy();
        }
    });
});
