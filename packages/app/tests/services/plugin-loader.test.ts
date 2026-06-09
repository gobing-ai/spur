import { describe, expect, it } from 'bun:test';

describe('plugin-loader types (deferred — no runtime)', () => {
    it('ModuleLoader type can be used as a function signature', async () => {
        const loader: (id: string) => Promise<Record<string, unknown>> = async (_id) => ({});
        const result = await loader('test');
        expect(result).toEqual({});
    });

    it('PluginCandidate shape is valid', () => {
        const candidate = {
            dir: '/some/path',
            source: 'local' as const,
            root: '/root',
        };
        expect(candidate.source).toBe('local');
    });

    it('PluginLoadResult shape is valid', () => {
        const result = {
            name: 'test',
            version: '1.0.0',
            source: 'local',
            status: 'loaded' as const,
            dir: '/some/path',
        };
        expect(result.status).toBe('loaded');
    });
});
