import { describe, expect, test } from 'bun:test';

import { FIXED_INBOX_TABS } from '../../../src/modules/inbox/tabs';

describe('FIXED_INBOX_TABS', () => {
    test('renders All first and Supervisor second (0422 R1)', () => {
        expect(FIXED_INBOX_TABS.map((t) => t.id)).toEqual(['all', 'supervisor']);
        expect(FIXED_INBOX_TABS[0]?.label).toBe('All');
        expect(FIXED_INBOX_TABS[1]?.label).toBe('Supervisor');
    });

    test('every tab has stable string id and label', () => {
        for (const tab of FIXED_INBOX_TABS) {
            expect(typeof tab.id).toBe('string');
            expect(tab.id.length).toBeGreaterThan(0);
            expect(typeof tab.label).toBe('string');
            expect(tab.label.length).toBeGreaterThan(0);
        }
    });

    test('ids are unique (append-only contract)', () => {
        const ids = FIXED_INBOX_TABS.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
