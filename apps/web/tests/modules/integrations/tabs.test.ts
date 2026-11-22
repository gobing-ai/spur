/** A82 1424 R2 — the Integrations tab list is append-only and ordered. */
import { describe, expect, test } from 'bun:test';
import { INTEGRATIONS_TABS } from '../../../src/modules/integrations/tabs';

describe('1424 — tab contract', () => {
    test('ids and labels are the frozen order Summary, MCP, A2A', () => {
        expect(INTEGRATIONS_TABS.map((tab) => tab.id)).toEqual(['summary', 'mcp', 'a2a']);
        expect(INTEGRATIONS_TABS.map((tab) => tab.label)).toEqual(['Summary', 'MCP', 'A2A']);
    });

    test('ids are unique, so persisted tab state addresses exactly one entry', () => {
        expect(new Set(INTEGRATIONS_TABS.map((tab) => tab.id)).size).toBe(INTEGRATIONS_TABS.length);
    });
});
