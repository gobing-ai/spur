import { beforeEach, describe, expect, it } from 'bun:test';
import { EventBus } from '@gobing-ai/ts-infra';
import type { SpurEventMap } from '../src/events';
import { PluginHost } from '../src/host';
import type { SpurPlugin } from '../src/plugin';
import { ApiRegistry } from '../src/registries/api';
import { CommandRegistry } from '../src/registries/command';
import { EventRegistry as EventRegSubclass } from '../src/registries/event';
import { HarnessRegistry } from '../src/registries/harness';
import { ProviderRegistry } from '../src/registries/provider';
import { RuleRegistry } from '../src/registries/rule';
import { SkillRegistry } from '../src/registries/skill';
import { UiRegistry } from '../src/registries/ui';
import { WorkerRegistry } from '../src/registries/worker';

describe('PluginHost', () => {
    let bus: EventBus<SpurEventMap>;
    let host: PluginHost;

    beforeEach(() => {
        bus = new EventBus<SpurEventMap>();
        host = new PluginHost(bus);
    });

    it('creates all 8 registries', () => {
        expect(host.commands).toBeInstanceOf(CommandRegistry);
        expect(host.api).toBeInstanceOf(ApiRegistry);
        expect(host.ui).toBeInstanceOf(UiRegistry);
        expect(host.events).toBeInstanceOf(EventRegSubclass);
        expect(host.harnesses).toBeInstanceOf(HarnessRegistry);
        expect(host.providers).toBeInstanceOf(ProviderRegistry);
        expect(host.rules).toBeInstanceOf(RuleRegistry);
        expect(host.skills).toBeInstanceOf(SkillRegistry);
        expect(host.workers).toBeInstanceOf(WorkerRegistry);
    });

    it('has a logger and trust engine', () => {
        expect(host.logger).toBeDefined();
        expect(host.trust).toBeDefined();
    });

    it('loads a plugin and invokes onLoad', async () => {
        let loaded = false;
        const plugin: SpurPlugin = {
            name: 'test-plugin',
            version: '1.0.0',
            trust: 'curated',
            onLoad: () => {
                loaded = true;
            },
        };
        await host.loadPlugin(plugin, {
            source: 'curated',
            pluginName: 'test-plugin',
            trustLevel: 'curated',
        });
        expect(loaded).toBe(true);
        expect(host.isLoaded('test-plugin')).toBe(true);
    });

    it('plugin onLoad can register a command', async () => {
        const plugin: SpurPlugin = {
            name: 'cmd-plugin',
            version: '1.0.0',
            trust: 'curated',
            onLoad: (h) => {
                h.commands.register(
                    'cmd.test',
                    {
                        name: 'cmd.test',
                        execute: () => {},
                    },
                    { source: 'curated', pluginName: 'cmd-plugin', trustLevel: 'curated' },
                );
            },
        };
        await host.loadPlugin(plugin, {
            source: 'curated',
            pluginName: 'cmd-plugin',
            trustLevel: 'curated',
        });
        const cmd = host.commands.get('cmd.test');
        expect(cmd).toBeDefined();
        expect(cmd?.name).toBe('cmd.test');
    });

    it('prevents double-loading the same plugin', async () => {
        const plugin: SpurPlugin = {
            name: 'dup-plugin',
            version: '1.0.0',
            trust: 'curated',
            onLoad: () => {},
        };
        await host.loadPlugin(plugin, {
            source: 'curated',
            pluginName: 'dup-plugin',
            trustLevel: 'curated',
        });
        await expect(
            host.loadPlugin(plugin, {
                source: 'curated',
                pluginName: 'dup-plugin',
                trustLevel: 'curated',
            }),
        ).rejects.toThrow("Plugin 'dup-plugin' is already loaded");
    });

    it('unloads a plugin and calls onUnload', async () => {
        let unloaded = false;
        const plugin: SpurPlugin = {
            name: 'unload-test',
            version: '1.0.0',
            trust: 'curated',
            onLoad: () => {},
            onUnload: () => {
                unloaded = true;
            },
        };
        await host.loadPlugin(plugin, {
            source: 'curated',
            pluginName: 'unload-test',
            trustLevel: 'curated',
        });
        await host.unloadPlugin('unload-test');
        expect(unloaded).toBe(true);
        expect(host.isLoaded('unload-test')).toBe(false);
    });

    it('unloadPlugin is no-op for unknown name', async () => {
        await expect(host.unloadPlugin('nonexistent')).resolves.toBeUndefined();
    });

    it('startServerHooks invokes onServerStart on loaded plugins that implement it', async () => {
        const started: string[] = [];
        const withHook: SpurPlugin = {
            name: 'srv-hook',
            version: '1.0.0',
            trust: 'curated',
            onLoad: () => {},
            onServerStart: () => {
                started.push('srv-hook');
            },
        };
        const withoutHook: SpurPlugin = {
            name: 'no-hook',
            version: '1.0.0',
            trust: 'curated',
            onLoad: () => {},
        };
        await host.loadPlugin(withHook, { source: 'curated', pluginName: 'srv-hook', trustLevel: 'curated' });
        await host.loadPlugin(withoutHook, { source: 'curated', pluginName: 'no-hook', trustLevel: 'curated' });

        await host.startServerHooks();

        expect(started).toEqual(['srv-hook']);
    });

    it('stopServerHooks invokes onServerStop on loaded plugins that implement it', async () => {
        let stopped = false;
        const plugin: SpurPlugin = {
            name: 'stop-hook',
            version: '1.0.0',
            trust: 'curated',
            onLoad: () => {},
            onServerStop: () => {
                stopped = true;
            },
        };
        await host.loadPlugin(plugin, { source: 'curated', pluginName: 'stop-hook', trustLevel: 'curated' });

        await host.stopServerHooks();

        expect(stopped).toBe(true);
    });
});
