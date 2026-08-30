import { describe, expect, test } from 'bun:test';

import {
    evaluateAgentBudget,
    normalizeAgentUsage,
    parseAgentBudget,
    totalMeasuredTokens,
    unavailableAgentUsage,
} from '../../src/services/agent-usage';

describe('normalizeAgentUsage', () => {
    test('absent/legacy input degrades to honest unavailable — never zeros', () => {
        for (const raw of [undefined, null, 'unavailable']) {
            const usage = normalizeAgentUsage(raw, 'no structured usage from runner');
            expect(usage.availability).toBe('unavailable');
            expect(usage.unavailabilityReason).toBe('no structured usage from runner');
            expect(usage.inputTokens).toBeUndefined();
            expect(usage.outputTokens).toBeUndefined();
        }
    });

    test('non-object non-legacy payloads fail closed with a malformed-payload reason', () => {
        for (const raw of [42, true]) {
            const usage = normalizeAgentUsage(raw);
            expect(usage.availability).toBe('unavailable');
            expect(usage.unavailabilityReason).toContain('malformed usage payload');
        }
    });

    test('unavailable-marked payload keeps its reason; unknown availability fails closed', () => {
        const kept = normalizeAgentUsage({ availability: 'unavailable', unavailabilityReason: 'adapter silent' });
        expect(kept).toEqual({ availability: 'unavailable', unavailabilityReason: 'adapter silent' });
        const unknown = normalizeAgentUsage({ availability: 'maybe' });
        expect(unknown.availability).toBe('unavailable');
        expect(unknown.unavailabilityReason).toContain('unknown usage availability');
    });

    test('measured payload keeps only valid typed fields; malformed fields are dropped', () => {
        const usage = normalizeAgentUsage({
            availability: 'measured',
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: -1,
            cacheWriteTokens: Number.NaN,
            costUsd: 0.25,
            source: 'unit',
            measuredAt: '2026-01-01T00:00:00Z',
            bogus: 'dropped',
        });
        expect(usage).toEqual({
            availability: 'measured',
            inputTokens: 10,
            outputTokens: 5,
            costUsd: 0.25,
            source: 'unit',
            measuredAt: '2026-01-01T00:00:00Z',
        });
    });

    test('overlong free-text fields are bounded', () => {
        const usage = normalizeAgentUsage({
            availability: 'measured',
            source: 'x'.repeat(500),
        });
        const source = usage.source;
        if (source === undefined) throw new Error('source should be present');
        expect(source.length).toBeLessThanOrEqual(201);
    });
});

describe('totalMeasuredTokens', () => {
    test('undefined when nothing token-shaped was reported', () => {
        expect(totalMeasuredTokens(unavailableAgentUsage())).toBeUndefined();
        expect(totalMeasuredTokens({ availability: 'measured', costUsd: 1 })).toBeUndefined();
    });

    test('sums only reported token fields', () => {
        const usage = normalizeAgentUsage({
            availability: 'measured',
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 30,
            cacheWriteTokens: 5,
        });
        expect(totalMeasuredTokens(usage)).toBe(155);
    });
});

describe('parseAgentBudget', () => {
    test('absent options yield no budget', () => {
        expect(parseAgentBudget({})).toEqual({});
        expect(parseAgentBudget({ maxTokens: undefined })).toEqual({});
    });

    test('string numbers are accepted; invalid values rejected', () => {
        expect(parseAgentBudget({ maxTokens: '5000' })).toEqual({ budget: { maxTokens: 5000 } });
        expect(parseAgentBudget({ maxCostUsd: '1.5' }).budget).toEqual({ maxCostUsd: 1.5 });
        expect(parseAgentBudget({ maxTokens: 0 }).error).toContain('maxTokens');
        expect(parseAgentBudget({ maxTokens: -5 }).error).toContain('maxTokens');
        expect(parseAgentBudget({ maxCostUsd: Number.NaN }).error).toContain('maxCostUsd');
        expect(parseAgentBudget({ maxTokens: 'abc' }).error).toContain('maxTokens');
    });
});

describe('evaluateAgentBudget', () => {
    test('no budget is within', () => {
        expect(evaluateAgentBudget(unavailableAgentUsage(), {})).toEqual({ verdict: 'within' });
    });

    test('measured usage under the cap is within', () => {
        const usage = normalizeAgentUsage({ availability: 'measured', inputTokens: 100, outputTokens: 50 });
        expect(evaluateAgentBudget(usage, { maxTokens: 200 })).toEqual({ verdict: 'within' });
    });

    test('measured usage over the cap reports violations (R6)', () => {
        const usage = normalizeAgentUsage({ availability: 'measured', inputTokens: 150, outputTokens: 100 });
        const result = evaluateAgentBudget(usage, { maxTokens: 200 });
        expect(result.verdict).toBe('over');
        if (result.verdict === 'over') expect(result.violations[0]).toContain('250 exceed maxTokens 200');
    });

    test('missing costUsd against maxCostUsd is unverifiable — fail closed, never estimated (R5)', () => {
        const usage = normalizeAgentUsage({ availability: 'measured', inputTokens: 10 });
        const result = evaluateAgentBudget(usage, { maxCostUsd: 1 });
        expect(result.verdict).toBe('unverifiable');
        if (result.verdict === 'unverifiable') expect(result.reason).toContain('costUsd not reported');
    });

    test('unavailable usage with any cap is unverifiable (fail closed)', () => {
        const result = evaluateAgentBudget(unavailableAgentUsage(), { maxTokens: 100, maxCostUsd: 1 });
        expect(result.verdict).toBe('unverifiable');
        if (result.verdict === 'unverifiable') {
            expect(result.reason).toContain('no token counts reported');
            expect(result.reason).toContain('costUsd not reported');
        }
    });
});
