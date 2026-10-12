import { describe, expect, test } from 'bun:test';
import DatabaseView from '../../../src/modules/projects/DatabaseView';
import ProcessesView from '../../../src/modules/projects/ProcessesView';
import { DEFAULT_PROJECT_TAB, PROJECT_TABS } from '../../../src/modules/projects/tabs';

describe('PROJECT_TABS (0840 R3)', () => {
    test('contains the 3 tabs in frozen order: Fleet, Inbox, Database', () => {
        expect(PROJECT_TABS.map((t) => t.id)).toEqual(['fleet', 'inbox', 'database']);
        expect(PROJECT_TABS.map((t) => t.label)).toEqual(['Fleet', 'Inbox', 'Database']);
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

    // 1184 R1: the Database tab deep-links and mounts its view.
    test('database is a top-level tab mounting DatabaseView', () => {
        expect(PROJECT_TABS.find((t) => t.id === 'database')?.component).toBe(DatabaseView);
    });
});
