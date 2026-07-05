import { describe, expect, test } from 'bun:test';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { consoleOutput, toJson } from '../src/output';

describe('output', () => {
    describe('consoleOutput', () => {
        test('write and error are callable functions', () => {
            expect(typeof consoleOutput.write).toBe('function');
            expect(typeof consoleOutput.error).toBe('function');
        });

        test('write() emits the message to the configured stdout target', () => {
            const stdout = createBufferTarget();
            const rollback = setDefaultOutputTargets({ stdout });
            try {
                consoleOutput.write('hello world');
            } finally {
                rollback();
            }

            expect(stdout.text()).toBe('hello world\n');
        });

        test('error() emits the message to the configured stderr target', () => {
            const stderr = createBufferTarget();
            const rollback = setDefaultOutputTargets({ stderr });
            try {
                consoleOutput.error('boom');
            } finally {
                rollback();
            }

            expect(stderr.text()).toBe('boom\n');
        });

        test('write() and error() route to independent streams', () => {
            const stdout = createBufferTarget();
            const stderr = createBufferTarget();
            const rollback = setDefaultOutputTargets({ stdout, stderr });
            try {
                consoleOutput.write('to stdout');
                consoleOutput.error('to stderr');
            } finally {
                rollback();
            }

            expect(stdout.text()).toBe('to stdout\n');
            expect(stderr.text()).toBe('to stderr\n');
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
