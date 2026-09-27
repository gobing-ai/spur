import { describe, expect, test } from 'bun:test';
import {
    type AgentExecutorConfig,
    cheapestEligibleExecutors,
    executorDisabled,
    getExecutorTier,
} from '../../src/services/executor-tier';

// Task 0965 (feature B21): direct coverage for the executor-tier policy leaf.
// Invariants under test: 0343 (declared tier wins; inference yields only
// cheap/standard/capable-1), 0890 (single availability reader for boolean and
// object `disabled` forms), 0543 R1 (single role→executor funnel ordering).

function executor(overrides: Partial<AgentExecutorConfig> & { name: string }): AgentExecutorConfig {
    return { agent: 'claude', disabled: false, ...overrides };
}

describe('getExecutorTier (0343 tier resolution)', () => {
    test('declared tier wins over inference', () => {
        // `haiku` would infer `cheap`; the explicit declaration must win.
        expect(getExecutorTier(executor({ name: 'declared', model: 'haiku', tier: 'capable-2' }))).toBe('capable-2');
    });

    test('legacy bare `capable` maps to `capable-1`', () => {
        expect(getExecutorTier(executor({ name: 'legacy', tier: 'capable' as never }))).toBe('capable-1');
    });

    test.each([
        ['cheap keyword', { name: 'fast-dev', model: 'claude-haiku-4' }, 'cheap'],
        ['capable-1 keyword', { name: 'deep-work', model: 'o3' }, 'capable-1'],
        ['name+model+agent combined', { name: 'plain', model: undefined, agent: 'mini-agent' }, 'cheap'],
        ['standard fallback', { name: 'worker', model: 'gpt-5.2' }, 'standard'],
    ] as const)('inference: %s', (_label, partial, expected) => {
        expect(getExecutorTier(executor(partial))).toBe(expected);
    });

    test('inference never yields capable-2/capable-3 from any branch', () => {
        const inferred = ['cheap-dev', 'opus-x', 'sonnet-9', 'r1', 'o1-preview', 'expert-mode', 'mystery'].map((name) =>
            getExecutorTier(executor({ name })),
        );
        expect(inferred.every((t) => t === 'cheap' || t === 'standard' || t === 'capable-1')).toBe(true);
    });
});

describe('executorDisabled (0890 single availability reader)', () => {
    test.each([
        ['boolean true', true, true],
        ['boolean false', false, false],
        ['object form', { owner: 'quota', since: '2026-01-01', reason: 'exhausted' }, true],
        ['undefined executor', undefined, false],
    ] as const)('%s', (_label, raw, expected) => {
        const input = raw === undefined ? undefined : executor({ name: 'e', disabled: raw });
        expect(executorDisabled(input)).toBe(expected);
    });

    test('undefined disabled field on a raw config object means enabled', () => {
        expect(executorDisabled({ name: 'legacy', agent: 'codex' } as AgentExecutorConfig)).toBe(false);
    });
});

describe('cheapestEligibleExecutors (0543 R1 single funnel)', () => {
    const roster: AgentExecutorConfig[] = [
        executor({ name: 'capable-2', tier: 'capable-2' }),
        executor({ name: 'cheap', tier: 'cheap' }),
        executor({ name: 'gated', tier: 'capable-1', disabled: true }),
        executor({
            name: 'object-disabled',
            tier: 'capable-1',
            disabled: { owner: 'quota', since: '2026-01-01', reason: 'x' },
        }),
        executor({ name: 'standard', tier: 'standard' }),
        executor({ name: 'below', tier: 'cheap' }),
    ];

    test('filters disabled (both forms), filters below minTier, sorts ascending by tier rank', () => {
        expect(cheapestEligibleExecutors(roster, 'capable-1').map((e) => e.name)).toEqual(['capable-2']);
    });

    test('lower minTier admits cheaper executors first', () => {
        expect(cheapestEligibleExecutors(roster, 'standard').map((e) => e.name)).toEqual(['standard', 'capable-2']);
    });

    test('minimum minTier keeps full ascending order (stable within equal tiers)', () => {
        expect(cheapestEligibleExecutors(roster, 'cheap').map((e) => e.name)).toEqual([
            'cheap',
            'below',
            'standard',
            'capable-2',
        ]);
    });

    test('empty roster → empty funnel', () => {
        expect(cheapestEligibleExecutors([], 'cheap')).toEqual([]);
    });
});
