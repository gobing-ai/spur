import { describe, expect, test } from 'bun:test';
import { consoleOutput, toJson } from '../src/output';

describe('output', () => {
    test('consoleOutput is callable', () => {
        expect(typeof consoleOutput.write).toBe('function');
        expect(typeof consoleOutput.error).toBe('function');
    });

    test('toJson serializes values', () => {
        const result = toJson({ ok: true });
        expect(result).toContain('"ok"');
        expect(result).toContain('true');
    });
});
