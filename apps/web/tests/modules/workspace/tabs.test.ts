import { describe, expect, test } from 'bun:test';

import { WORKSPACE_TABS } from '../../../src/modules/workspace/tabs';

describe('WORKSPACE_TABS', () => {
    test('is a non-empty readonly array', () => {
        expect(Array.isArray(WORKSPACE_TABS)).toBe(true);
        expect(WORKSPACE_TABS.length).toBeGreaterThan(0);
    });

    test('every tab has the required fields with non-empty string id and label', () => {
        for (const tab of WORKSPACE_TABS) {
            expect(typeof tab.id).toBe('string');
            expect(tab.id.length).toBeGreaterThan(0);
            expect(typeof tab.label).toBe('string');
            expect(tab.label.length).toBeGreaterThan(0);
            // ComponentType must be a resolvable React component (function or class)
            expect(typeof tab.component).toBe('function');
        }
    });

    test('tab ids are unique (append-only contract — 0197 R5/R6)', () => {
        const ids = WORKSPACE_TABS.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('contains the 4 v1 tabs in stable order (0197 R5/R6)', () => {
        // Order is load-order in the UI; append-only and id-stable per task 0197.
        expect(WORKSPACE_TABS.map((t) => t.id)).toEqual(['overview', 'team', 'inbox', 'tasks']);
    });

    test('tab labels match expected display names', () => {
        const labelMap = Object.fromEntries(WORKSPACE_TABS.map((t) => [t.id, t.label]));
        expect(labelMap.overview).toBe('Overview');
        expect(labelMap.team).toBe('Team');
        expect(labelMap.inbox).toBe('Inbox');
        expect(labelMap.tasks).toBe('Tasks');
    });

    test('component fields are resolvable React component types', () => {
        for (const tab of WORKSPACE_TABS) {
            // A falsy or non-function value would break React rendering silently.
            expect(tab.component).toBeTruthy();
        }
    });
});
