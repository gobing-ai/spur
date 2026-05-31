import { describe, expect, test } from 'bun:test';
import { consoleOutput, toJson } from '../src/output';

describe('output', () => {
    describe('consoleOutput', () => {
        test('write and error are callable functions', () => {
            expect(typeof consoleOutput.write).toBe('function');
            expect(typeof consoleOutput.error).toBe('function');
        });
    });

    describe('toJson', () => {
        test('serializes objects', () => {
            const result = toJson({ ok: true });
            expect(result).toContain('"ok"');
            expect(result).toContain('true');
        });

        test('pretty-prints with 2-space indent', () => {
            const result = toJson({ a: 1 });
            expect(result).toContain('\n');
            expect(result).toContain('  ');
        });

        test('serializes arrays', () => {
            const result = toJson([1, 2, 3]);
            const parsed = JSON.parse(result);
            expect(parsed).toEqual([1, 2, 3]);
        });

        test('serializes null', () => {
            expect(toJson(null)).toBe('null');
        });

        test('serializes string', () => {
            const result = toJson('hello');
            expect(result).toBe('"hello"');
        });

        test('handles nested objects', () => {
            const result = toJson({ outer: { inner: 42 } });
            const parsed = JSON.parse(result);
            expect(parsed.outer.inner).toBe(42);
        });
    });
});
