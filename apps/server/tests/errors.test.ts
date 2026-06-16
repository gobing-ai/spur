import { describe, expect, test } from 'bun:test';
import { GuardDeniedError, LockTimeoutError } from '../src/errors';

describe('server errors', () => {
    test('GuardDeniedError has correct name', () => {
        const err = new GuardDeniedError('blocked');
        expect(err.name).toBe('GuardDeniedError');
        expect(err.message).toBe('blocked');
        expect(err).toBeInstanceOf(Error);
    });

    test('LockTimeoutError has correct name', () => {
        const err = new LockTimeoutError('timed out');
        expect(err.name).toBe('LockTimeoutError');
        expect(err.message).toBe('timed out');
        expect(err).toBeInstanceOf(Error);
    });
});
