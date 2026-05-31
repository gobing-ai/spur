import { describe, expect, test } from 'bun:test';
import { CommandError, errorMessage } from '../src/errors';

describe('errors', () => {
    describe('CommandError', () => {
        test('has name and exit code', () => {
            const err = new CommandError('test error', 2);
            expect(err.message).toBe('test error');
            expect(err.name).toBe('CommandError');
            expect(err.exitCode).toBe(2);
        });

        test('default exit code is 1', () => {
            const err = new CommandError('default');
            expect(err.exitCode).toBe(1);
        });

        test('is instance of Error', () => {
            const err = new CommandError('test');
            expect(err).toBeInstanceOf(Error);
        });

        test('is instance of CommandError', () => {
            const err = new CommandError('test');
            expect(err).toBeInstanceOf(CommandError);
        });

        test('preserves custom exit code 0', () => {
            const err = new CommandError('ok', 0);
            expect(err.exitCode).toBe(0);
        });
    });

    describe('errorMessage', () => {
        test('extracts message from Error', () => {
            expect(errorMessage(new Error('boom'))).toBe('boom');
        });

        test('handles non-Error values', () => {
            expect(errorMessage('string error')).toBe('string error');
            expect(errorMessage(42)).toBe('42');
        });

        test('handles null', () => {
            expect(errorMessage(null)).toBe('null');
        });

        test('handles undefined', () => {
            expect(errorMessage(undefined)).toBe('undefined');
        });

        test('handles object', () => {
            expect(errorMessage({ key: 'val' })).toBe('[object Object]');
        });
    });
});
