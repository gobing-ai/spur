import { describe, expect, test } from 'bun:test';
import { parseArgs } from '../src/args';

describe('args parsing', () => {
    test('parses command and flags', () => {
        const result = parseArgs(['node', 'spur', 'status', '--json', '--since', '2026-01-01']);
        expect(result.command).toEqual(['node', 'spur']);
        expect(result.flags).toEqual({ json: true, since: '2026-01-01' });
        expect(result.positionals).toEqual(['status']);
    });

    test('parses positionals after --', () => {
        const result = parseArgs(['node', 'spur', 'inspect', '--json', '--', 'file1', 'file2']);
        expect(result.flags).toEqual({ json: true });
        expect(result.positionals).toEqual(['inspect', 'file1', 'file2']);
    });
});
