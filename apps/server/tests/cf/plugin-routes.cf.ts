import { PluginHost } from '@gobing-ai/spur-plugin-sdk';
import { EventBus } from '@gobing-ai/ts-infra';
import { describe, expect, test } from 'vitest';
import { createApp } from '../../src/app';

describe('plugin routes on the cloudflare worker runtime', () => {
    test('mounts and serves a plugin route under the Workers pool', async () => {
        const host = new PluginHost(new EventBus());
        host.api.register(
            'cf-plugin',
            { handler: () => new Response('cf ok') },
            { source: 'curated', pluginName: 'cf-plugin', trustLevel: 'curated' },
        );

        const app = createApp({ apiRegistry: host.api });
        const response = await app.request('https://spur.test/api/plugins/cf-plugin/ping');

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('cf ok');
    });
});
