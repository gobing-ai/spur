import { describe, expect, test } from 'bun:test';
import type { ActionRunContext, HitlResponder } from '@gobing-ai/ts-dual-workflow-engine';
import { HitlConfirmActionRunner } from '../../../src/workflow/actions/hitl-confirm';

function makeCtx(overrides: Partial<ActionRunContext> = {}): ActionRunContext {
    return { runId: 'test-1', stateOrNodeId: 's1', workdir: '/tmp', vars: {}, env: {}, ...overrides };
}

describe('HitlConfirmActionRunner', () => {
    test('returns ok:true + setVars on yes', async () => {
        const responder: HitlResponder = { respond: async () => ({ value: 'yes' }) };
        const runner = new HitlConfirmActionRunner(responder);
        const result = await runner.execute({ prompt: 'Proceed?' }, makeCtx());
        expect(result.ok).toBe(true);
        expect(result.setVars).toEqual({ __hitlAnswer: 'yes' });
        expect(runner.kind).toBe('hitl.confirm');
    });

    test('returns ok:true + setVars on no', async () => {
        const responder: HitlResponder = { respond: async () => ({ value: 'no' }) };
        const runner = new HitlConfirmActionRunner(responder);
        const result = await runner.execute({ prompt: 'Proceed?' }, makeCtx());
        expect(result.ok).toBe(true);
        expect(result.setVars).toEqual({ __hitlAnswer: 'no' });
    });

    test('returns ok:false on cancel', async () => {
        const responder: HitlResponder = { respond: async () => ({ value: 'cancel', cancelled: true }) };
        const runner = new HitlConfirmActionRunner(responder);
        const result = await runner.execute({ prompt: 'Proceed?' }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('cancelled');
    });

    test('returns ok:false on missing prompt', async () => {
        const responder: HitlResponder = { respond: async () => ({ value: 'yes' }) };
        const runner = new HitlConfirmActionRunner(responder);
        const result = await runner.execute({}, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('prompt is required');
    });

    test('uses custom var name for setVars', async () => {
        const responder: HitlResponder = { respond: async () => ({ value: 'yes' }) };
        const runner = new HitlConfirmActionRunner(responder);
        const result = await runner.execute({ prompt: 'Approve?', var: 'approved' }, makeCtx());
        expect(result.ok).toBe(true);
        expect(result.setVars).toEqual({ approved: 'yes' });
    });
});
