import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import * as prompts from '@clack/prompts';
import { ClackHitlResponder } from '../../../src/workflow/hitl/clack-responder';

const CANCEL = Symbol('clack:cancel');
let selectResult: string | symbol = 'yes';
let textResult: string | symbol | undefined = 'typed';

function req(kind: 'confirm' | 'select' | 'input', options?: string[]) {
    return { kind, prompt: 'q', runId: 'r', node: 'n', ...(options ? { options } : {}) } as const;
}

describe('ClackHitlResponder', () => {
    beforeEach(() => {
        spyOn(prompts, 'select').mockImplementation((async () => selectResult) as typeof prompts.select);
        spyOn(prompts, 'text').mockImplementation((async () => textResult) as typeof prompts.text);
        spyOn(prompts, 'isCancel').mockImplementation(((v: unknown) => v === CANCEL) as typeof prompts.isCancel);
    });

    afterEach(() => {
        mock.restore();
    });

    test('constructs and exposes respond()', () => {
        const r = new ClackHitlResponder();
        expect(typeof r.respond).toBe('function');
    });

    describe('confirm', () => {
        test('returns the selected value (yes/no/cancel)', async () => {
            selectResult = 'no';
            const answer = await new ClackHitlResponder().respond(req('confirm'));
            expect(answer).toEqual({ value: 'no' });
        });

        test('maps a clack cancel to { value: cancel, cancelled: true }', async () => {
            selectResult = CANCEL;
            const answer = await new ClackHitlResponder().respond(req('confirm'));
            expect(answer).toEqual({ value: 'cancel', cancelled: true });
        });
    });

    describe('select', () => {
        test('returns the chosen option', async () => {
            selectResult = 'beta';
            const answer = await new ClackHitlResponder().respond(req('select', ['alpha', 'beta']));
            expect(answer).toEqual({ value: 'beta' });
        });

        test('maps a clack cancel to cancelled with empty value', async () => {
            selectResult = CANCEL;
            const answer = await new ClackHitlResponder().respond(req('select', ['alpha', 'beta']));
            expect(answer).toEqual({ value: '', cancelled: true });
        });

        test('tolerates a request with no options (empty list)', async () => {
            selectResult = '';
            const answer = await new ClackHitlResponder().respond(req('select'));
            expect(answer).toEqual({ value: '' });
        });
    });

    describe('input', () => {
        test('returns the typed text', async () => {
            textResult = 'fix the bug';
            const answer = await new ClackHitlResponder().respond(req('input'));
            expect(answer).toEqual({ value: 'fix the bug' });
        });

        test('coerces a nullish text result to empty string', async () => {
            textResult = undefined;
            const answer = await new ClackHitlResponder().respond(req('input'));
            expect(answer).toEqual({ value: '' });
        });

        test('maps a clack cancel to cancelled with empty value', async () => {
            textResult = CANCEL;
            const answer = await new ClackHitlResponder().respond(req('input'));
            expect(answer).toEqual({ value: '', cancelled: true });
        });
    });
});
