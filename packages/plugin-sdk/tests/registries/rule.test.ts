import { beforeEach, describe, expect, it } from 'bun:test';
import { getLogger } from '@gobing-ai/ts-infra';
import { PluginCollisionError } from '../../src/plugin';
import { type RuleImpl, RuleRegistry } from '../../src/registries/rule';
import { TrustEngine } from '../../src/trust';

// ── Helpers ──────────────────────────────────────────────────────────

function ctx(pluginName = 'test-plugin', trustLevel: 'bundled' | 'curated' | 'local' | 'untrusted' = 'curated') {
    return {
        source: trustLevel as 'bundled' | 'curated' | 'local',
        pluginName,
        trustLevel,
    };
}

function makeImpl(pass: boolean, message = 'default'): RuleImpl {
    return {
        evaluate: (_context: Record<string, unknown>) => ({ pass, message }),
    };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('RuleRegistry', () => {
    let trust: TrustEngine;
    let registry: RuleRegistry;

    beforeEach(() => {
        trust = new TrustEngine();
        registry = new RuleRegistry(trust, getLogger('rule-registry'));
    });

    describe('register / get', () => {
        it('registers and retrieves a rule implementation', () => {
            const rule = makeImpl(true, 'passes');
            registry.register('my-rule', rule, ctx());
            expect(registry.get('my-rule')).toBe(rule);
        });

        it('returns undefined for unregistered names', () => {
            expect(registry.get('nonexistent')).toBeUndefined();
        });

        it('retrieves correct implementation among multiple registrations', () => {
            const a = makeImpl(true, 'a');
            const b = makeImpl(false, 'b');
            registry.register('rule-a', a, ctx());
            registry.register('rule-b', b, ctx());
            expect(registry.get('rule-a')).toBe(a);
            expect(registry.get('rule-b')).toBe(b);
        });
    });

    describe('collision', () => {
        it('throws PluginCollisionError on duplicate name', () => {
            registry.register('my-rule', makeImpl(true), ctx('plugin-a'));
            expect(() => registry.register('my-rule', makeImpl(false), ctx('plugin-b'))).toThrow(PluginCollisionError);
        });
    });

    describe('list', () => {
        it('returns empty list when nothing registered', () => {
            expect(registry.list()).toEqual([]);
        });

        it('returns all registered names and sources', () => {
            registry.register('rule-a', makeImpl(true), ctx('plugin-a'));
            registry.register('rule-b', makeImpl(false), ctx('plugin-b', 'bundled'));
            const list = registry.list();
            expect(list).toHaveLength(2);
            expect(list).toEqual(
                expect.arrayContaining([
                    { name: 'rule-a', source: 'curated' },
                    { name: 'rule-b', source: 'bundled' },
                ]),
            );
        });
    });

    describe('preRegister (built-in seeding)', () => {
        it('seeds a built-in rule retrievable via get', () => {
            const rule = makeImpl(true, 'builtin-rule');
            registry.seedBuiltin('builtin-rule', rule);
            expect(registry.get('builtin-rule')).toBe(rule);
        });

        it('lists built-in rules with source "builtin"', () => {
            registry.seedBuiltin('builtin-rule', makeImpl(true));
            expect(registry.list()).toEqual([{ name: 'builtin-rule', source: 'builtin' }]);
        });

        it('throws PluginCollisionError if a built-in conflicts with an existing registration', () => {
            registry.register('my-rule', makeImpl(true), ctx());
            expect(() => registry.seedBuiltin('my-rule', makeImpl(false))).toThrow(PluginCollisionError);
        });
    });
});
