import { describe, expect, mock, test } from 'bun:test';

// Mock @clack/prompts so the responder's respond() switch can be exercised without a TTY.
// `select`/`text` return whatever the current mock yields; `isCancel` flags the cancel sentinel.
const CANCEL = Symbol('clack:cancel');
let selectResult: unknown = 'yes';
let textResult: unknown = 'typed';

mock.module('@clack/prompts', () => ({
    select: mock(async () => selectResult),
    text: mock(async () => textResult),
    isCancel: (v: unknown) => v === CANCEL,
}));

// Import AFTER the mock is registered so the responder binds to the mocked module.
const { ClackHitlResponder } = await import('../../../src/workflow/hitl/clack-responder');

function req(kind: 'confirm' | 'select' | 'input', options?: string[]) {
    return { kind, prompt: 'q', runId: 'r', node: 'n', ...(options ? { options } : {}) } as const;
}

describe('ClackHitlResponder', () => {
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
