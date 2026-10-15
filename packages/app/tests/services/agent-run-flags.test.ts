import { describe, expect, test } from 'bun:test';
import {
    booleanFlag,
    jsonEnvelopeFlag,
    numberFlag,
    parseTagsFlag,
    stringFlag,
} from '../../src/services/agent-run-flags';

describe('agent run flag readers', () => {
    test('stringFlag returns string values and falls back otherwise', () => {
        expect(stringFlag({ mode: 'plan' }, 'mode', 'auto')).toBe('plan');
        expect(stringFlag({ mode: true }, 'mode', 'auto')).toBe('auto');
        expect(stringFlag({}, 'mode', 'auto')).toBe('auto');
    });

    test('booleanFlag is true only for a literal true', () => {
        expect(booleanFlag({ json: true }, 'json')).toBe(true);
        expect(booleanFlag({ json: 'true' }, 'json')).toBe(false);
        expect(booleanFlag({}, 'json')).toBe(false);
    });

    test('jsonEnvelopeFlag passes booleans through and drops anything else', () => {
        expect(jsonEnvelopeFlag({ jsonEnvelope: false })).toBe(false);
        expect(jsonEnvelopeFlag({ jsonEnvelope: true })).toBe(true);
        expect(jsonEnvelopeFlag({ jsonEnvelope: 'yes' })).toBeUndefined();
    });

    test('numberFlag parses numeric strings and rejects absent, boolean and NaN values', () => {
        expect(numberFlag({ timeout: '250' }, 'timeout')).toBe(250);
        expect(numberFlag({}, 'timeout')).toBeUndefined();
        expect(numberFlag({ timeout: true }, 'timeout')).toBeUndefined();
        expect(numberFlag({ timeout: 'soon' }, 'timeout')).toBeUndefined();
    });

    test('parseTagsFlag splits, trims and drops empty tags', () => {
        expect(parseTagsFlag({ tags: ' a, b ,,c ' })).toEqual(['a', 'b', 'c']);
        expect(parseTagsFlag({ tags: ' , ' })).toBeUndefined();
        expect(parseTagsFlag({})).toBeUndefined();
    });
});
