import { describe, expect, test } from 'bun:test';
import type { AgentRunResult } from '@gobing-ai/ts-ai-runner';
import { buildRoutingAttribution, classifyObjectiveFailure } from '../../src/services/agent-routing-attribution';
import type { AgentResolveResult } from '../../src/services/agent-service';

const ok = (extra: Record<string, unknown>): AgentResolveResult =>
    ({ ok: true, agent: 'claude', source: 'role', ...extra }) as unknown as AgentResolveResult;

describe('buildRoutingAttribution', () => {
    test('a failed resolution carries no attribution', () => {
        expect(buildRoutingAttribution({ ok: false, exitCode: 1, message: 'no executor' })).toBeUndefined();
    });

    test('a resolution with neither tier nor executor carries no attribution', () => {
        expect(buildRoutingAttribution(ok({}))).toBeUndefined();
    });

    test('role, tier, executor, source and model are reported when resolved', () => {
        expect(buildRoutingAttribution(ok({ role: 'coder', tier: 'standard', executor: 'cc', model: 'm1' }))).toEqual({
            role: 'coder',
            tier: 'standard',
            executor: 'cc',
            source: 'role',
            model: 'm1',
        });
    });

    test('stage context fills tier and executor; missing values fall back to unknown / the agent', () => {
        expect(buildRoutingAttribution(ok({ stage: { executorTier: 'deep', executorName: 'codex-deep' } }))).toEqual({
            tier: 'deep',
            executor: 'codex-deep',
            source: 'role',
        });
        expect(buildRoutingAttribution(ok({ executor: 'cc' }))).toEqual({
            tier: 'unknown',
            executor: 'cc',
            source: 'role',
        });
        expect(buildRoutingAttribution(ok({ tier: 'standard' }))).toEqual({
            tier: 'standard',
            executor: 'claude',
            source: 'role',
        });
    });
});

describe('classifyObjectiveFailure', () => {
    test('success is not a failure; a signal is a timeout', () => {
        const base = { exitCode: 0, stdout: '', stderr: '' } as unknown as AgentRunResult;
        expect(classifyObjectiveFailure(base)).toBeUndefined();
        expect(classifyObjectiveFailure({ ...base, exitCode: 1, signal: 'SIGTERM' } as AgentRunResult)).toBe('timeout');
    });
});
