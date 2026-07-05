import { describe, expect, test } from 'bun:test';
import { generateOpenApiSpec } from '../src/openapi';

describe('openapi', () => {
    test('generates OpenAPI spec document', async () => {
        const spec = await generateOpenApiSpec();
        expect(spec.openapi).toBeTruthy();
        expect(spec.info).toBeDefined();
        expect(spec.paths).toBeDefined();
    });
    test('merges plugin-contributed path fragments into spec.paths', async () => {
        const pluginPaths = {
            '/plugins/foo': {
                get: { operationId: 'foo', responses: { '200': { description: 'ok' } } },
            },
        };
        const spec = await generateOpenApiSpec(pluginPaths);
        expect(spec.paths).toHaveProperty('/plugins/foo');
        expect(spec.info.title).toBe('Spur API');
    });
});
