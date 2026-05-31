import { describe, expect, test } from 'bun:test';
import { CommandError, errorMessage } from '../src/errors';

describe('errors', () => {
    test('CommandError has name and exit code', () => {
        const err = new CommandError('test error', 2);
        expect(err.message).toBe('test error');
        expect(err.name).toBe('CommandError');
        expect(err.exitCode).toBe(2);
    });

    test('CommandError default exit code is 1', () => {
        const err = new CommandError('default');
        expect(err.exitCode).toBe(1);
    });

    test('errorMessage extracts message from Error', () => {
        expect(errorMessage(new Error('boom'))).toBe('boom');
    });

    test('errorMessage handles non-Error values', () => {
        expect(errorMessage('string error')).toBe('string error');
        expect(errorMessage(42)).toBe('42');
    });
});
