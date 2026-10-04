import { describe, expect, test } from 'bun:test';
import ProcessesView from '../../../src/modules/projects/ProcessesView';
import { DEFAULT_PROJECT_TAB, PROJECT_TABS } from '../../../src/modules/projects/tabs';

describe('PROJECT_TABS (0840 R3)', () => {
    test('contains the 2 tabs in frozen order: Fleet, Inbox', () => {
        expect(PROJECT_TABS.map((t) => t.id)).toEqual(['fleet', 'inbox']);
        expect(PROJECT_TABS.map((t) => t.label)).toEqual(['Fleet', 'Inbox']);
    });

    test('tab ids are unique and labels are non-empty', () => {
        const ids = PROJECT_TABS.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const tab of PROJECT_TABS) {
            expect(tab.label.length).toBeGreaterThan(0);
            expect(typeof tab.component).toBe('function');
        }
    });

    test('default tab is fleet', () => {
        expect(DEFAULT_PROJECT_TAB).toBe('fleet');
    });

    // Tasks and Features stay their own modules; the old Work wrapper is gone.
    test('fleet is a top-level tab mounting ProcessesView', () => {
        expect(PROJECT_TABS.find((t) => t.id === 'fleet')?.component).toBe(ProcessesView);
    });
});
