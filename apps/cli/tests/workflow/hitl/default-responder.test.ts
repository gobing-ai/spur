import { describe, expect, test } from 'bun:test';
import { DefaultHitlResponder } from '../../../src/workflow/hitl/default-responder';

describe('DefaultHitlResponder', () => {
    test('confirm returns yes by default', async () => {
        const r = new DefaultHitlResponder();
        const answer = await r.respond({ kind: 'confirm', prompt: 'Proceed?', runId: 'r1', node: 's1' });
        expect(answer.value).toBe('yes');
    });

    test('confirm returns configured default', async () => {
        const r = new DefaultHitlResponder({ confirmDefault: 'no' });
        const answer = await r.respond({ kind: 'confirm', prompt: 'Proceed?', runId: 'r1', node: 's1' });
        expect(answer.value).toBe('no');
    });

    test('select returns first option by default', async () => {
        const r = new DefaultHitlResponder();
        const answer = await r.respond({
            kind: 'select',
            prompt: 'Pick',
            options: ['a', 'b', 'c'],
            runId: 'r1',
            node: 's1',
        });
        expect(answer.value).toBe('a');
    });

    test('select returns configured index', async () => {
        const r = new DefaultHitlResponder({ selectDefaultIndex: 2 });
        const answer = await r.respond({
            kind: 'select',
            prompt: 'Pick',
            options: ['a', 'b', 'c'],
            runId: 'r1',
            node: 's1',
        });
        expect(answer.value).toBe('c');
    });

    test('select clamps index to valid range', async () => {
        const r = new DefaultHitlResponder({ selectDefaultIndex: 99 });
        const answer = await r.respond({
            kind: 'select',
            prompt: 'Pick',
            options: ['a', 'b'],
            runId: 'r1',
            node: 's1',
        });
        expect(answer.value).toBe('b');
    });

    test('select returns empty string for empty options', async () => {
        const r = new DefaultHitlResponder();
        const answer = await r.respond({ kind: 'select', prompt: 'Pick', options: [], runId: 'r1', node: 's1' });
        expect(answer.value).toBe('');
    });

    test('input returns empty string by default', async () => {
        const r = new DefaultHitlResponder();
        const answer = await r.respond({ kind: 'input', prompt: 'Describe:', runId: 'r1', node: 's1' });
        expect(answer.value).toBe('');
    });

    test('input returns configured default', async () => {
        const r = new DefaultHitlResponder({ inputDefault: 'n/a' });
        const answer = await r.respond({ kind: 'input', prompt: 'Describe:', runId: 'r1', node: 's1' });
        expect(answer.value).toBe('n/a');
    });
});
