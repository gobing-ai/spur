/**
 * Task 0890 R1/R5: `agent.executors[].disabled` accepts the boolean form and the
 * ownership object form; `normalizeExecutorAvailability` is the single reader of
 * the raw shape (bare `true` → operator-owned; `false` → enabled, ownerless).
 */

import { describe, expect, test } from 'bun:test';
import { AgentExecutorConfigSchema, normalizeExecutorAvailability } from '../src/index';

describe('AgentExecutorConfigSchema.disabled (0890 R1)', () => {
    test('accepts bare booleans and the ownership object (round-trip both forms)', () => {
        const base = { name: 'alpha', agent: 'omp' };
        expect(AgentExecutorConfigSchema.parse({ ...base, disabled: true }).disabled).toBe(true);
        expect(AgentExecutorConfigSchema.parse({ ...base, disabled: false }).disabled).toBe(false);
        const object = {
            owner: 'quota',
            since: '2026-02-14T09:30:00.000Z',
            reason: 'agent.quota.exhausted alpha',
        } as const;
        expect(AgentExecutorConfigSchema.parse({ ...base, disabled: object }).disabled).toEqual(object);
        // Omitted defaults to enabled after the merge.
        expect(AgentExecutorConfigSchema.parse(base).disabled).toBe(false);
    });

    test('rejects malformed ownership objects and non-boolean scalars', () => {
        const base = { name: 'alpha', agent: 'omp' };
        const cases: Array<Record<string, unknown>> = [
            { owner: 'bogus', since: '2026-02-14T09:30:00.000Z', reason: 'x' },
            { owner: 'quota', since: '2026-02-14 09:30:00', reason: 'x' },
            { owner: 'quota', since: '2026-02-14T09:30:00.000Z' }, // reason missing
            { owner: 'quota', since: '2026-02-14T09:30:00.000Z', reason: '' },
        ];
        for (const disabled of [...cases, 'true', 1, null]) {
            expect(() => AgentExecutorConfigSchema.parse({ ...base, disabled })).toThrow();
        }
    });
});

describe('normalizeExecutorAvailability (0890 R1)', () => {
    test('a bare true is operator-owned without provenance', () => {
        expect(normalizeExecutorAvailability(true)).toEqual({
            disabled: true,
            owner: 'operator',
            since: undefined,
            reason: undefined,
        });
    });

    test('false and undefined-carrying enabled entries have no owner', () => {
        expect(normalizeExecutorAvailability(false)).toEqual({
            disabled: false,
            owner: undefined,
            since: undefined,
            reason: undefined,
        });
    });

    test('the object form passes its owner, since and reason through', () => {
        const disabled = { owner: 'probe' as const, since: '2026-02-14T10:00:00.000Z', reason: 'probe failure' };
        expect(normalizeExecutorAvailability(disabled)).toEqual({
            disabled: true,
            owner: 'probe',
            since: '2026-02-14T10:00:00.000Z',
            reason: 'probe failure',
        });
    });
});
