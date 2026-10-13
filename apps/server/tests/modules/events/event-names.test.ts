import { describe, expect, test } from 'bun:test';
import { SYSTEM_EVENT_CATALOG_METADATA, SYSTEM_EVENT_STREAMED_NAMES } from '../../../src/modules/events/event-names';

describe('re-exported system event catalog helpers', () => {
    test('is defined', () => {
        expect(SYSTEM_EVENT_STREAMED_NAMES).toContain('task.created');
        expect(SYSTEM_EVENT_CATALOG_METADATA.some((entry) => entry.prefix === 'task')).toBe(true);
    });
});
