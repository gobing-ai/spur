import { describe, expect, test } from 'bun:test';
import { GuardDeniedError, hitlAutoApproveEnabled, hitlConfirmDefault, LockTimeoutError } from '../src/errors';

describe('GuardDeniedError', () => {
    test('carries name and message for instanceof mapping', () => {
        const err = new GuardDeniedError('blocked');
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(GuardDeniedError);
        expect(err.name).toBe('GuardDeniedError');
        expect(err.message).toBe('blocked');
    });
});

describe('LockTimeoutError', () => {
    test('carries name and message for instanceof mapping', () => {
        const err = new LockTimeoutError('timed out');
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(LockTimeoutError);
        expect(err.name).toBe('LockTimeoutError');
        expect(err.message).toBe('timed out');
    });
});

describe('hitlConfirmDefault / hitlAutoApproveEnabled', () => {
    test('defaults to deny when env is empty or unset', () => {
        expect(hitlAutoApproveEnabled(undefined)).toBe(false);
        expect(hitlAutoApproveEnabled({})).toBe(false);
        expect(hitlConfirmDefault()).toBe('no');
        expect(hitlConfirmDefault({})).toBe('no');
    });

    test('opt-in only when SPUR_HITL_AUTO_APPROVE is exactly "1"', () => {
        expect(hitlAutoApproveEnabled({ SPUR_HITL_AUTO_APPROVE: '1' })).toBe(true);
        expect(hitlConfirmDefault({ SPUR_HITL_AUTO_APPROVE: '1' })).toBe('yes');
        // Non-exact values must not open the gate.
        expect(hitlAutoApproveEnabled({ SPUR_HITL_AUTO_APPROVE: 'true' })).toBe(false);
        expect(hitlConfirmDefault({ SPUR_HITL_AUTO_APPROVE: 'true' })).toBe('no');
        expect(hitlConfirmDefault({ SPUR_HITL_AUTO_APPROVE: '0' })).toBe('no');
    });
});
