import { beforeEach, describe, expect, it } from 'bun:test';
import { getLogger } from '@gobing-ai/ts-infra';
import { PluginCollisionError } from '../../src/plugin';
import { type CommandImpl, CommandRegistry } from '../../src/registries/command';
import { TrustEngine } from '../../src/trust';

// ── Helpers ──────────────────────────────────────────────────────────

function ctx(pluginName = 'test-plugin', trustLevel: 'bundled' | 'curated' | 'local' | 'untrusted' = 'curated') {
    return { source: trustLevel as 'bundled' | 'curated' | 'local' | 'untrusted', pluginName, trustLevel };
}

function makeImpl(name: string): CommandImpl {
    return { name, execute: (_args: string[]) => {} };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('CommandRegistry', () => {
    let trust: TrustEngine;
    let registry: CommandRegistry;

    beforeEach(() => {
        trust = new TrustEngine();
        registry = new CommandRegistry(trust, getLogger('test-command'));
    });

    describe('register / get', () => {
        it('registers and retrieves a command implementation', () => {
            const cmd = makeImpl('deploy');
            registry.register('deploy', cmd, ctx());
            const impl = registry.get('deploy');
            expect(impl).toBeDefined();
            expect(impl?.name).toBe('deploy');
        });

        it('returns undefined for unregistered commands', () => {
            expect(registry.get('nonexistent')).toBeUndefined();
        });
    });

    describe('collision', () => {
        it('throws PluginCollisionError on duplicate name', () => {
            const cmd1 = makeImpl('deploy');
            const cmd2 = makeImpl('deploy-alt');
            registry.register('deploy', cmd1, ctx('plugin-a'));
            expect(() => registry.register('deploy', cmd2, ctx('plugin-b'))).toThrow(PluginCollisionError);
        });

        it('collision message includes capability and existing plugin', () => {
            registry.register('deploy', makeImpl('deploy'), ctx('plugin-a'));
            try {
                registry.register('deploy', makeImpl('deploy-alt'), ctx('plugin-b'));
                expect.unreachable();
            } catch (err) {
                expect(err instanceof PluginCollisionError).toBe(true);
                expect((err as PluginCollisionError).message).toContain('commands');
                expect((err as PluginCollisionError).message).toContain('deploy');
            }
        });
    });

    describe('list', () => {
        it('returns empty array when no commands registered', () => {
            expect(registry.list()).toEqual([]);
        });

        it('returns all registered command names and sources', () => {
            registry.register('deploy', makeImpl('deploy'), ctx('plugin-a'));
            registry.register('status', makeImpl('status'), ctx('plugin-b'));
            const list = registry.list();
            expect(list).toHaveLength(2);
            expect(list.map((e) => e.name).sort()).toEqual(['deploy', 'status']);
            for (const e of list) expect(e.source).toBeDefined();
        });
    });

    describe('preRegister (built-in seeding)', () => {
        it('seeds a built-in command retrievable via get', () => {
            const cmd = makeImpl('core:help');
            registry.seedBuiltin('core:help', cmd);
            const impl = registry.get('core:help');
            expect(impl).toBeDefined();
            expect(impl?.name).toBe('core:help');
        });

        it('built-in entries appear in list with source builtin', () => {
            registry.seedBuiltin('core:help', makeImpl('core:help'));
            const list = registry.list();
            expect(list).toHaveLength(1);
            expect(list[0]?.source).toBe('builtin');
        });

        it('throws on built-in collision with existing built-in', () => {
            registry.seedBuiltin('core:help', makeImpl('core:help'));
            expect(() => registry.seedBuiltin('core:help', makeImpl('core:help-v2'))).toThrow(PluginCollisionError);
        });

        it('throws when plugin tries to register over a built-in', () => {
            registry.seedBuiltin('core:help', makeImpl('core:help'));
            expect(() => registry.register('core:help', makeImpl('override'), ctx())).toThrow(PluginCollisionError);
        });
    });
});
