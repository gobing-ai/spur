import { describe, expect, test } from 'bun:test';
import { isSameOrigin, isWindowAction } from '../src/ipc';

describe('ipc contract', () => {
    test('accepts only the three window actions', () => {
        expect(isWindowAction('minimize')).toBe(true);
        expect(isWindowAction('toggle-maximize')).toBe(true);
        expect(isWindowAction('close')).toBe(true);
        expect(isWindowAction('reload')).toBe(false);
        expect(isWindowAction(1)).toBe(false);
    });

    test('compares navigation origins and rejects garbage', () => {
        expect(isSameOrigin('http://127.0.0.1:3000/board', 'http://127.0.0.1:3000')).toBe(true);
        expect(isSameOrigin('http://127.0.0.1:3000/board', 'http://127.0.0.1:3001')).toBe(false);
        expect(isSameOrigin('not a url', 'http://127.0.0.1:3000')).toBe(false);
    });
});
