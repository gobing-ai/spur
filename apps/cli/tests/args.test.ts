import { describe, expect, test } from 'bun:test';
import { booleanFlag, parseArgs, stringFlag } from '../src/args';

describe('args parsing', () => {
    describe('parseArgs', () => {
        test('parses command and flags', () => {
            const result = parseArgs(['node', 'spur', 'status', '--json', '--since', '2026-01-01']);
            expect(result.command).toEqual(['node', 'spur']);
            expect(result.flags).toEqual({ json: true, since: '2026-01-01' });
            expect(result.positionals).toEqual(['status']);
        });

        test('parses positionals after --', () => {
            const result = parseArgs(['node', 'spur', 'status', '--json', '--', 'file1', 'file2']);
            expect(result.flags).toEqual({ json: true });
            expect(result.positionals).toEqual(['status', 'file1', 'file2']);
        });

        test('parses empty argv', () => {
            const result = parseArgs([]);
            expect(result.command).toEqual([]);
            expect(result.flags).toEqual({});
            expect(result.positionals).toEqual([]);
        });

        test('parses single command', () => {
            const result = parseArgs(['status']);
            expect(result.command).toEqual(['status']);
            expect(result.positionals).toEqual([]);
        });

        test('parses command and subcommand', () => {
            const result = parseArgs(['agent', 'doctor']);
            expect(result.command).toEqual(['agent', 'doctor']);
        });

        test('extra tokens after subcommand become positionals', () => {
            const result = parseArgs(['agent', 'doctor', 'claude']);
            expect(result.command).toEqual(['agent', 'doctor']);
            expect(result.positionals).toEqual(['claude']);
        });

        test('flag with string value', () => {
            const result = parseArgs(['rule', 'run', '--preset', 'strict']);
            expect(result.flags.preset).toBe('strict');
        });

        test('flag with no value becomes boolean true', () => {
            const result = parseArgs(['status', '--json']);
            expect(result.flags.json).toBe(true);
        });

        test('flag before next flag gets boolean true', () => {
            const result = parseArgs(['status', '--json', '--verbose']);
            expect(result.flags.json).toBe(true);
            expect(result.flags.verbose).toBe(true);
        });

        test('parses global short flag aliases', () => {
            expect(parseArgs(['-h']).flags.help).toBe(true);
            expect(parseArgs(['-v']).flags.verbose).toBe(true);
            expect(parseArgs(['-V']).flags.V).toBe(true);
        });

        test('stops parsing flags after --', () => {
            const result = parseArgs(['cmd', 'sub', '--', '--not-a-flag', 'value']);
            expect(result.flags).toEqual({});
            expect(result.positionals).toEqual(['--not-a-flag', 'value']);
        });

        test('skips undefined tokens', () => {
            const result = parseArgs(['cmd']);
            expect(result.command).toEqual(['cmd']);
        });
    });

    describe('stringFlag', () => {
        test('returns string value from flags', () => {
            expect(stringFlag({ preset: 'strict' }, 'preset', 'default')).toBe('strict');
        });

        test('returns fallback for missing flag', () => {
            expect(stringFlag({}, 'preset', 'default')).toBe('default');
        });

        test('returns fallback when flag is boolean true', () => {
            expect(stringFlag({ preset: true }, 'preset', 'default')).toBe('default');
        });
    });

    describe('booleanFlag', () => {
        test('returns true when flag is true', () => {
            expect(booleanFlag({ json: true }, 'json')).toBe(true);
        });

        test('returns false when flag is missing', () => {
            expect(booleanFlag({}, 'json')).toBe(false);
        });

        test('returns false when flag is a string', () => {
            expect(booleanFlag({ json: 'yes' }, 'json')).toBe(false);
        });
    });
});
