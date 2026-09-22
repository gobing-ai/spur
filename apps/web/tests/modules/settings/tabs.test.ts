import { describe, expect, test } from 'bun:test';
import AgentsView from '../../../src/modules/settings/AgentsView';
import GeneralView from '../../../src/modules/settings/GeneralView';
import { DEFAULT_SETTINGS_TAB, SETTINGS_TABS } from '../../../src/modules/settings/tabs';

describe('SETTINGS_TABS', () => {
    test('contains General as the first tab and Agents as the second tab', () => {
        expect(SETTINGS_TABS.map((t) => t.id)).toEqual(['general', 'agents']);
    });

    test('tab ids are unique and labels are non-empty', () => {
        const ids = SETTINGS_TABS.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const tab of SETTINGS_TABS) {
            expect(tab.label.length).toBeGreaterThan(0);
            expect(typeof tab.component).toBe('function');
        }
    });

    test('default tab is general', () => {
        expect(DEFAULT_SETTINGS_TAB).toBe('general');
    });

    test('general tab mounts GeneralView and agents tab mounts AgentsView', () => {
        expect(SETTINGS_TABS.find((t) => t.id === 'general')?.component).toBe(GeneralView);
        expect(SETTINGS_TABS.find((t) => t.id === 'agents')?.component).toBe(AgentsView);
    });
});
