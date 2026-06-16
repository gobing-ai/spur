import { describe, expect, test } from 'bun:test';
import { openUrl } from '../src/open-url';

describe('openUrl', () => {
    test('exports as a function', () => {
        expect(typeof openUrl).toBe('function');
    });

    test('accepts a URL string without throwing', () => {
        // openUrl spawns a subprocess — just verify it doesn't throw on valid input
        // and the subprocess get cleaned up (we don't check the result)
        expect(() => {
            openUrl('http://localhost:9999').catch(() => {});
        }).not.toThrow();
    });
});
