import { describe, expect, test } from 'bun:test';
import { registerSystemEventTap } from '../../../src/modules/events/system-event-tap';

describe('re-exported registerSystemEventTap', () => {
    test('is defined', () => {
        expect(registerSystemEventTap).toBeDefined();
    });
});
