import { describe, expect, test } from 'bun:test';
import { registerSystemEventTap as appRegisterSystemEventTap } from '@gobing-ai/spur-app/system-event-tap';
import { registerSystemEventTap } from '../../../src/modules/events/system-event-tap';

describe('re-exported registerSystemEventTap', () => {
    test('is the app-owned implementation, not a server-side fork', () => {
        expect(registerSystemEventTap).toBe(appRegisterSystemEventTap);
    });
});
