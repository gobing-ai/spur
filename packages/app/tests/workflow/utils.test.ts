import { describe, expect, test } from 'bun:test';
import { NO_COLOR } from '../../src/workflow/utils';

describe('NO_COLOR', () => {
    test('passthrough returns input unchanged', () => {
        expect(NO_COLOR.dim('hello')).toBe('hello');
        expect(NO_COLOR.red('world')).toBe('world');
        expect(NO_COLOR.green('x')).toBe('x');
        expect(NO_COLOR.yellow('y')).toBe('y');
        expect(NO_COLOR.cyan('z')).toBe('z');
    });

    test('enabled is false', () => {
        expect(NO_COLOR.enabled).toBe(false);
    });
});
