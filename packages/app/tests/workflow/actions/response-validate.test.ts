import { describe, expect, test } from 'bun:test';
import type { ActionRunContext } from '@gobing-ai/ts-dual-workflow-engine';
import {
    ResponseValidateActionRunner,
    type ResponseValidateEngine,
} from '../../../src/workflow/actions/response-validate';

function makeCtx(overrides: Partial<ActionRunContext> = {}): ActionRunContext {
    return { runId: 'test-1', stateOrNodeId: 's1', workdir: '/tmp', vars: {}, env: {}, ...overrides };
}

function mockEngine(result: { ok: boolean; reason: string; issues?: string[] }): ResponseValidateEngine {
    return {
        validate: (_text: string) => result,
    };
}

describe('ResponseValidateActionRunner', () => {
    test('returns ok:true when engine validates', async () => {
        const engine = mockEngine({ ok: true, reason: 'Task is complete' });
        const runner = new ResponseValidateActionRunner(engine);
        const result = await runner.execute({ text: 'some response text' }, makeCtx());
        expect(result.ok).toBe(true);
        expect(result.data).toEqual({ reason: 'Task is complete' });
        expect(result.error).toBeUndefined();
    });

    test('returns ok:false with reason when validation fails', async () => {
        const engine = mockEngine({ ok: false, reason: 'Missing source citations', issues: ['no sources'] });
        const runner = new ResponseValidateActionRunner(engine);
        const result = await runner.execute({ text: 'unverified claim' }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toBe('Missing source citations');
        expect(result.data).toEqual({ reason: 'Missing source citations', issues: ['no sources'] });
    });

    test('returns ok:false when text is missing', async () => {
        const engine = mockEngine({ ok: true, reason: 'ok' });
        const runner = new ResponseValidateActionRunner(engine);
        const result = await runner.execute({}, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('text is required');
    });

    test('returns ok:false when text is null', async () => {
        const engine = mockEngine({ ok: true, reason: 'ok' });
        const runner = new ResponseValidateActionRunner(engine);
        const result = await runner.execute({ text: null }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.error).toContain('text is required');
    });

    test('passes text to engine.validate', async () => {
        let capturedText = '';
        const engine: ResponseValidateEngine = {
            validate: (text: string) => {
                capturedText = text;
                return { ok: true, reason: 'ok' };
            },
        };
        const runner = new ResponseValidateActionRunner(engine);
        await runner.execute({ text: 'verify this response' }, makeCtx());
        expect(capturedText).toBe('verify this response');
    });

    test('ok result without issues omits issues from data', async () => {
        const engine = mockEngine({ ok: true, reason: 'all good' });
        const runner = new ResponseValidateActionRunner(engine);
        const result = await runner.execute({ text: 'text' }, makeCtx());
        expect(result.data).not.toHaveProperty('issues' as never);
    });

    test('fail result without issues omits issues from data', async () => {
        const engine = mockEngine({ ok: false, reason: 'failed' });
        const runner = new ResponseValidateActionRunner(engine);
        const result = await runner.execute({ text: 'text' }, makeCtx());
        expect(result.data).not.toHaveProperty('issues' as never);
    });

    test('empty string text is passed to engine (engine decides)', async () => {
        let capturedText: string = '';
        const engine: ResponseValidateEngine = {
            validate: (text: string) => {
                capturedText = text;
                return { ok: true, reason: 'empty ok' };
            },
        };
        const runner = new ResponseValidateActionRunner(engine);
        const result = await runner.execute({ text: '' }, makeCtx());
        expect(result.ok).toBe(true);
        expect(capturedText).toBe('');
    });

    test('kind is response.validate', () => {
        const engine = mockEngine({ ok: true, reason: 'ok' });
        const runner = new ResponseValidateActionRunner(engine);
        expect(runner.kind).toBe('response.validate');
    });
});
