import { describe, expect, test } from 'bun:test';
import {
    EFFECTIVE_TOOL_NAME_SQL,
    HISTORY_BOARD_ACTIVITY_DAYS,
    RESOLVED_TOOL_NAME_SQL,
} from '../../src/analytics/tool-name-sql';

describe('tool-name-sql (shared SQL constants)', () => {
    test('EFFECTIVE_TOOL_NAME_SQL is a non-empty CASE expression resolving unknown tools', () => {
        expect(EFFECTIVE_TOOL_NAME_SQL).toContain('CASE');
        expect(EFFECTIVE_TOOL_NAME_SQL).toContain('unknown');
        expect(EFFECTIVE_TOOL_NAME_SQL).toContain('call_bash_%');
        expect(EFFECTIVE_TOOL_NAME_SQL.length).toBeGreaterThan(100);
    });

    test('RESOLVED_TOOL_NAME_SQL embeds EFFECTIVE_TOOL_NAME_SQL and prefers the persisted column', () => {
        expect(RESOLVED_TOOL_NAME_SQL).toContain('effective_tool_name');
        expect(RESOLVED_TOOL_NAME_SQL).toContain(EFFECTIVE_TOOL_NAME_SQL.trim());
    });

    test('HISTORY_BOARD_ACTIVITY_DAYS is a positive window constant', () => {
        expect(HISTORY_BOARD_ACTIVITY_DAYS).toBeGreaterThan(0);
    });
});
