import { describe, expect, test } from 'bun:test';
import type { ActionRunContext, HitlResponder } from '@gobing-ai/ts-dual-workflow-engine';
import { HitlInputActionRunner } from '../../../src/workflow/actions/hitl-input';

function makeCtx(overrides: Partial<ActionRunContext> = {}): ActionRunContext {
    return { runId: 'test-1', stateOrNodeId: 's1', workdir: '/tmp', vars: {}, env: {}, ...overrides };
}

describe('HitlInputActionRunner', () => {
    test('returns ok:true + setVars with input text', async () => {
        const responder: HitlResponder = { respond: async () => ({ value: 'fix the bug' }) };
        const runner = new HitlInputActionRunner(responder);
        const result = await runner.execute({ prompt: 'Describe:' }, makeCtx());
        expect(result.ok).toBe(true);
        expect(result.setVars).toEqual({ __hitlInput: 'fix the bug' });
        expect(runner.kind).toBe('hitl.input');
    });

    test('returns ok:false on cancel', async () => {
        const responder: HitlResponder = { respond: async () => ({ value: '', cancelled: true }) };
        const runner = new HitlInputActionRunner(responder);
        const result = await runner.execute({ prompt: 'Describe:' }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('cancelled');
    });

    test('returns ok:false on missing prompt', async () => {
        const responder: HitlResponder = { respond: async () => ({ value: 'text' }) };
        const runner = new HitlInputActionRunner(responder);
        const result = await runner.execute({}, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('prompt is required');
    });

    test('allows empty input (not required by default)', async () => {
        const responder: HitlResponder = { respond: async () => ({ value: '' }) };
        const runner = new HitlInputActionRunner(responder);
        const result = await runner.execute({ prompt: 'Describe:' }, makeCtx());
        expect(result.ok).toBe(true);
        expect(result.setVars).toEqual({ __hitlInput: '' });
    });

    test('uses custom var name for setVars', async () => {
        const responder: HitlResponder = { respond: async () => ({ value: 'step 1: update' }) };
        const runner = new HitlInputActionRunner(responder);
        const result = await runner.execute({ prompt: 'Next steps?', var: 'nextSteps' }, makeCtx());
        expect(result.ok).toBe(true);
        expect(result.setVars).toEqual({ nextSteps: 'step 1: update' });
    });
});
