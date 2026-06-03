import { describe, expect, test } from 'bun:test';
import { PluginCollisionError, PluginHost } from '@gobing-ai/spur-plugin-sdk';
import { EventBus } from '@gobing-ai/ts-infra';
import { createApp, generateOpenApiSpec } from '../src';

/** Build a host whose api registry carries the given registrations. */
function hostWith(register: (host: PluginHost) => void): PluginHost {
    const host = new PluginHost(new EventBus());
    register(host);
    return host;
}

const ctx = { source: 'curated', pluginName: 'p', trustLevel: 'curated' } as const;

describe('plugin route seam', () => {
    test('mounts a plugin route under /api/plugins/<prefix>', async () => {
        const host = hostWith((h) => {
            h.api.register('greeter', { handler: () => new Response('hi from plugin') }, ctx);
        });

        const app = createApp({ apiRegistry: host.api });
        const response = await app.request('/api/plugins/greeter/anything');

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('hi from plugin');
    });

    test('mounts the bare prefix path with no sub-path', async () => {
        const host = hostWith((h) => {
            h.api.register('bare', { handler: () => new Response('root') }, ctx);
        });

        const app = createApp({ apiRegistry: host.api });
        const response = await app.request('/api/plugins/bare');

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('root');
    });

    test('a prefix collision throws PluginCollisionError at registration', () => {
        const host = new PluginHost(new EventBus());
        host.api.register('dup', { handler: () => new Response('first') }, ctx);

        expect(() => host.api.register('dup', { handler: () => new Response('second') }, ctx)).toThrow(
            PluginCollisionError,
        );
    });

    test('an unregistered prefix returns 404', async () => {
        const host = hostWith((h) => {
            h.api.register('known', { handler: () => new Response('ok') }, ctx);
        });

        const app = createApp({ apiRegistry: host.api });
        const response = await app.request('/api/plugins/unknown/path');

        expect(response.status).toBe(404);
    });

    test('plugin OpenAPI fragment appears in the generated spec, re-prefixed', async () => {
        const host = hostWith((h) => {
            h.api.register(
                'docs-plugin',
                {
                    handler: () => new Response('ok'),
                    openapi: {
                        paths: {
                            '/ping': { get: { summary: 'Plugin ping' } },
                        },
                    },
                },
                ctx,
            );
        });

        const app = createApp({ apiRegistry: host.api });
        const response = await app.request('/openapi.json');
        const spec = (await response.json()) as { paths: Record<string, { get?: { summary?: string } }> };

        expect(spec.paths['/plugins/docs-plugin/ping']?.get?.summary).toBe('Plugin ping');
        // The contract-derived health path is still present.
        expect(spec.paths['/health']).toBeDefined();
    });

    test('without an apiRegistry the app behaves exactly as before', async () => {
        const app = createApp();
        const health = await app.request('/api/health');
        const pluginPath = await app.request('/api/plugins/anything');

        expect(health.status).toBe(200);
        expect(pluginPath.status).toBe(404);
    });

    test('generateOpenApiSpec merges supplied plugin paths', async () => {
        const spec = await generateOpenApiSpec({
            '/plugins/x/y': { get: { summary: 'Injected' } },
        });

        expect(spec.paths?.['/plugins/x/y']?.get?.summary).toBe('Injected');
    });
});
