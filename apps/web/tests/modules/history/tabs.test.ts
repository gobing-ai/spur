import { describe, expect, test } from 'bun:test';
import { HISTORY_TABS } from '../../../src/modules/history/tabs';

describe('History module tabs', () => {
    test('defines the 5 standard tabs in frozen order', () => {
        expect(HISTORY_TABS.map((t) => t.id)).toEqual(['summary', 'timeline', 'sessions', 'insights', 'sources']);
    });

    test('each tab has a non-empty label and component defined', () => {
        for (const tab of HISTORY_TABS) {
            expect(tab.label.length).toBeGreaterThan(0);
            expect(tab.component).toBeDefined();
        }
    });
});
