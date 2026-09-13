import { describe, expect, test } from 'bun:test';
import { DEFAULT_PROJECT_TAB, PROJECT_TABS } from '../../../src/modules/projects/tabs';
import WorkView, { DEFAULT_WORK_SECTION } from '../../../src/modules/projects/WorkView';

describe('PROJECT_TABS (0840 R3)', () => {
    test('contains the 3 v1 tabs in frozen order: Conversation, Agents, Work', () => {
        expect(PROJECT_TABS.map((t) => t.id)).toEqual(['conversation', 'agents', 'work']);
    });

    test('tab ids are unique and labels are non-empty', () => {
        const ids = PROJECT_TABS.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const tab of PROJECT_TABS) {
            expect(tab.label.length).toBeGreaterThan(0);
            expect(typeof tab.component).toBe('function');
        }
    });

    test('default tab is conversation', () => {
        expect(DEFAULT_PROJECT_TAB).toBe('conversation');
    });
});

describe('work tab (0843)', () => {
    test('mounts the Work view in place of the 0840 placeholder, frozen id/label/order untouched', () => {
        const work = PROJECT_TABS.find((t) => t.id === 'work');
        expect(work?.label).toBe('Work');
        expect(work?.component).toBe(WorkView);
        expect(DEFAULT_WORK_SECTION).toBe('tasks');
    });
});
