import { describe, expect, test } from 'bun:test';
import { getAppOptions, getEnvVar, removeEnvVar, setEnvVar, spurConfigSchema } from '@gobing-ai/spur-config';

describe('bootstrap.options (task 0902)', () => {
    test('spurConfigSchema accepts bootstrap.options as a free-form record', () => {
        const parsed = spurConfigSchema.parse({
            bootstrap: { options: { diagnosticEvents: true, eventRetentionDefault: 5000 } },
        });
        expect(parsed.bootstrap?.options).toEqual({ diagnosticEvents: true, eventRetentionDefault: 5000 });
    });

    test('bootstrap section is optional and options default to undefined', () => {
        expect(spurConfigSchema.parse({}).bootstrap).toBeUndefined();
        expect(spurConfigSchema.parse({ bootstrap: {} }).bootstrap?.options).toBeUndefined();
    });

    test('getAppOptions returns the typed value when present', () => {
        const config = spurConfigSchema.parse({ bootstrap: { options: { diagnosticEvents: true } } });
        expect(getAppOptions(config, 'diagnosticEvents', false)).toBe(true);
    });

    test('getAppOptions falls back when config, section, or key is absent/null', () => {
        expect(getAppOptions(null, 'diagnosticEvents', false)).toBe(false);
        expect(getAppOptions(undefined, 'k', 7)).toBe(7);
        expect(getAppOptions(spurConfigSchema.parse({}), 'k', 'x')).toBe('x');
        expect(getAppOptions(spurConfigSchema.parse({ bootstrap: { options: { other: 1 } } }), 'k', 'x')).toBe('x');
        // Explicit null in YAML is treated as absent.
        expect(getAppOptions(spurConfigSchema.parse({ bootstrap: { options: { k: null } } }), 'k', 3)).toBe(3);
    });
});

describe('getEnvVar (task 0902 wave 2)', () => {
    const KEY = 'SPUR_TEST_GET_ENV_VAR';

    test('returns the set value; empty string counts as set', () => {
        setEnvVar(KEY, '1');
        expect(getEnvVar(KEY)).toBe('1');
        setEnvVar(KEY, '');
        expect(getEnvVar(KEY, 'fb')).toBe('');
        removeEnvVar(KEY);
    });

    test('falls back only when unset', () => {
        removeEnvVar(KEY);
        expect(getEnvVar(KEY)).toBeUndefined();
        expect(getEnvVar(KEY, 'fb')).toBe('fb');
    });
});
