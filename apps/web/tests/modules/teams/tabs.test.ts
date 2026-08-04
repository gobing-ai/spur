import { describe, expect, test } from 'bun:test';

import { TEAMS_TABS } from '../../../src/modules/teams/tabs';

describe('TEAMS_TABS', () => {
    test('is a non-empty readonly array', () => {
        expect(Array.isArray(TEAMS_TABS)).toBe(true);
        expect(TEAMS_TABS.length).toBeGreaterThan(0);
    });

    test('every tab has the required fields', () => {
        for (const tab of TEAMS_TABS) {
            expect(typeof tab.id).toBe('string');
            expect(tab.id.length).toBeGreaterThan(0);
            expect(typeof tab.label).toBe('string');
            expect(tab.label.length).toBeGreaterThan(0);
            expect(typeof tab.component).toBe('function');
        }
    });

    test('tab ids are unique (append-only contract)', () => {
        const ids = TEAMS_TABS.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('contains the 4 v1 tabs in stable order with Supervisor first (0378 R1; 0422 R7)', () => {
        // 0378: Supervisor added as first+default tab. Append-only/id-stable.
        // 0422 R7: `messages` moved to the Inbox module.
        const ids = TEAMS_TABS.map((t) => t.id);
        expect(ids).toEqual(['supervisor', 'terminal', 'processes', 'activity']);
    });

    test('component fields are resolvable React component types', () => {
        for (const tab of TEAMS_TABS) {
            // ComponentType is a function (class or functional component).
            // A falsy value or non-function would break React rendering.
            expect(tab.component).toBeTruthy();
        }
    });
});
