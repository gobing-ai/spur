import { describe, expect, test } from 'bun:test';
import {
    checkExecutorIndependence,
    parseAgentRoutingIdentity,
    requiresDistinctExecutor,
} from '../../src/services/review-independence';

describe('requiresDistinctExecutor (0710 R4)', () => {
    test('P0 and P1 demand a distinct executor spec', () => {
        expect(requiresDistinctExecutor('P0')).toBe(true);
        expect(requiresDistinctExecutor('P1')).toBe(true);
    });

    test('lower priorities and unknown values allow executor reuse', () => {
        expect(requiresDistinctExecutor('P2')).toBe(false);
        expect(requiresDistinctExecutor('P4')).toBe(false);
        expect(requiresDistinctExecutor('')).toBe(false);
        expect(requiresDistinctExecutor(undefined)).toBe(false);
        expect(requiresDistinctExecutor(42)).toBe(false);
    });
});

describe('parseAgentRoutingIdentity (0710 R3)', () => {
    test('parses a well-formed bounded evidence blob', () => {
        const identity = parseAgentRoutingIdentity('{"agent":"pi","model":"x"}');
        expect(identity).toEqual({ agent: 'pi', model: 'x' });
    });

    test('model is optional', () => {
        expect(parseAgentRoutingIdentity('{"agent":"claude"}')).toEqual({ agent: 'claude' });
    });

    test('missing or malformed evidence resolves to unknown, never permissive', () => {
        expect(parseAgentRoutingIdentity(undefined)).toBeUndefined();
        expect(parseAgentRoutingIdentity('')).toBeUndefined();
        expect(parseAgentRoutingIdentity('not json')).toBeUndefined();
        expect(parseAgentRoutingIdentity('{"model":"x"}')).toBeUndefined();
        expect(parseAgentRoutingIdentity('{"agent":""}')).toBeUndefined();
        expect(parseAgentRoutingIdentity(7)).toBeUndefined();
    });
});

describe('checkExecutorIndependence (0710 R5)', () => {
    test('no distinctness requirement always passes', () => {
        const verdict = checkExecutorIndependence({
            priority: 'P2',
            requireDistinct: false,
            prior: undefined,
            current: { agent: 'claude' },
        });
        expect(verdict).toEqual({ ok: true });
    });

    test('missing implementation evidence fails closed, naming the remedy', () => {
        const verdict = checkExecutorIndependence({
            priority: 'P1',
            requireDistinct: true,
            prior: undefined,
            current: { agent: 'pi' },
        });
        expect(verdict.ok).toBe(false);
        if (!verdict.ok) expect(verdict.reason).toContain('__agentRouting_');
    });

    test('unresolvable reviewer routing fails closed', () => {
        const verdict = checkExecutorIndependence({
            priority: 'P0',
            requireDistinct: true,
            prior: { agent: 'claude' },
            current: undefined,
        });
        expect(verdict.ok).toBe(false);
        if (!verdict.ok) expect(verdict.reason).toContain('fail closed');
    });

    test('same executor as implementation fails closed, naming the configuration remedy', () => {
        const verdict = checkExecutorIndependence({
            priority: 'P1',
            requireDistinct: true,
            prior: { agent: 'claude' },
            current: { agent: 'claude' },
        });
        expect(verdict.ok).toBe(false);
        if (!verdict.ok) expect(verdict.reason).toContain("different executor than implementation ('claude')");
    });

    test('distinct executor passes', () => {
        const verdict = checkExecutorIndependence({
            priority: 'P1',
            requireDistinct: true,
            prior: { agent: 'claude' },
            current: { agent: 'pi' },
        });
        expect(verdict).toEqual({ ok: true });
    });
});
