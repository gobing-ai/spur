import { describe, expect, test } from 'bun:test';
import type { ActionRunContext } from '@gobing-ai/ts-dual-workflow-engine';
import type { RuleService } from '../../../src/services/rule-service';
import { RuleCheckActionRunner } from '../../../src/workflow/actions/rule-check';

interface MockEvaluateOptions {
    preset: string;
    rule?: string;
    failOn?: string;
}

interface MockEvaluateResult {
    exitCode: number;
    findings: Array<{ severity: string; message: string }>;
    preset: string;
    ruleCount: number;
}

function makeCtx(): ActionRunContext {
    return { runId: 'test-1', stateOrNodeId: 's1', workdir: '/tmp', vars: {}, env: {} };
}

describe('RuleCheckActionRunner', () => {
    test('returns ok:true when rule service passes', async () => {
        const svc = {
            evaluate: async (): Promise<MockEvaluateResult> => ({
                exitCode: 0,
                findings: [],
                preset: 'rec',
                ruleCount: 10,
            }),
        };
        const runner = new RuleCheckActionRunner(svc as unknown as RuleService);
        const result = await runner.execute({}, makeCtx());
        expect(result.ok).toBe(true);
        expect(runner.kind).toBe('rule.check');
    });

    test('returns ok:false when rule service fails', async () => {
        const svc = {
            evaluate: async (): Promise<MockEvaluateResult> => ({
                exitCode: 1,
                findings: [{ severity: 'error', message: 'bad' }],
                preset: 'rec',
                ruleCount: 1,
            }),
        };
        const runner = new RuleCheckActionRunner(svc as unknown as RuleService);
        const result = await runner.execute({}, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('finding(s)');
    });

    test('forwards preset, rule, failOn to service', async () => {
        let captured!: MockEvaluateOptions;
        const svc = {
            evaluate: async (opts: MockEvaluateOptions): Promise<MockEvaluateResult> => {
                captured = opts;
                return { exitCode: 0, findings: [], preset: opts.preset, ruleCount: 0 };
            },
        };
        const runner = new RuleCheckActionRunner(svc as unknown as RuleService);
        await runner.execute({ preset: 'custom', rule: 'r1', failOn: 'warning' }, makeCtx());
        expect(captured.preset).toBe('custom');
        expect(captured.rule).toBe('r1');
        expect(captured.failOn).toBe('warning');
    });

    test('defaults preset to recommended-pre-check', async () => {
        let captured!: MockEvaluateOptions;
        const svc = {
            evaluate: async (opts: MockEvaluateOptions): Promise<MockEvaluateResult> => {
                captured = opts;
                return { exitCode: 0, findings: [], preset: opts.preset, ruleCount: 0 };
            },
        };
        const runner = new RuleCheckActionRunner(svc as unknown as RuleService);
        await runner.execute({}, makeCtx());
        expect(captured.preset).toBe('recommended-pre-check');
    });
});
