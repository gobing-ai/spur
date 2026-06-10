import { describe, expect, test } from 'bun:test';
import { desktopNotify } from '../../../src/workflow/hitl/desktop-notify';

describe('desktopNotify', () => {
    test('is a fire-and-forget function that never throws', () => {
        // Posts one real (non-blocking) notification on macOS; on headless/CI platforms
        // node-notifier degrades internally. Either way the wrapper must not throw.
        expect(() => desktopNotify('Spur test', 'coverage probe')).not.toThrow();
    });

    test('exports a callable function (not undefined)', () => {
        expect(typeof desktopNotify).toBe('function');
    });
});
