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

    test('documents the Hono-served fleet snapshot and process list (0897)', async () => {
        const spec = await generateOpenApiSpec();
        const paths = spec.paths ?? {};
        const fleet = paths['/project/fleet'] as { get?: { responses?: Record<string, unknown> } } | undefined;
        const procs = paths['/processes'] as { get?: { responses?: Record<string, unknown> } } | undefined;
        expect(fleet?.get).toBeDefined();
        expect(procs?.get).toBeDefined();
        // The generator inlines response schemas — the member session must ride both.
        const fleetSchema = JSON.stringify(
            (fleet?.get?.responses?.['200'] as { content?: Record<string, { schema?: unknown }> })?.content?.[
                'application/json'
            ]?.schema,
        );
        expect(fleetSchema).toContain('"session"');
        expect(fleetSchema).toContain('one-shot');
        const procSchema = JSON.stringify(
            (procs?.get?.responses?.['200'] as { content?: Record<string, { schema?: unknown }> })?.content?.[
                'application/json'
            ]?.schema,
        );
        expect(procSchema).toContain('"session"');
        expect(procSchema).toContain('"executions"');
    });
});
