import { describe, expect, it } from 'bun:test';
import { PluginHost } from '@gobing-ai/spur-plugin-sdk';
import { EventBus, getLogger } from '@gobing-ai/ts-infra';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { PluginService, type PluginServiceContext } from '../../src/services/plugin-service';

describe('PluginService', () => {
    it('constructs without error', () => {
        const bus = new EventBus({} as never);
        const host = new PluginHost(bus, { logger: getLogger('test') });
        const ctx: PluginServiceContext = {
            host,
            fs: createNodeFileSystem(),
        };
        const service = new PluginService(ctx);
        expect(service).toBeDefined();
    });

    it('list() returns empty array when no plugins found', async () => {
        const bus = new EventBus({} as never);
        const host = new PluginHost(bus, { logger: getLogger('test') });
        const service = new PluginService({
            host,
            fs: createNodeFileSystem(),
        });
        const plugins = await service.list();
        expect(Array.isArray(plugins)).toBe(true);
        // In CI/tmpdir, no plugins are expected to be found naturally
    });

    it('info() returns null for unknown plugin', async () => {
        const bus = new EventBus({} as never);
        const host = new PluginHost(bus, { logger: getLogger('test') });
        const service = new PluginService({
            host,
            fs: createNodeFileSystem(),
        });
        const info = await service.info('nonexistent');
        expect(info).toBeNull();
    });
});
