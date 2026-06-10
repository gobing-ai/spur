import { describe, expect, test } from 'bun:test';
import type { ActionRunContext, HitlResponder } from '@gobing-ai/ts-dual-workflow-engine';
import { HitlSelectActionRunner } from '../../../src/workflow/actions/hitl-select';

function makeCtx(overrides: Partial<ActionRunContext> = {}): ActionRunContext {
    return { runId: 'test-1', stateOrNodeId: 's1', workdir: '/tmp', vars: {}, env: {}, ...overrides };
}

describe('HitlSelectActionRunner', () => {
    test('returns ok:true + setVars with chosen option', async () => {
        const responder: HitlResponder = { respond: async () => ({ value: 'alpha' }) };
        const runner = new HitlSelectActionRunner(responder);
        const result = await runner.execute({ prompt: 'Pick', options: ['alpha', 'beta'] }, makeCtx());
        expect(result.ok).toBe(true);
        expect(result.setVars).toEqual({ __hitlAnswer: 'alpha' });
        expect(runner.kind).toBe('hitl.select');
    });

    test('returns ok:false on cancel', async () => {
        const responder: HitlResponder = { respond: async () => ({ value: '', cancelled: true }) };
        const runner = new HitlSelectActionRunner(responder);
        const result = await runner.execute({ prompt: 'Pick', options: ['a'] }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('cancelled');
    });

    test('returns ok:false on empty options', async () => {
        const responder: HitlResponder = { respond: async () => ({ value: 'a' }) };
        const runner = new HitlSelectActionRunner(responder);
        const result = await runner.execute({ prompt: 'Pick', options: [] }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('options is required');
    });

    test('returns ok:false on missing options', async () => {
        const responder: HitlResponder = { respond: async () => ({ value: 'a' }) };
        const runner = new HitlSelectActionRunner(responder);
        const result = await runner.execute({ prompt: 'Pick' }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('options is required');
    });

    test('returns ok:false on missing prompt', async () => {
        const responder: HitlResponder = { respond: async () => ({ value: 'a' }) };
        const runner = new HitlSelectActionRunner(responder);
        const result = await runner.execute({ options: ['a'] }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('prompt is required');
    });

    test('uses custom var name for setVars', async () => {
        const responder: HitlResponder = { respond: async () => ({ value: 'deploy' }) };
        const runner = new HitlSelectActionRunner(responder);
        const result = await runner.execute(
            { prompt: 'Mode?', options: ['deploy', 'rollback'], var: 'mode' },
            makeCtx(),
        );
        expect(result.ok).toBe(true);
        expect(result.setVars).toEqual({ mode: 'deploy' });
    });

    test('forwards options to responder', async () => {
        let receivedOptions: string[] | undefined;
        const responder: HitlResponder = {
            respond: async (req) => {
                receivedOptions = req.options;
                return { value: req.options?.[0] ?? '' };
            },
        };
        const runner = new HitlSelectActionRunner(responder);
        await runner.execute({ prompt: 'Pick', options: ['x', 'y', 'z'] }, makeCtx());
        expect(receivedOptions).toEqual(['x', 'y', 'z']);
    });
});
