import { describe, expect, test } from 'bun:test';
import { makeColorize, shouldColor } from '../src/colors';

describe('makeColorize', () => {
    test('wraps text in ANSI codes when enabled', () => {
        const color = makeColorize(true);
        expect(color.green('ok')).toBe('\x1b[32mok\x1b[0m');
        expect(color.red('bad')).toBe('\x1b[31mbad\x1b[0m');
        expect(color.yellow('warn')).toBe('\x1b[33mwarn\x1b[0m');
        expect(color.enabled).toBe(true);
    });

    test('is an identity function when disabled', () => {
        const color = makeColorize(false);
        expect(color.green('ok')).toBe('ok');
        expect(color.dim('x')).toBe('x');
        expect(color.enabled).toBe(false);
    });
});

describe('shouldColor', () => {
    test('colorizes only an interactive TTY by default', () => {
        expect(shouldColor({}, { isTTY: true })).toBe(true);
        expect(shouldColor({}, { isTTY: false })).toBe(false);
        expect(shouldColor({}, {})).toBe(false);
    });

    test('NO_COLOR disables color even on a TTY', () => {
        expect(shouldColor({ NO_COLOR: '1' }, { isTTY: true })).toBe(false);
        // Empty NO_COLOR is treated as unset.
        expect(shouldColor({ NO_COLOR: '' }, { isTTY: true })).toBe(true);
    });

    test('FORCE_COLOR enables color even without a TTY and overrides NO_COLOR', () => {
        expect(shouldColor({ FORCE_COLOR: '1' }, { isTTY: false })).toBe(true);
        expect(shouldColor({ FORCE_COLOR: '1', NO_COLOR: '1' }, { isTTY: false })).toBe(true);
        // FORCE_COLOR=0 means "do not force" — fall through to NO_COLOR / TTY rules.
        expect(shouldColor({ FORCE_COLOR: '0', NO_COLOR: '1' }, { isTTY: true })).toBe(false);
        expect(shouldColor({ FORCE_COLOR: '0' }, { isTTY: false })).toBe(false);
    });
});
