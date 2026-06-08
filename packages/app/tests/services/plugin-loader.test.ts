import { describe, expect, it } from 'bun:test';
import { PluginHost } from '@gobing-ai/spur-plugin-sdk';
import { EventBus, getLogger } from '@gobing-ai/ts-infra';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { PluginLoader } from '../../src/services/plugin-loader';

describe('PluginLoader (smoke)', () => {
    it('constructs with host and fs', () => {
        // biome-ignore lint/suspicious/noExplicitAny: ts-infra 0.3.5 duplicate instances — structurally identical EventBus
        const bus = new EventBus({}) as any;
        const host = new PluginHost(bus, { logger: getLogger('test') });
        const loader = new PluginLoader(host, createNodeFileSystem());
        expect(loader).toBeDefined();
    });

    it('resolveRoots returns at least 2 roots', () => {
        // biome-ignore lint/suspicious/noExplicitAny: ts-infra 0.3.5 duplicate instances — structurally identical EventBus
        const bus = new EventBus({}) as any;
        const host = new PluginHost(bus, { logger: getLogger('test') });
        const loader = new PluginLoader(host, createNodeFileSystem());
        const roots = loader.resolveRoots();
        expect(roots.length).toBeGreaterThanOrEqual(2);
    });
});
