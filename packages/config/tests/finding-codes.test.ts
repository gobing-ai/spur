import { expect, test } from 'bun:test';
import { ALL_FINDING_CODES, FINDING_CODES, isFindingCode } from '../src/finding-codes';

test('ALL_FINDING_CODES contains all registered finding codes', () => {
    expect(ALL_FINDING_CODES.length).toBeGreaterThan(30);
    for (const code of ALL_FINDING_CODES) {
        expect(isFindingCode(code)).toBe(true);
    }
    expect(isFindingCode('invalid.code')).toBe(false);
    expect(FINDING_CODES.L3_PLAN_FORMAT).toBe('L3.plan-format');
});
