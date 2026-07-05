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

        test('formats SQLITE_BUSY errors as a one-line retry suggestion', () => {
            const err = new Error('SQLITE_BUSY: database is locked') as Error & { code: string };
            err.code = 'SQLITE_BUSY';

            expect(errorMessage(err)).toBe(
                'SQLite database is busy; another Spur process is holding the lock. Retry after the other command finishes.',
            );
        });

        test('formats string SQLITE_BUSY errors as a one-line retry suggestion', () => {
            expect(errorMessage('SQLITE_BUSY: database is locked')).toBe(
                'SQLite database is busy; another Spur process is holding the lock. Retry after the other command finishes.',
            );
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
