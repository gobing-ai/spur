import { describe, expect, test } from 'bun:test';
import { splitLaunchCommand } from '../../src/workflow/split-launch-command';

describe('splitLaunchCommand', () => {
    test('splits a multi-token launch string into argv head and leading args', () => {
        const split = splitLaunchCommand('/usr/bin/bun /repo/apps/cli/src/index.ts', 'idea-handoff "spurBin"');
        expect('error' in split).toBe(false);
        if (!('error' in split)) {
            expect(split.command).toBe('/usr/bin/bun');
            expect(split.leadingArgs).toEqual(['/repo/apps/cli/src/index.ts']);
        }
    });

    test('a single token yields an empty leadingArgs', () => {
        const split = splitLaunchCommand('spur', 'idea-handoff "spurBin"');
        expect('error' in split).toBe(false);
        if (!('error' in split)) {
            expect(split.command).toBe('spur');
            expect(split.leadingArgs).toEqual([]);
        }
    });

    test('collapses repeated whitespace instead of emitting empty argv tokens', () => {
        const split = splitLaunchCommand('  bun   /repo/entry.ts  ', 'idea-handoff "spurBin"');
        expect('error' in split).toBe(false);
        if (!('error' in split)) {
            expect(split.command).toBe('bun');
            expect(split.leadingArgs).toEqual(['/repo/entry.ts']);
        }
    });

    test('rejects a launch string carrying shell metacharacters, naming the caller label', () => {
        const split = splitLaunchCommand('spur; rm -rf /', 'idea-handoff "spurBin"');
        expect('error' in split).toBe(true);
        if ('error' in split) {
            expect(split.error).toContain('idea-handoff "spurBin" must not contain shell metacharacters');
        }
    });

    test('rejects an empty launch string with the caller option key', () => {
        const split = splitLaunchCommand('   ', 'doctor.probe "spurBin"');
        expect('error' in split).toBe(true);
        if ('error' in split) {
            expect(split.error).toBe('Action option "spurBin" must be a non-empty string');
        }
    });
});
