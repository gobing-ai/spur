import { describe, expect, it } from 'bun:test';
import { mergePluginConfig } from '../src/config';

describe('mergePluginConfig', () => {
    it('returns defaults when no overrides or env', () => {
        const result = mergePluginConfig({ key: 'val' }, null, {}, 'my-plugin');
        expect(result).toEqual({ key: 'val' });
    });

    it('overrides trump defaults', () => {
        const result = mergePluginConfig({ key: 'default', shared: 'def' }, { key: 'override' }, {}, 'my-plugin');
        expect(result.key).toBe('override');
        expect(result.shared).toBe('def');
    });

    it('env vars have highest precedence', () => {
        const result = mergePluginConfig(
            { key: 'default' },
            { key: 'override' },
            { SPUR_PLUGIN_MY_PLUGIN_KEY: 'env-val' },
            'my-plugin',
        );
        expect(result.key).toBe('env-val');
    });

    it('env var keys are lowercased', () => {
        const result = mergePluginConfig({}, null, { SPUR_PLUGIN_MY_PLUGIN_MY_CONFIG: '42' }, 'my-plugin');
        expect(result.my_config).toBe(42); // JSON-parsed number
    });

    it('env vars only match the correct plugin prefix', () => {
        const result = mergePluginConfig(
            { key: 'def' },
            null,
            {
                SPUR_PLUGIN_MY_PLUGIN_KEY: 'mine',
                SPUR_PLUGIN_OTHER_KEY: 'theirs',
            },
            'my-plugin',
        );
        expect(result.key).toBe('mine');
        expect(result.other).toBeUndefined();
    });

    it('env value is JSON-parsed (number)', () => {
        const result = mergePluginConfig({}, null, { SPUR_PLUGIN_P_K: '123' }, 'p');
        expect(result.k).toBe(123);
    });

    it('env value is JSON-parsed (boolean)', () => {
        const result = mergePluginConfig({}, null, { SPUR_PLUGIN_P_K: 'true' }, 'p');
        expect(result.k).toBe(true);
    });

    it('env value falls back to string on parse failure', () => {
        const result = mergePluginConfig({}, null, { SPUR_PLUGIN_P_K: 'hello world' }, 'p');
        expect(result.k).toBe('hello world');
    });

    it('overrides can add new keys', () => {
        const result = mergePluginConfig({ a: 1 }, { b: 2, c: 3 }, {}, 'plugin');
        expect(result).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('env only sets keys with matching prefix', () => {
        const result = mergePluginConfig({ a: 'x' }, null, { SPUR_PLUGIN_FOO_A: 'ya', RANDOM_VAR: 'nope' }, 'foo');
        expect(result.a).toBe('ya');
        expect(Object.keys(result)).toEqual(['a']);
    });
});
